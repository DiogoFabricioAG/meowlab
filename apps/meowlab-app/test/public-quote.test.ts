import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app";
import type { Auth } from "../server/auth";
import type { PortalBridge } from "../server/bridge";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUv";
const quote = { company: { name: "J&D", legalName: null, ruc: "20601234565", address: null }, number: 1, issuedAt: "2026-11-13T15:00:00Z",
  validUntil: "2026-11-20", customerName: "Comercial Lima", subtotalCents: 15000, discountCents: 0, totalCents: 15000, notes: null,
  lines: [{ description: "Volantes", quantity: 100, unitPriceCents: 150, totalCents: 15000 }] };

function app(publicQuote: PortalBridge["publicQuote"]) {
  // No session at all: the quote page is public.
  const auth = { api: { getSession: async () => null }, handler: async () => new Response(null) } as unknown as Auth;
  const bridge = { link: vi.fn(), billing: vi.fn(), companies: vi.fn(), publicQuote: vi.fn(publicQuote) } as unknown as PortalBridge;
  return { bridge, app: createApp({ auth, googleEnabled: false, bridge, allowedOrigins: ["https://app.meowlab.tech"] }) };
}

describe("public quote route (ADR-0011)", () => {
  it("serves a quote without a session and keeps it out of search engines", async () => {
    const { app: api } = app(async () => ({ status: "ok", quote }));
    const response = await api.request(`/api/public/quotes/${TOKEN}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(await response.json()).toEqual(quote);
  });

  it("answers 404 for malformed or unknown codes and 503 when the bridge is down", async () => {
    const missing = app(async () => ({ status: "not_found" }));
    expect((await missing.app.request("/api/public/quotes/short")).status).toBe(404);
    expect(missing.bridge.publicQuote).not.toHaveBeenCalled();
    expect((await missing.app.request(`/api/public/quotes/${TOKEN}`)).status).toBe(404);
    expect((await app(async () => null).app.request(`/api/public/quotes/${TOKEN}`)).status).toBe(503);
  });
});
