import { describe, expect, it, vi } from "vitest";
import { supportFaq, createApp } from "../server/app";
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

describe("Support Cat routes (ADR-0017)", () => {
  it("relays the cases and frequent questions for the signed-in account", async () => {
    const { app: api, bridge } = app(async () => ({ status: "ok", support: VIEW }));
    const response = await api.request("/api/companies/org_1/support");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(VIEW);
    expect(bridge.companies).toHaveBeenCalledWith("user-1", { action: "support_view", tenantId: "org_1" });
  });

  it("sends only valid question changes, and says who may change them", async () => {
    const { app: api, bridge } = app(async () => ({ status: "ok", support: VIEW }));
    expect((await api.request("/api/companies/org_1/support/faq", post({ faq: { question: " ¿Delivery? ", answer: "Sí, S/ 10" } }))).status).toBe(200);
    expect(bridge.companies).toHaveBeenCalledWith("user-1", { action: "support_faq", tenantId: "org_1", faq: { question: "¿Delivery?", answer: "Sí, S/ 10" } });
    expect((await api.request("/api/companies/org_1/support/faq", post({ faq: { remove: true } }))).status).toBe(400);
    expect((await app(async () => ({ status: "owner_only" })).app.request("/api/companies/org_1/support/faq", post({ faq: { question: "a", answer: "b" } }))).status).toBe(403);
  });

  it("validates each question change", () => {
    expect(supportFaq({ id: "3f1c2a4e-1111-4a2b-9c3d-000000000001", remove: true })).toEqual({ id: "3f1c2a4e-1111-4a2b-9c3d-000000000001", remove: true });
    expect(supportFaq({ question: "", answer: "x" })).toBeNull();
    expect(supportFaq({ question: "a", answer: "b", extra: 1 })).toBeNull();
    expect(supportFaq({ id: "nope", question: "a", answer: "b" })).toBeNull();
  });

  it("refuses strangers, no session and a silent bridge", async () => {
    expect((await app(async () => ({ status: "forbidden" })).app.request("/api/companies/org_1/support")).status).toBe(403);
    expect((await app(async () => null).app.request("/api/companies/org_1/support")).status).toBe(503);
    expect((await app(async () => null, false).app.request("/api/companies/org_1/support")).status).toBe(401);
  });
});
