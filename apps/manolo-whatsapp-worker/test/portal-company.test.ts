import { describe, expect, it, vi } from "vitest";
import { PORTAL_COMPANY_BRIDGE_PATH, isPortalCompanyRequest, isValidRuc } from "../src/bridge/portal-company-contracts";
import { signBridgePayload } from "../src/bridge/signature";
import { createBridgeHttpHandler } from "../src/node/bridge/http-handler";
import { FacturayaTaxpayerDirectory, PortalCompanyService, type TaxpayerDirectory } from "../src/node/portal/company-service";
import { PortalInvitationService } from "../src/node/portal/invitation-service";
import type { PrintAdvisorBridgeService } from "../src/node/bridge/print-advisor-service";
import type { ContactRoleResolver } from "../src/node/control/contact-role-resolver";

const RUC = "20557288016";
const base = { version: 1 as const, requestId: "r1", portalUserId: "user-1" };
const taxpayer = { ruc: RUC, legalName: "AGU BELLO E.I.R.L.", address: "LIMA", status: "ACTIVO", condition: "HABIDO" };

describe("portal company contracts", () => {
  it("checks the RUC prefix and check digit", () => {
    expect(isValidRuc(RUC)).toBe(true);
    expect(isValidRuc("20557288017")).toBe(false);
    expect(isValidRuc("30557288016")).toBe(false);
    expect(isValidRuc("2055728801")).toBe(false);
  });

  it("validates actions and bounds", () => {
    expect(isPortalCompanyRequest({ ...base, action: "mine" })).toBe(true);
    expect(isPortalCompanyRequest({ ...base, action: "lookup", ruc: RUC })).toBe(true);
    expect(isPortalCompanyRequest({ ...base, action: "create", ruc: RUC, name: "Agu" })).toBe(true);
    expect(isPortalCompanyRequest({ ...base, action: "create", ruc: RUC, name: "x".repeat(161) })).toBe(false);
    expect(isPortalCompanyRequest({ ...base, action: "lookup", ruc: "2".repeat(40) })).toBe(false);
    expect(isPortalCompanyRequest({ ...base, action: "delete" })).toBe(false);
  });
});

type Options = { taken?: boolean; owned?: number; conflict?: boolean; directory?: TaxpayerDirectory | null };

function setup(options: Options = {}) {
  const statements: Array<{ sql: string; values?: readonly unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, values?: readonly unknown[]) => {
      statements.push({ sql, values });
      if (sql.includes("count(*)")) return { rows: [{ total: options.owned ?? 0 }] };
      if (sql.includes("INSERT INTO whatsapp.tenants")) return { rows: options.conflict ? [] : [{ id: values?.[0] }] };
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn(async (sql: string) => {
      if (sql.includes("WHERE ruc = $1")) return { rows: options.taken ? [{ "?column?": 1 }] : [] };
      return { rows: [{ id: "org_1", name: "Agu", legal_name: "AGU BELLO E.I.R.L.", ruc: RUC, role: "owner", invoicing_active: false }] };
    }),
  };
  const directory = options.directory === undefined ? { find: vi.fn(async () => taxpayer) } : options.directory;
  const service = new PortalCompanyService(pool, directory, vi.fn(), () => "org_new");
  return { service, pool, client, statements, directory };
}

