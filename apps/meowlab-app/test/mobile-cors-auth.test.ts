import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app";
import type { Auth } from "../server/auth";
import type { PortalBridge } from "../server/bridge";

const USER_TOKENS: Record<string, { user: { id: string; name: string; email: string; image: null }; session: { id: string } }> = {
  "Bearer token-user-a": { user: { id: "user-a", name: "Ana", email: "ana@test.pe", image: null }, session: { id: "sa" } },
  "Bearer token-user-b": { user: { id: "user-b", name: "Beto", email: "beto@test.pe", image: null }, session: { id: "sb" } },
};

function setup(allowedOrigins = ["https://app.meowlab.tech", "https://localhost"]) {
  const auth = {
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const authHeader = headers.get("authorization") ?? "";
        return USER_TOKENS[authHeader] ?? null;
      },
    },
    handler: async () => new Response(null),
  } as unknown as Auth;

  const bridge: PortalBridge = {
    link: vi.fn(async () => ({ status: "not_linked" as const })),
    billing: vi.fn(async () => ({ status: "not_linked" as const })),
    companies: vi.fn(async (userId, req) => {
      if (req.action === "mine") {
        return {
          status: "ok",
          companies: userId === "user-a"
            ? [{ id: "company-a", name: "Empresa A", legalName: null, ruc: "20111111111", role: "owner", invoicing: "needs_sol" }]
            : [{ id: "company-b", name: "Empresa B", legalName: null, ruc: "20222222222", role: "owner", invoicing: "needs_sol" }],
        };
      }
      if (req.action === "team") {
        return userId === "user-a" && req.tenantId === "company-a"
          ? { status: "ok", team: { members: [], invitations: [] } }
          : { status: "forbidden" };
      }
      return { status: "ok", companies: [] };
    }),
  };

  return createApp({ auth, googleEnabled: false, bridge, allowedOrigins });
}

describe("Capacitor mobile CORS and Bearer token isolation", () => {
  it("allows CORS preflight and responses only for https://localhost without credentials", async () => {
    const app = setup();

    const preflight = await app.request("/api/me", {
      method: "OPTIONS",
      headers: { Origin: "https://localhost" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("https://localhost");
    expect(preflight.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
    expect(preflight.headers.get("Access-Control-Allow-Credentials")).toBeNull();

    const getMe = await app.request("/api/me", {
      headers: { Origin: "https://localhost", Authorization: "Bearer token-user-a" },
    });
    expect(getMe.status).toBe(200);
    expect(getMe.headers.get("Access-Control-Allow-Origin")).toBe("https://localhost");
    expect(getMe.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("rejects CORS preflight and omits CORS headers for any other origin", async () => {
    const app = setup();

    const evilPreflight = await app.request("/api/me", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example" },
    });
    expect(evilPreflight.status).toBe(403);
    expect(evilPreflight.headers.get("Access-Control-Allow-Origin")).toBeNull();

    const evilGet = await app.request("/api/me", {
      headers: { Origin: "https://evil.example", Authorization: "Bearer token-user-a" },
    });
    expect(evilGet.headers.get("Access-Control-Allow-Origin")).toBeNull();

    const evilPost = await app.request("/api/companies", {
      method: "POST",
      headers: { Origin: "https://evil.example", Authorization: "Bearer token-user-a", "Content-Type": "application/json" },
      body: JSON.stringify({ ruc: "20111111111" }),
    });
    expect(evilPost.status).toBe(403);
  });

  it("prevents a bearer token of one user from accessing another user's company", async () => {
    const app = setup();

    const ownTeam = await app.request("/api/companies/company-a/team", {
      headers: { Origin: "https://localhost", Authorization: "Bearer token-user-a" },
    });
    expect(ownTeam.status).toBe(200);

    const crossTeam = await app.request("/api/companies/company-a/team", {
      headers: { Origin: "https://localhost", Authorization: "Bearer token-user-b" },
    });
    expect(crossTeam.status).toBe(403);
  });
});
