import { describe, expect, it, vi } from "vitest";
import { apiUrl, createApiFetch } from "../web/src/api";

describe("apiUrl and apiFetch", () => {
  it("keeps relative paths and same-origin cookies when VITE_API_ORIGIN is empty on web", async () => {
    expect(apiUrl("/api/me", "")).toBe("/api/me");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const apiFetch = createApiFetch({
      origin: "",
      native: () => false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await apiFetch("/api/me");
    expect(fetchImpl).toHaveBeenCalledWith("/api/me", { credentials: "same-origin" });
  });

  it("prepends VITE_API_ORIGIN, omits cookies and attaches Bearer token on Capacitor native", async () => {
    expect(apiUrl("/api/me", "https://app.meowlab.tech/")).toBe("https://app.meowlab.tech/api/me");
    const saveToken = vi.fn(async () => {});
    const clearToken = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "set-auth-token": "rotated-token" },
      }),
    );
    const apiFetch = createApiFetch({
      origin: "https://app.meowlab.tech",
      native: () => true,
      getToken: async () => "stored-token",
      saveToken,
      clearToken,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await apiFetch("/api/companies/c1/collections", { method: "POST", body: "{}" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://app.meowlab.tech/api/companies/c1/collections",
      expect.objectContaining({
        method: "POST",
        credentials: "omit",
        body: "{}",
      }),
    );
    const callInit = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(new Headers(callInit.headers).get("Authorization")).toBe("Bearer stored-token");
    expect(saveToken).toHaveBeenCalledWith("rotated-token");
    expect(clearToken).not.toHaveBeenCalled();
  });

  it("clears the stored token when native requests receive 401", async () => {
    const clearToken = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401 }));
    const apiFetch = createApiFetch({
      origin: "https://app.meowlab.tech",
      native: () => true,
      getToken: async () => "expired-token",
      clearToken,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const response = await apiFetch("/api/me");
    expect(response.status).toBe(401);
    expect(clearToken).toHaveBeenCalledOnce();
  });
});
