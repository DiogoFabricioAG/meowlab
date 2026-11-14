import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app";
import type { Auth } from "../server/auth";
import type { PortalBridge, PortalCompanyResponse } from "../server/bridge";

const session = { user: { id: "user-1", name: "Ana", email: "ana@test.pe", image: null }, session: { id: "s1" } };

function app(companies: (userId: string, request: unknown) => Promise<PortalCompanyResponse | null>, signedIn = true) {
  const auth = { api: { getSession: async () => (signedIn ? session : null) }, handler: async () => new Response(null) } as unknown as Auth;
  const bridge: PortalBridge = {
    link: vi.fn(async () => ({ status: "not_linked" as const })),
    billing: vi.fn(async () => ({ status: "not_linked" as const })),
    companies: vi.fn(companies),
  };
  return { bridge, app: createApp({ auth, googleEnabled: false, bridge, allowedOrigins: ["https://app.meowlab.tech"] }) };
}

describe("Stock Cat route (ADR-0014)", () => {
  it("relays the company's stock for the signed-in account", async () => {
    const stock = { enabled: true as const, owner: false, allowNegative: true, valueCents: null, items: [], moves: [], unmatched: [] };
    const { app: api, bridge } = app(async () => ({ status: "ok", stock }));
    const response = await api.request("/api/companies/org_1/stock");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(stock);
    expect(bridge.companies).toHaveBeenCalledWith("user-1", { action: "stock_view", tenantId: "org_1" });
  });

  it("refuses strangers, bad ids, no session and a silent bridge", async () => {
    expect((await app(async () => ({ status: "forbidden" })).app.request("/api/companies/org_1/stock")).status).toBe(403);
    const bad = app(async () => null);
    expect((await bad.app.request("/api/companies/a%20b/stock")).status).toBe(400);
    expect(bad.bridge.companies).not.toHaveBeenCalled();
    expect((await bad.app.request("/api/companies/org_1/stock")).status).toBe(503);
    expect((await app(async () => null, false).app.request("/api/companies/org_1/stock")).status).toBe(401);
  });
});
