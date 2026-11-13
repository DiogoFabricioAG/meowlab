import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app";
import type { Auth } from "../server/auth";
import type { PortalBridge } from "../server/bridge";

const ULID = "01JZ8Y9X7W6V5T4S3R2Q1P0N9M";
const session = { user: { id: "user-1", name: "Ana", email: "ana@test.pe", image: null }, session: { id: "s1" } };

function app(billing: PortalBridge["billing"], link: PortalBridge["link"] = async () => ({ status: "linked", maskedPhone: "+51 9•• ••• 280", linkedAt: "2026-11-13T00:00:00Z" })) {
  const auth = { api: { getSession: async () => session }, handler: async () => new Response(null) } as unknown as Auth;
  const bridge: PortalBridge = { link: vi.fn(link), billing: vi.fn(billing) };
  return { bridge, app: createApp({ auth, googleEnabled: false, bridge, allowedOrigins: ["https://app.meowlab.tech"] }) };
}

describe("invoicing routes", () => {
  it("opens the billing module only when the linked number belongs to a company", async () => {
    const withCompany = app(async () => ({ status: "ok", companies: [{ id: "t1", name: "Kromata", legalName: null, ruc: null, environment: "production" }] }));
    const me = await (await withCompany.app.request("/api/me")).json() as { modules: Array<{ status: string }> };
    expect(me.modules[0].status).toBe("available");
    const without = app(async () => ({ status: "ok", companies: [] }));
    const me2 = await (await without.app.request("/api/me")).json() as { modules: Array<{ status: string }> };
    expect(me2.modules[0].status).toBe("no_company");
  });

  it("passes validated filters to the bridge and maps its refusals", async () => {
    const { app: api, bridge } = app(async (_user, request) =>
      request.action === "documents" && request.tenantId === "t1" ? { status: "ok", data: [], meta: { total: 0 } } : { status: "forbidden" });
    expect((await api.request("/api/invoicing/t1/documents?from=2026-11-01&to=2026-11-30&type=01&page=2")).status).toBe(200);
    expect(bridge.billing).toHaveBeenCalledWith("user-1", { action: "documents", tenantId: "t1", from: "2026-11-01", to: "2026-11-30", type: "01", page: 2 });
    expect((await api.request("/api/invoicing/otra/documents")).status).toBe(403);
    expect((await api.request("/api/invoicing/t1/documents?from=1/11/2026")).status).toBe(400);
    expect((await api.request("/api/invoicing/t1/documents?type=99")).status).toBe(400);
    expect((await api.request("/api/invoicing/t1/summary?year=1990")).status).toBe(400);
  });

  it("streams files with an allow-listed type and a safe name", async () => {
    const { app: api } = app(async () => ({ status: "ok", file: { base64: "JVBERg==", mimeType: "text/html", filename: "factura\"; x=1.pdf" } }));
    const response = await api.request(`/api/invoicing/t1/files/invoice/${ULID}/pdf`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe('inline; filename="factura___x_1.pdf"');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70]));
  });

  it("rejects file requests outside the allowed shapes", async () => {
    const { app: api, bridge } = app(async () => ({ status: "ok", file: { base64: "", mimeType: "", filename: "x" } }));
    expect((await api.request(`/api/invoicing/t1/files/credit_note/${ULID}/pdf`)).status).toBe(400);
    expect((await api.request("/api/invoicing/t1/files/invoice/..%2F..%2Fetc/pdf")).status).toBe(400);
    expect((await api.request(`/api/invoicing/t1/files/user/${ULID}/xml`)).status).toBe(400);
    expect(bridge.billing).not.toHaveBeenCalled();
  });
});
