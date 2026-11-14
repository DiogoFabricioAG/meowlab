import { describe, expect, it, vi } from "vitest";
import { collectionsChange, createApp } from "../server/app";
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

describe("Collections Cat routes (ADR-0015)", () => {
  it("relays what the company is owed for the signed-in account", async () => {
    const { app: api, bridge } = app(async () => ({ status: "ok", collections: VIEW }));
    const response = await api.request("/api/companies/org_1/collections");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(VIEW);
    expect(bridge.companies).toHaveBeenCalledWith("user-1", { action: "collections_view", tenantId: "org_1" });
  });

  it("sends only valid rule changes, and says who may change them", async () => {
    const { app: api, bridge } = app(async () => ({ status: "ok", collections: VIEW }));
    expect((await api.request("/api/companies/org_1/collections/settings", post({ change: { yapePhone: "987654321", maxReminders: 4 } }))).status).toBe(200);
    expect(bridge.companies).toHaveBeenCalledWith("user-1", { action: "collections_settings", tenantId: "org_1", change: { yapePhone: "987654321", maxReminders: 4 } });
    expect((await api.request("/api/companies/org_1/collections/settings", post({ change: { interest: 3 } }))).status).toBe(400);
    expect((await app(async () => ({ status: "owner_only" })).app.request("/api/companies/org_1/collections/settings", post({ change: { maxReminders: 2 } }))).status).toBe(403);
    expect((await app(async () => ({ status: "invalid_settings" })).app.request("/api/companies/org_1/collections/settings", post({ change: { windowEndHour: 8 } }))).status).toBe(400);
  });

  it("validates each field of a change", () => {
    expect(collectionsChange({ bankText: "  BCP 191-1234567  ", skipSundays: false })).toEqual({ bankText: "BCP 191-1234567", skipSundays: false });
    expect(collectionsChange({ yapePhone: null })).toEqual({ yapePhone: null });
    expect(collectionsChange({ yapePhone: "12345" })).toBeNull();
    expect(collectionsChange({ paymentLink: "http://pago.pe" })).toBeNull();
    expect(collectionsChange({ maxReminders: 0 })).toBeNull();
    expect(collectionsChange({})).toBeNull();
  });

  it("refuses strangers, no session and a silent bridge", async () => {
    expect((await app(async () => ({ status: "forbidden" })).app.request("/api/companies/org_1/collections")).status).toBe(403);
    expect((await app(async () => null).app.request("/api/companies/org_1/collections")).status).toBe(503);
    expect((await app(async () => null, false).app.request("/api/companies/org_1/collections")).status).toBe(401);
  });
});
