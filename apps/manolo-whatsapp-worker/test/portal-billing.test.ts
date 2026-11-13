import { describe, expect, it, vi } from "vitest";
import { PORTAL_BILLING_BRIDGE_PATH, isPortalBillingRequest } from "../src/bridge/portal-billing-contracts";
import { signBridgePayload } from "../src/bridge/signature";
import { createBridgeHttpHandler } from "../src/node/bridge/http-handler";
import { PortalBillingService } from "../src/node/portal/billing-service";
import type { PrintAdvisorBridgeService } from "../src/node/bridge/print-advisor-service";
import type { ContactRoleResolver } from "../src/node/control/contact-role-resolver";

const ULID = "01JZ8Y9X7W6V5T4S3R2Q1P0N9M";
const base = { version: 1 as const, requestId: "r1", portalUserId: "user-1" };

describe("portal billing contracts", () => {
  it("validates actions, dates, pages and file kinds", () => {
    expect(isPortalBillingRequest({ ...base, action: "companies" })).toBe(true);
    expect(isPortalBillingRequest({ ...base, action: "documents", tenantId: "t1", from: "2026-11-01", type: "01", page: 2 })).toBe(true);
    expect(isPortalBillingRequest({ ...base, action: "documents", tenantId: "t1", from: "01/11/2026" })).toBe(false);
    expect(isPortalBillingRequest({ ...base, action: "summary", tenantId: "t1", year: 2026 })).toBe(true);
    expect(isPortalBillingRequest({ ...base, action: "file", tenantId: "t1", kind: "invoice", id: ULID, fileType: "pdf" })).toBe(true);
    expect(isPortalBillingRequest({ ...base, action: "file", tenantId: "t1", kind: "credit_note", id: ULID, fileType: "pdf" })).toBe(false);
    expect(isPortalBillingRequest({ ...base, action: "file", tenantId: "t1", kind: "invoice", id: "../../etc", fileType: "xml" })).toBe(false);
    expect(isPortalBillingRequest({ ...base, action: "drop" })).toBe(false);
  });
});

function setup(options: { linked?: boolean } = {}) {
  const linked = options.linked ?? true;
  const pool = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("SELECT 1 FROM whatsapp.portal_whatsapp_links")) return { rows: linked ? [{ "?column?": 1 }] : [] };
      return { rows: [{ id: "t1", name: "Kromata", legal_name: "Kromata S.A.C.", ruc: "20111111111", environment: "production", encrypted_token: "enc-t1" }] };
    }),
  };
  const calls: Array<{ url: string; auth: string | null }> = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, auth: new Headers(init?.headers).get("Authorization") });
    if (url.includes("/api/despatches/")) return new Response(new Uint8Array([60, 120, 109, 108]), { status: 200, headers: { "Content-Type": "application/xml" } });
    if (url.includes("/api/despatches")) {
      return Response.json({ data: [{ id: ULID, series: "T001", correlative: 3, status: "accepted", payload: { secret: "driver data" },
        idempotency_key: "k", xml_path: "x.xml", cdr_path: null, invoice_number: "F001-00000001", customer: { ruc: "20", name: "C" } }],
        current_page: 1, last_page: 1, total: 1 });
    }
    if (url.includes("/files/pdf")) return new Response(new Uint8Array([37, 80, 68, 70]), { status: 200, headers: { "Content-Type": "application/pdf" } });
    return Response.json({ data: [{ number: "F001-00000001", total: "118.00" }], meta: { total: 1 } });
  });
  const service = new PortalBillingService(pool, { decrypt: (value) => `plain-${value}` }, "https://facturas.example", vi.fn(), fetchImpl as unknown as typeof fetch);
  return { service, calls };
}

