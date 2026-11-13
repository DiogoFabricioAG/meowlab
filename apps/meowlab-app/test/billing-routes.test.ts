import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app";
import type { Auth } from "../server/auth";
import type { BillingService } from "../server/billing/service";
import type { PortalBridge } from "../server/bridge";

const ORIGIN = { Origin: "https://app.meowlab.tech", "Content-Type": "application/json" };
const session = { user: { id: "user-1", name: "Ana", email: "ana@test.pe", image: null }, session: { id: "s1" } };

function app() {
  const auth = { api: { getSession: async () => session }, handler: async () => new Response(null) } as unknown as Auth;
  const bridge = {
    link: vi.fn(), billing: vi.fn(),
    companies: vi.fn(async () => ({ status: "ok", companies: [
      { id: "org_own", name: "Agu Bello", legalName: null, ruc: null, role: "owner", invoicing: "needs_sol" },
      { id: "org_member", name: "Kromata", legalName: null, ruc: null, role: "member", invoicing: "active" },
    ] })),
  } as unknown as PortalBridge;
  const billing = {
    status: vi.fn(async (tenantId: string | null) => ({ agents: [], discounts: [], subscription: null, tenantId })),
    subscribe: vi.fn(async () => ({ status: "redirect", checkoutUrl: "https://mp.example/x" })),
    cancel: vi.fn(async () => "cancelled"),
    syncFor: vi.fn(async () => undefined),
  } as unknown as BillingService & Record<string, ReturnType<typeof vi.fn>>;
  return { billing, api: createApp({ auth, googleEnabled: false, bridge, billing, allowedOrigins: ["https://app.meowlab.tech"] }) };
}

describe("billing routes per company", () => {
  it("lets the owner subscribe for her company, with the company the bridge confirms", async () => {
    const { api, billing } = app();
    const response = await api.request("/api/billing/subscribe", { method: "POST", headers: ORIGIN,
      body: JSON.stringify({ company: "org_own", agents: ["sales"], payerEmail: "ana@test.pe" }) });
    expect(response.status).toBe(200);
    expect(billing.subscribe).toHaveBeenCalledWith("user-1", "org_own", ["sales"], "ana@test.pe");
  });

  it("refuses to subscribe or cancel for a company where she is only a member, or not at all", async () => {
    const { api, billing } = app();
    for (const company of ["org_member", "org_other", "../x"]) {
      const subscribe = await api.request("/api/billing/subscribe", { method: "POST", headers: ORIGIN, body: JSON.stringify({ company, agents: ["sales"], payerEmail: "a@b.co" }) });
      const cancel = await api.request("/api/billing/cancel", { method: "POST", headers: ORIGIN, body: JSON.stringify({ company }) });
      expect([subscribe.status, cancel.status]).toEqual([403, 403]);
    }
    expect(billing.subscribe).not.toHaveBeenCalled();
    expect(billing.cancel).not.toHaveBeenCalled();
  });

  it("shows the plan to members without letting them manage it, and only the catalog without a company", async () => {
    const { api, billing } = app();
    expect(await (await api.request("/api/billing?company=org_member")).json()).toMatchObject({ tenantId: "org_member", canManage: false });
    expect(await (await api.request("/api/billing?company=org_own")).json()).toMatchObject({ canManage: true });
    expect((await api.request("/api/billing?company=org_other")).status).toBe(403);
    expect(await (await api.request("/api/billing")).json()).toMatchObject({ tenantId: null });
    expect(billing.status).toHaveBeenCalledTimes(3);
  });
});
