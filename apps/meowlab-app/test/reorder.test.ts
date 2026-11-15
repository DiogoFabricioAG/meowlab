import { describe, expect, it, vi } from "vitest";
import { reorderChange, createApp } from "../server/app";
import type { Auth } from "../server/auth";
import type { PortalBridge, PortalCompanyResponse } from "../server/bridge";

const session = { user: { id: "user-1", name: "Ana", email: "ana@test.pe", image: null }, session: { id: "s1" } };
const ORIGIN = "https://app.meowlab.tech";

function app(companies: (userId: string, request: unknown) => Promise<PortalCompanyResponse | null>, signedIn = true) {
  const auth = { api: { getSession: async () => (signedIn ? session : null) }, handler: async () => new Response(null) } as unknown as Auth;
  const bridge: PortalBridge = {
    link: vi.fn(async () => ({ status: "not_linked" as const })),
    billing: vi.fn(async () => ({ status: "not_linked" as const })),
    companies: vi.fn(companies),
  };
  return { bridge, app: createApp({ auth, googleEnabled: false, bridge, allowedOrigins: [ORIGIN] }) };
}

const VIEW = { enabled: false as const };
const post = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: JSON.stringify(body) });

describe("Reorder Cat routes (ADR-0016)", () => {
  it("relays the orders and suppliers for the signed-in account", async () => {
    const { app: api, bridge } = app(async () => ({ status: "ok", reorder: VIEW }));
    const response = await api.request("/api/companies/org_1/reorder");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(VIEW);
    expect(bridge.companies).toHaveBeenCalledWith("user-1", { action: "reorder_view", tenantId: "org_1" });
  });

  it("sends only valid rule changes, and says who may change them", async () => {
    const { app: api, bridge } = app(async () => ({ status: "ok", reorder: VIEW }));
    expect((await api.request("/api/companies/org_1/reorder/settings", post({ change: { monthlyBudgetCents: 300000, followupHours: 12 } }))).status).toBe(200);
    expect(bridge.companies).toHaveBeenCalledWith("user-1", { action: "reorder_settings", tenantId: "org_1", change: { monthlyBudgetCents: 300000, followupHours: 12 } });
    expect((await api.request("/api/companies/org_1/reorder/settings", post({ change: { approveAlone: true } }))).status).toBe(400);
    expect((await app(async () => ({ status: "owner_only" })).app.request("/api/companies/org_1/reorder/settings", post({ change: { followupHours: 6 } }))).status).toBe(403);
    expect((await app(async () => ({ status: "invalid_settings" })).app.request("/api/companies/org_1/reorder/settings", post({ change: { escalateHours: 6 } }))).status).toBe(400);
  });

  it("validates each field of a change", () => {
    expect(reorderChange({ monthlyBudgetCents: null })).toEqual({ monthlyBudgetCents: null });
    expect(reorderChange({ monthlyBudgetCents: 0 })).toBeNull();
    expect(reorderChange({ followupHours: 200 })).toBeNull();
    expect(reorderChange({ escalateHours: 1.5 })).toBeNull();
    expect(reorderChange({})).toBeNull();
  });

  it("refuses strangers, no session and a silent bridge", async () => {
    expect((await app(async () => ({ status: "forbidden" })).app.request("/api/companies/org_1/reorder")).status).toBe(403);
    expect((await app(async () => null).app.request("/api/companies/org_1/reorder")).status).toBe(503);
    expect((await app(async () => null, false).app.request("/api/companies/org_1/reorder")).status).toBe(401);
  });
});
