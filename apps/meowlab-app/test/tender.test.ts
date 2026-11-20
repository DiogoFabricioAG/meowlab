import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app";
import type { Auth } from "../server/auth";
import type { PortalBridge } from "../server/bridge";
import { createTenderService } from "../server/tender";

const origin = "https://portal.example";
const path = "/api/companies/company-a/tender/";
function setup(send: typeof fetch, loggedIn = true) {
  const auth = { api: { getSession: async () => loggedIn ? { user: { id: "tester" } } : null } } as unknown as Auth;
  const bridge = { companies: async () => ({ status: "ok", companies: [{ id: "company-a", role: "member" }] }) } as unknown as PortalBridge;
  return createApp({ auth, bridge, googleEnabled: false, allowedOrigins: [origin],
    tender: createTenderService("http://private-tender", "test-only", send) });
}

describe("Tender Cat through the portal", () => {
  it("requires a session, membership and a trusted Origin before accessing the private service", async () => {
    const send = vi.fn();
    const api = setup(send);
    expect((await setup(send, false).request(path + "opportunities")).status).toBe(401);
    expect((await api.request(path.replace("company-a", "company-b") + "opportunities")).status).toBe(403);
    expect((await api.request(path + "opportunities/a/bases", { method: "POST" })).status).toBe(403);
    expect((await api.request(path + "session")).status).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });

  it("streams files with server credentials and the verified company, preserving the upload name and export bytes", async () => {
    const bytes = new Uint8Array([0, 36, 255, 13]);
    const send = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe("http://private-tender/api/workspace/opportunities/a/bases?filename=bases+1.pdf");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer test-only");
      expect(headers.get("x-meowlab-company")).toBe("company-a");
      expect(headers.get("cookie")).toBeNull();
      expect(new Uint8Array(await new Response(init?.body).arrayBuffer())).toEqual(bytes);
      return new Response(bytes, { headers: { "content-disposition": "attachment", "set-cookie": "private=x" } });
    });
    const result = await setup(send).request(path + "opportunities/a/bases?filename=bases%201.pdf&company=untrusted", {
      method: "POST", body: bytes, headers: { origin, cookie: "portal=x", authorization: "client", "x-meowlab-company": "untrusted" },
    });
    expect(result.status).toBe(200);
    expect(result.headers.get("set-cookie")).toBeNull();
    expect(result.headers.get("content-disposition")).toBe("attachment");
    expect(new Uint8Array(await result.arrayBuffer())).toEqual(bytes);
  });

  it("forwards the replace query parameter when replacing uploaded bases", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70]);
    const send = vi.fn<typeof fetch>(async (url) => {
      expect(String(url)).toBe(
        "http://private-tender/api/workspace/opportunities/a/bases?filename=nueva.pdf&replace=base-1",
      );
      return Response.json({ id: "a", basesUploaded: true });
    });
    const result = await setup(send).request(
      path + "opportunities/a/bases?filename=nueva.pdf&replace=base-1&extra=ignored",
      { method: "POST", body: bytes, headers: { origin } },
    );
    expect(result.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("returns version conflicts to the editor and hides private service errors", async () => {
    const send = vi.fn().mockResolvedValueOnce(Response.json({ detail: "draft conflict" }, { status: 409 }))
      .mockResolvedValueOnce(new Response("internal details", { status: 500 }));
    const api = setup(send);
    const conflict = await api.request(path + "opportunities/a", { method: "PUT", headers: { origin } });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ detail: "draft conflict" });
    const failure = await api.request(path + "opportunities");
    expect(failure.status).toBe(503);
    expect(await failure.json()).toEqual({ error: "tender_unavailable" });
  });
});
