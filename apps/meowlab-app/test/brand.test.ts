import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app";
import type { Auth } from "../server/auth";
import type { PortalBridge, PortalCompanyResponse } from "../server/bridge";

const session = { user: { id: "user-1", name: "Ana", email: "ana@test.pe", image: null }, session: { id: "s1" } };
const ORIGIN = "https://app.meowlab.tech";
const TOKEN = "AbCdEfGhIjKlMnOpQrStUv";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const logo = { mimeType: "image/png", contentBase64: btoa(String.fromCharCode(...PNG)), version: "abcdef0123456789" };

function app(companies: (userId: string, request: unknown) => Promise<PortalCompanyResponse | null>, signedIn = true) {
  const auth = { api: { getSession: async () => (signedIn ? session : null) }, handler: async () => new Response(null) } as unknown as Auth;
  const bridge: PortalBridge = {
    link: vi.fn(async () => ({ status: "not_linked" as const })),
    billing: vi.fn(async () => ({ status: "not_linked" as const })),
    companies: vi.fn(companies),
    publicQuoteLogo: vi.fn(async (token: string) => (token === TOKEN ? { status: "ok" as const, logo } : { status: "not_found" as const })),
  };
  return { bridge, app: createApp({ auth, googleEnabled: false, bridge, allowedOrigins: [ORIGIN] }) };
}

describe("brand kit routes (ADR-0012)", () => {
  it("relays reads and saves for the signed-in account", async () => {
    const { app: api, bridge } = app(async () => ({ status: "ok", brand: {} as never, canEdit: true }));
    expect((await api.request("/api/companies/org_1/brand")).status).toBe(200);
    const saved = await api.request("/api/companies/org_1/brand", {
      method: "PUT", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify({ footerText: "Gracias" }),
    });
    expect(saved.status).toBe(200);
    expect(bridge.companies).toHaveBeenLastCalledWith("user-1", { action: "brand_save", tenantId: "org_1", kit: { footerText: "Gracias" } });
  });

  it("refuses other origins, oversized bodies and non-objects", async () => {
    const { app: api, bridge } = app(async () => ({ status: "ok", brand: {} as never, canEdit: true }));
    const foreign = await api.request("/api/companies/org_1/brand", { method: "PUT", headers: { Origin: "https://evil.example" }, body: "{}" });
    expect(foreign.status).toBe(403);
    const big = await api.request("/api/companies/org_1/brand", { method: "PUT", headers: { Origin: ORIGIN }, body: JSON.stringify({ footerText: "x".repeat(20_000) }) });
    expect(big.status).toBe(400);
    const list = await api.request("/api/companies/org_1/brand", { method: "PUT", headers: { Origin: ORIGIN }, body: "[]" });
    expect(list.status).toBe(400);
    expect(bridge.companies).not.toHaveBeenCalled();
  });

  it("uploads only PNG or JPEG under 300 KB, as base64 to the bridge", async () => {
    const { app: api, bridge } = app(async () => ({ status: "ok", brand: {} as never, canEdit: true }));
    const svg = await api.request("/api/companies/org_1/brand/logo", { method: "PUT", headers: { Origin: ORIGIN, "Content-Type": "image/svg+xml" }, body: "<svg/>" });
    expect(svg.status).toBe(400);
    const huge = await api.request("/api/companies/org_1/brand/logo", {
      method: "PUT", headers: { Origin: ORIGIN, "Content-Type": "image/png" }, body: new Uint8Array(300 * 1024 + 1),
    });
    expect(huge.status).toBe(413);
    const ok = await api.request("/api/companies/org_1/brand/logo", { method: "PUT", headers: { Origin: ORIGIN, "Content-Type": "image/png" }, body: PNG });
    expect(ok.status).toBe(200);
    expect(bridge.companies).toHaveBeenCalledTimes(1);
    expect(bridge.companies).toHaveBeenLastCalledWith("user-1", { action: "brand_logo_put", tenantId: "org_1", contentBase64: logo.contentBase64 });
  });

  it("serves the logo as a non-sniffable image", async () => {
    const { app: api } = app(async () => ({ status: "ok", logo }));
    const response = await api.request("/api/companies/org_1/brand/logo");
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cache-Control")).toContain("private");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
    const forbidden = app(async () => ({ status: "forbidden" }));
    expect((await forbidden.app.request("/api/companies/org_1/brand/logo")).status).toBe(403);
  });

  it("serves a quote's logo without a session, only for a valid code", async () => {
    const { app: api } = app(async () => null, false);
    const response = await api.request(`/api/public/quotes/${TOKEN}/logo`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("public");
    expect((await api.request("/api/public/quotes/ZzZzZzZzZzZzZzZzZzZzZz/logo")).status).toBe(404);
    expect((await api.request("/api/public/quotes/short/logo")).status).toBe(404);
  });
});
