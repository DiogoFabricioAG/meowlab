import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app";
import type { Auth } from "../server/auth";
import type { PortalBridge, PortalCompanyResponse } from "../server/bridge";

const session = { user: { id: "owner-1", name: "Ana", email: "ana@test.pe", image: null }, session: { id: "s1" } };
const ORIGIN = { Origin: "https://app.meowlab.tech", "Content-Type": "application/json" };
const TOKEN = "AbCdEfGhIjKlMnOpQrStUv";

function app(companies: (userId: string, request: Record<string, unknown>) => Promise<PortalCompanyResponse | null>) {
  const auth = { api: { getSession: async () => session }, handler: async () => new Response(null) } as unknown as Auth;
  const bridge: PortalBridge = {
    link: vi.fn(async () => ({ status: "not_linked" as const })),
    billing: vi.fn(async () => ({ status: "not_linked" as const })),
    companies: vi.fn(companies as PortalBridge["companies"]),
  };
  const users = vi.fn(async (ids: string[]) => new Map(ids.filter((id) => id !== "ghost").map((id) => [id, { name: `Nombre ${id}`, email: `${id}@test.pe` }])));
  return { bridge, users, app: createApp({ auth, googleEnabled: false, bridge, users, appUrl: "https://app.meowlab.tech/",
    allowedOrigins: ["https://app.meowlab.tech"] }) };
}

describe("invitation routes (ADR-0010, phase 2)", () => {
  it("returns the link once, built from the code, without the raw code field", async () => {
    const { app: api, bridge } = app(async () => ({ status: "invited", invitation: { id: "i1", token: TOKEN, createdAt: "x",
      expiresAt: "2026-11-20T05:00:00.000Z", maskedPhone: null, access: "view" } }));
    const response = await api.request("/api/companies/org_1/invitations", { method: "POST", headers: ORIGIN, body: JSON.stringify({ access: "view", phone: " 987654321 " }) });
    const body = await response.json() as { invitation: Record<string, unknown> };
    expect(body.invitation.url).toBe(`https://app.meowlab.tech/invitacion/${TOKEN}`);
    expect(body.invitation).not.toHaveProperty("token");
    expect(bridge.companies).toHaveBeenCalledWith("owner-1", { action: "invite", tenantId: "org_1", access: "view", phone: "987654321" });
  });

  it("validates inputs before reaching the bridge", async () => {
    const { app: api, bridge } = app(async () => ({ status: "forbidden" }));
    const post = (path: string, body: unknown = {}) => api.request(path, { method: "POST", headers: ORIGIN, body: JSON.stringify(body) });
    expect((await post("/api/companies/org_1/invitations", { access: "admin" })).status).toBe(400);
    expect((await post("/api/companies/org%201/invitations", { access: "view" })).status).toBe(400);
    expect((await post("/api/companies/org_1/invitations/not-a-uuid/revoke")).status).toBe(400);
    expect(await (await api.request("/api/invitations/short")).json()).toEqual({ status: "invalid" });
    expect(await (await post("/api/invitations/../accept")).json().catch(() => null)).not.toEqual({ status: "joined" });
    expect(bridge.companies).not.toHaveBeenCalled();
  });

  it("maps a non-owner to 403 and enriches the team with names", async () => {
    const forbidden = app(async () => ({ status: "forbidden" }));
    expect((await forbidden.app.request("/api/companies/org_1/team")).status).toBe(403);
    const { app: api } = app(async () => ({ status: "ok", team: {
      members: [{ portalUserId: "owner-1", role: "owner", joinedAt: "a" }, { portalUserId: "ghost", role: "member", joinedAt: "b" }],
      invitations: [] } }));
    const body = await (await api.request("/api/companies/org_1/team")).json() as { members: Array<Record<string, unknown>> };
    expect(body.members).toEqual([
      { id: "owner-1", role: "owner", joinedAt: "a", name: "Nombre owner-1", email: "owner-1@test.pe", you: true },
      { id: "ghost", role: "member", joinedAt: "b", name: "Cuenta de MeowLab", email: null, you: false },
    ]);
  });

  it("shows who invited, not their account id, and accepts with a same-site origin", async () => {
    const { app: api, bridge } = app(async (_user, request) => request.action === "preview"
      ? { status: "ok", invitation: { companyName: "Agu", invitedBy: "owner-9", expiresAt: "e", maskedPhone: null, alreadyMember: false } }
      : { status: "joined", company: { id: "org_1", name: "Agu", legalName: null, ruc: null, role: "member", invoicing: "needs_sol" } });
    const preview = await (await api.request(`/api/invitations/${TOKEN}`)).json() as { invitation: Record<string, unknown> };
    expect(preview.invitation).toEqual({ companyName: "Agu", expiresAt: "e", maskedPhone: null, alreadyMember: false, invitedByName: "Nombre owner-9" });
    expect((await api.request(`/api/invitations/${TOKEN}/accept`, { method: "POST" })).status).toBe(403);
    expect(await (await api.request(`/api/invitations/${TOKEN}/accept`, { method: "POST", headers: ORIGIN })).json()).toMatchObject({ status: "joined" });
    expect(bridge.companies).toHaveBeenLastCalledWith("owner-1", { action: "accept", token: TOKEN });
  });
});

describe("weekly route", () => {
  it("relays the week for members and maps a stranger to 403", async () => {
    const weekly = { week: { start: "2026-11-09", end: "2026-11-15" }, team: { members: 1, messages: 2, activePeople: 1, previousMessages: 0 },
      tender: { found: 0, interesting: 0, highlights: [] }, invoicing: null };
    const ok = app(async () => ({ status: "ok", weekly }));
    expect(await (await ok.app.request("/api/companies/org_1/weekly")).json()).toEqual(weekly);
    expect(ok.bridge.companies).toHaveBeenCalledWith("owner-1", { action: "weekly", tenantId: "org_1" });
    expect((await app(async () => ({ status: "forbidden" })).app.request("/api/companies/org_1/weekly")).status).toBe(403);
    expect((await app(async () => null).app.request("/api/companies/org_1/weekly")).status).toBe(503);
  });
});
