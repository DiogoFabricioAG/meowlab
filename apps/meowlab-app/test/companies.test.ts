import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app";
import type { Auth } from "../server/auth";
import type { PortalBridge, PortalCompanyResponse } from "../server/bridge";

const session = { user: { id: "user-1", name: "Ana", email: "ana@test.pe", image: null }, session: { id: "s1" } };
const ORIGIN = { Origin: "https://app.meowlab.tech", "Content-Type": "application/json" };
const membership = { id: "org_1", name: "Agu", legalName: "AGU BELLO E.I.R.L.", ruc: "20557288016", role: "owner" as const, invoicing: "needs_sol" as const };

function app(companies: (userId: string, request: unknown) => Promise<PortalCompanyResponse | null>) {
  const auth = { api: { getSession: async () => session }, handler: async () => new Response(null) } as unknown as Auth;
  const bridge: PortalBridge = {
    link: vi.fn(async () => ({ status: "not_linked" as const })),
    billing: vi.fn(async () => ({ status: "not_linked" as const })),
    companies: vi.fn(companies),
  };
  return { bridge, app: createApp({ auth, googleEnabled: false, bridge, allowedOrigins: ["https://app.meowlab.tech"] }) };
}

describe("company routes (ADR-0010)", () => {
  it("includes the account's companies in /api/me, or null when the bridge cannot answer", async () => {
    const withCompanies = app(async () => ({ status: "ok", companies: [membership] }));
    expect((await (await withCompanies.app.request("/api/me")).json() as { companies: unknown }).companies).toEqual([membership]);
    const down = app(async () => null);
    expect((await (await down.app.request("/api/me")).json() as { companies: unknown }).companies).toBeNull();
  });

  it("validates the RUC before asking the bridge", async () => {
    const { app: api, bridge } = app(async () => ({ status: "ok", taxpayer: { ruc: "20557288016", legalName: "AGU", address: null, status: "ACTIVO", condition: null } }));
    expect(await (await api.request("/api/companies/lookup?ruc=2055")).json()).toEqual({ status: "invalid_ruc" });
    expect(await (await api.request("/api/companies/lookup?ruc=20557288016")).json()).toMatchObject({ status: "ok" });
    expect(bridge.companies).toHaveBeenCalledWith("user-1", { action: "lookup", ruc: "20557288016" });
  });

  it("limits lookups per account", async () => {
    const { app: api } = app(async () => ({ status: "not_found" }));
    for (let i = 0; i < 20; i++) expect((await api.request("/api/companies/lookup?ruc=20557288016")).status).toBe(200);
    expect((await api.request("/api/companies/lookup?ruc=20557288016")).status).toBe(429);
  });

  it("creates with the RUC and an optional trimmed name, and needs a same-site origin", async () => {
    const { app: api, bridge } = app(async () => ({ status: "created", company: membership }));
    const post = (body: unknown, headers: Record<string, string> = ORIGIN) =>
      api.request("/api/companies", { method: "POST", headers, body: JSON.stringify(body) });
    expect((await post({ ruc: "20557288016" }, { "Content-Type": "application/json" })).status).toBe(403);
    expect(await (await post({ ruc: "20557288016", name: "  Agu   Bello " })).json()).toEqual({ status: "created", company: membership });
    expect(bridge.companies).toHaveBeenLastCalledWith("user-1", { action: "create", ruc: "20557288016", name: "Agu Bello" });
    await post({ ruc: "20557288016", legalName: "Otra S.A.C." });
    expect(bridge.companies).toHaveBeenLastCalledWith("user-1", { action: "create", ruc: "20557288016" });
    expect((await post({ ruc: "20557288016", name: "x".repeat(161) })).status).toBe(400);
    expect(await (await post({ ruc: "abc" })).json()).toEqual({ status: "invalid_ruc" });
  });
});