describe("portal company service", () => {
  it("lists the account's memberships with Invoice Cat pending SOL", async () => {
    const { service } = setup();
    expect(await service.handle({ ...base, action: "mine" })).toEqual({
      status: "ok",
      companies: [{ id: "org_1", name: "Agu", legalName: "AGU BELLO E.I.R.L.", ruc: RUC, role: "owner", invoicing: "needs_sol" }],
    });
  });

  it("looks up a free RUC in the registry", async () => {
    const { service } = setup();
    expect(await service.handle({ ...base, action: "lookup", ruc: RUC })).toEqual({ status: "ok", taxpayer });
  });

  it("refuses an invalid RUC before any query", async () => {
    const { service, pool } = setup();
    expect(await service.handle({ ...base, action: "lookup", ruc: "20557288017" })).toEqual({ status: "invalid_ruc" });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("says a RUC is taken without revealing the company or asking the registry", async () => {
    const { service, directory } = setup({ taken: true });
    const result = await service.handle({ ...base, action: "lookup", ruc: RUC });
    expect(result).toEqual({ status: "taken" });
    expect(directory?.find).not.toHaveBeenCalled();
  });

  it("refuses taxpayers that are not active", async () => {
    const { service } = setup({ directory: { find: async () => ({ ...taxpayer, status: "BAJA DE OFICIO" }) } });
    expect(await service.handle({ ...base, action: "create", ruc: RUC })).toMatchObject({ status: "inactive" });
  });

  it("maps a missing RUC and a registry outage", async () => {
    expect(await setup({ directory: { find: async () => null } }).service.handle({ ...base, action: "lookup", ruc: RUC }))
      .toEqual({ status: "not_found" });
    expect(await setup({ directory: { find: async () => { throw new Error("down"); } } }).service.handle({ ...base, action: "lookup", ruc: RUC }))
      .toEqual({ status: "unavailable" });
    expect(await setup({ directory: null }).service.handle({ ...base, action: "lookup", ruc: RUC })).toEqual({ status: "unavailable" });
  });

  it("creates the company from the registry data with the account as owner", async () => {
    const { service, statements, client } = setup();
    const result = await service.handle({ ...base, action: "create", ruc: RUC, name: "  Agu Bello  " });
    expect(result).toEqual({
      status: "created",
      company: { id: "org_new", name: "Agu Bello", legalName: "AGU BELLO E.I.R.L.", ruc: RUC, role: "owner", invoicing: "needs_sol" },
    });
    const tenant = statements.find((s) => s.sql.includes("INSERT INTO whatsapp.tenants"));
    expect(tenant?.values).toEqual(["org_new", "Agu Bello", "AGU BELLO E.I.R.L.", RUC, "LIMA"]);
    const owner = statements.find((s) => s.sql.includes("INSERT INTO whatsapp.portal_company_members"));
    expect(owner?.values).toEqual(["org_new", "user-1"]);
    expect(statements.at(-1)?.sql).toBe("COMMIT");
    expect(client.release).toHaveBeenCalledWith(false);
  });

  it("stops at the ownership limit and on a concurrent registration of the same RUC", async () => {
    const limited = setup({ owned: 3 });
    expect(await limited.service.handle({ ...base, action: "create", ruc: RUC })).toEqual({ status: "limit_reached" });
    expect(limited.statements.some((s) => s.sql.includes("INSERT"))).toBe(false);
    const raced = setup({ conflict: true });
    expect(await raced.service.handle({ ...base, action: "create", ruc: RUC })).toEqual({ status: "taken" });
    expect(raced.statements.some((s) => s.sql.includes("portal_company_members (tenant_id"))).toBe(false);
    expect(raced.statements.at(-1)?.sql).toBe("ROLLBACK");
  });
});

describe("FacturaYa taxpayer directory", () => {
  it("reads the internal route with its bearer and normalizes the answer", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({ data: {
      ruc: RUC, legal_name: " AGU BELLO E.I.R.L. ", status: "ACTIVO", condition: "HABIDO", address: "", ubigeo: "150132",
    } }));
    const directory = new FacturayaTaxpayerDirectory("https://facturas.example", "internal-token", fetchImpl as unknown as typeof fetch);
    expect(await directory.find(RUC)).toEqual({ ...taxpayer, address: null });
    expect(String(fetchImpl.mock.calls[0][0])).toBe(`https://facturas.example/api/internal/taxpayers/${RUC}`);
    expect(new Headers(fetchImpl.mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer internal-token");
  });

  it("returns null on 404 and throws on errors or a different RUC", async () => {
    const respond = (response: Response) => new FacturayaTaxpayerDirectory("https://f", "t", (async () => response) as unknown as typeof fetch);
    expect(await respond(new Response(null, { status: 404 })).find(RUC)).toBeNull();
    await expect(respond(new Response(null, { status: 503 })).find(RUC)).rejects.toThrow();
    await expect(respond(Response.json({ data: { ruc: "20111111111", legal_name: "Otra" } })).find(RUC)).rejects.toThrow();
  });
});

describe("portal company route", () => {
  const SECRET = "portal-secret-portal-secret-portal-secret";
  const handler = (service: Pick<PortalCompanyService, "handle">) => createBridgeHttpHandler({
    sharedSecret: "worker-secret-worker-secret-worker-secret",
    service: {} as PrintAdvisorBridgeService,
    contactRoleResolver: {} as ContactRoleResolver,
    portalSecret: SECRET,
    portalCompanyService: service,
    log: vi.fn(),
    healthCheck: async () => true,
    nowSeconds: () => 1_800_000_000,
  });
  const signed = async (secret: string, payload: Record<string, unknown>) => {
    const body = JSON.stringify(payload);
    return {
      method: "POST", path: PORTAL_COMPANY_BRIDGE_PATH, body,
      headers: {
        "x-manolo-timestamp": "1800000000",
        "x-manolo-signature": await signBridgePayload(secret, "1800000000", body),
        "x-manolo-request-id": String(payload.requestId),
      },
    };
  };

  it("accepts only the portal secret and valid requests", async () => {
    const service = { handle: vi.fn(async () => ({ status: "ok" as const, companies: [] })) };
    const route = handler(service);
    expect((await route(await signed(SECRET, { ...base, action: "mine" }))).status).toBe(200);
    expect((await route(await signed("worker-secret-worker-secret-worker-secret", { ...base, action: "mine" }))).status).toBe(401);
    expect((await route(await signed(SECRET, { ...base, action: "drop" }))).status).toBe(400);
    expect(service.handle).toHaveBeenCalledTimes(1);
  });
});

describe("portal invitation contracts", () => {
  const TOKEN = "AbCdEfGhIjKlMnOpQrStUv";
  it("validates invitation actions", () => {
    expect(isPortalCompanyRequest({ ...base, action: "team", tenantId: "org_1" })).toBe(true);
    expect(isPortalCompanyRequest({ ...base, action: "invite", tenantId: "org_1", access: "view" })).toBe(true);
    expect(isPortalCompanyRequest({ ...base, action: "invite", tenantId: "org_1", access: "full", phone: "987654321" })).toBe(true);
    expect(isPortalCompanyRequest({ ...base, action: "invite", tenantId: "org_1", access: "admin" })).toBe(false);
    expect(isPortalCompanyRequest({ ...base, action: "revoke", tenantId: "org_1", invitationId: "not-a-uuid" })).toBe(false);
    expect(isPortalCompanyRequest({ ...base, action: "revoke", tenantId: "org_1", invitationId: "6f1c2b3a-1d2e-4f50-9a6b-7c8d9e0f1a2b" })).toBe(true);
    expect(isPortalCompanyRequest({ ...base, action: "remove", tenantId: "org_1", memberId: "user-2" })).toBe(true);
    expect(isPortalCompanyRequest({ ...base, action: "preview", token: TOKEN })).toBe(true);
    expect(isPortalCompanyRequest({ ...base, action: "accept", token: TOKEN + "x" })).toBe(false);
    expect(isPortalCompanyRequest({ ...base, action: "accept", token: "../../etc/passwd/xxxxx" })).toBe(false);
  });
});

describe("portal invitation service", () => {
  it("rejects a bad phone before touching the database and refuses non-owners", async () => {
    const pool = { connect: vi.fn(), query: vi.fn(async () => ({ rows: [] })) };
    const service = new PortalInvitationService(pool, vi.fn());
    expect(await service.handle({ ...base, action: "invite", tenantId: "org_1", access: "view", phone: "12" })).toEqual({ status: "invalid_phone" });
    expect(pool.query).not.toHaveBeenCalled();
    expect(await service.handle({ ...base, action: "invite", tenantId: "org_1", access: "view" })).toEqual({ status: "forbidden" });
    expect(await service.handle({ ...base, action: "team", tenantId: "org_1" })).toEqual({ status: "forbidden" });
    expect(await service.handle({ ...base, action: "remove", tenantId: "org_1", memberId: "user-1" })).toEqual({ status: "forbidden" });
  });

  it("stores only the hash of the code and returns the code once", async () => {
    const statements: Array<{ sql: string; values?: readonly unknown[] }> = [];
    const pool = {
      connect: vi.fn(),
      query: vi.fn(async (sql: string, values?: readonly unknown[]) => {
        statements.push({ sql, values });
        if (sql.includes("role = 'owner'")) return { rows: [{ "?column?": 1 }] };
        if (sql.includes("count(*)")) return { rows: [{ total: 0 }] };
        return { rows: [] };
      }),
    };
    const now = new Date("2026-11-13T05:00:00Z");
    const service = new PortalInvitationService(pool, vi.fn(), () => now, () => "AbCdEfGhIjKlMnOpQrStUv");
    const result = await service.handle({ ...base, action: "invite", tenantId: "org_1", access: "full", phone: "987654321" });
    expect(result).toMatchObject({ status: "invited", invitation: { token: "AbCdEfGhIjKlMnOpQrStUv", maskedPhone: "+51 9•• ••• 321",
      access: "full", expiresAt: "2026-11-20T05:00:00.000Z" } });
    const insert = statements.find((s) => s.sql.includes("INSERT INTO whatsapp.portal_company_invitations"));
    expect(JSON.stringify(insert?.values)).not.toContain("AbCdEfGhIjKlMnOpQrStUv");
    expect(insert?.values?.[2]).toMatch(/^[0-9a-f]{64}$/);
    expect(insert?.values?.[4]).toBe("51987654321");
  });

  it("is reached through the company service", async () => {
    const invitations = { handle: vi.fn(async () => ({ status: "forbidden" as const })) };
    const service = new PortalCompanyService({ connect: vi.fn(), query: vi.fn() }, null, vi.fn(), () => "org", invitations);
    expect(await service.handle({ ...base, action: "team", tenantId: "org_1" })).toEqual({ status: "forbidden" });
    expect(invitations.handle).toHaveBeenCalledWith({ ...base, action: "team", tenantId: "org_1" });
  });
});
