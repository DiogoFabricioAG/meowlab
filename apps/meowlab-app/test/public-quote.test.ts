import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app";
import type { Auth } from "../server/auth";
import type { PortalBridge } from "../server/bridge";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUv";
const PDF = new TextEncoder().encode("%PDF-1.4 ".padEnd(300, "x"));
const pdf = { number: 7, filename: "Cotizacion-000007.pdf", contentBase64: btoa(String.fromCharCode(...PDF)) };

function app(publicQuote: PortalBridge["publicQuote"]) {
  // No session at all: the quote link is public.
  const auth = { api: { getSession: async () => null }, handler: async () => new Response(null) } as unknown as Auth;
  const bridge = { link: vi.fn(), billing: vi.fn(), companies: vi.fn(), publicQuote: vi.fn(publicQuote) } as unknown as PortalBridge;
  return { bridge, app: createApp({ auth, googleEnabled: false, bridge, allowedOrigins: ["https://app.meowlab.tech"] }) };
}

describe("public quote link (ADR-0011, ADR-0013)", () => {
  it("opens the quote's PDF inline without a session and keeps it out of search engines and shared caches", async () => {
    const { app: api } = app(async () => ({ status: "ok", pdf }));
    const response = await api.request(`/cotizacion/${TOKEN}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe('inline; filename="Cotizacion-000007.pdf"');
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=86400");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF);
  });

  it("shows a plain page for malformed or unknown codes and when the bridge is down", async () => {
    const missing = app(async () => ({ status: "not_found" }));
    const short = await missing.app.request("/cotizacion/short");
    expect(short.status).toBe(404);
    expect(await short.text()).toContain("Esta cotización no existe");
    expect(missing.bridge.publicQuote).not.toHaveBeenCalled();
    expect((await missing.app.request(`/cotizacion/${TOKEN}`)).status).toBe(404);
    const down = await app(async () => null).app.request(`/cotizacion/${TOKEN}`);
    expect(down.status).toBe(503);
    expect(down.headers.get("Content-Type")).toContain("text/html");
    // Anything that is not a PDF never reaches the browser as one.
    const bogus = await app(async () => ({ status: "ok", pdf: { ...pdf, contentBase64: btoa("<html>".padEnd(200)) } })).app.request(`/cotizacion/${TOKEN}`);
    expect(bogus.status).toBe(503);
  });
});