describe("portal billing service", () => {
  it("lists only the companies of the linked number, without their tokens", async () => {
    const { service } = setup();
    const result = await service.handle({ ...base, action: "companies" });
    expect(result).toEqual({ status: "ok", companies: [{ id: "t1", name: "Kromata", legalName: "Kromata S.A.C.", ruc: "20111111111", environment: "production" }] });
    expect(JSON.stringify(result)).not.toContain("enc-t1");
  });

  it("answers not_linked before the number is verified", async () => {
    const { service } = setup({ linked: false });
    expect(await service.handle({ ...base, action: "companies" })).toEqual({ status: "not_linked" });
  });

  it("refuses a company the account does not belong to and never calls FacturaYa", async () => {
    const { service, calls } = setup();
    expect(await service.handle({ ...base, action: "documents", tenantId: "otra-empresa" })).toEqual({ status: "forbidden" });
    expect(calls).toHaveLength(0);
  });

  it("reads documents and summary from FacturaYa with that company's token", async () => {
    const { service, calls } = setup();
    expect(await service.handle({ ...base, action: "documents", tenantId: "t1", from: "2026-11-01", type: "01", page: 2 }))
      .toEqual({ status: "ok", data: [{ number: "F001-00000001", total: "118.00" }], meta: { total: 1 } });
    await service.handle({ ...base, action: "summary", tenantId: "t1", year: 2026 });
    expect(calls[0]).toEqual({ url: "https://facturas.example/api/issued-documents?from=2026-11-01&type=01&page=2", auth: "Bearer plain-enc-t1" });
    expect(calls[1].url).toBe("https://facturas.example/api/reports/monthly?year=2026");
  });

  it("returns only a summary of each guide, never its payload", async () => {
    const { service } = setup();
    const result = await service.handle({ ...base, action: "despatches", tenantId: "t1" }) as { data: Array<Record<string, unknown>> };
    expect(result.data[0]).toMatchObject({ series: "T001", correlative: 3, invoice_number: "F001-00000001", files: { xml: true, cdr: false } });
    expect(JSON.stringify(result)).not.toContain("driver data");
    expect(JSON.stringify(result)).not.toContain("idempotency_key");
  });

  it("returns files as base64 with a safe name", async () => {
    const { service } = setup();
    expect(await service.handle({ ...base, action: "file", tenantId: "t1", kind: "invoice", id: ULID, fileType: "pdf" }))
      .toEqual({ status: "ok", file: { base64: "JVBERg==", mimeType: "application/pdf", filename: `invoice-${ULID}.pdf` } });
  });
});

describe("bridge billing route", () => {
  const PORTAL = "portal-secret-portal-secret-portal-secret";
  const SHARED = "shared-secret-shared-secret-shared-secret";
  function handler() {
    const billing = { handle: vi.fn(async () => ({ status: "ok" as const, companies: [] })) };
    return {
      billing,
      handle: createBridgeHttpHandler({
        sharedSecret: SHARED, portalSecret: PORTAL, portalBillingService: billing,
        service: {} as PrintAdvisorBridgeService, contactRoleResolver: {} as ContactRoleResolver,
        healthCheck: async () => true, log: vi.fn(),
      }),
    };
  }
  async function signed(secret: string, payload: Record<string, unknown>) {
    const body = JSON.stringify(payload);
    const ts = String(Math.floor(Date.now() / 1_000));
    return { method: "POST", path: PORTAL_BILLING_BRIDGE_PATH, body,
      headers: { "x-manolo-timestamp": ts, "x-manolo-signature": await signBridgePayload(secret, ts, body), "x-manolo-request-id": String(payload.requestId) } };
  }

  it("accepts only the portal secret", async () => {
    const { handle, billing } = handler();
    expect((await handle(await signed(PORTAL, { ...base, action: "companies" }))).status).toBe(200);
    expect((await handle(await signed(SHARED, { ...base, action: "companies" }))).status).toBe(401);
    expect(billing.handle).toHaveBeenCalledOnce();
  });

  it("rejects malformed requests", async () => {
    const { handle } = handler();
    expect((await handle(await signed(PORTAL, { ...base, action: "file", tenantId: "t1", kind: "invoice", id: "x", fileType: "pdf" }))).status).toBe(400);
  });
});
