import { env } from "cloudflare:test";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { radarHttp } from "../src/radar/http";
import { editorialWriter } from "./radar-editorial-fixture";
import { radarVerifiedWebhook } from "../src/radar/webhook";
import { signBridgePayload } from "../src/bridge/signature";

const phone = "1266091906580349", user = "51955555555", secret = "radar-test-hmac-secret-32-characters";
const candidate = { alert: { ocid: "ocds-test-1258591", code: "TEST", description: "Chalecos", buyer: "Entidad", amount: "Monto por confirmar", deadline: "2026-11-03", sourceUrl: "https://contratacionesabiertas.oece.gob.pe" } };
let time: number;
const apiEnv = () => ({ ...env, META_ACCESS_TOKEN: "test", META_APP_SECRET: "test", META_GRAPH_API_VERSION: "v25.0", VPS_BRIDGE_ENABLED: "true",
  VPS_BRIDGE_API_URL: "https://bridge.test/internal/manolo", VPS_BRIDGE_HMAC_SECRET: secret } as unknown as Env);
const call = (path: string, token = "", body?: unknown) => radarHttp(new Request(`https://test/v1/projects/radar${path}`, {
  method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${token}`, "CF-Connecting-IP": crypto.randomUUID() },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), apiEnv(), () => time, editorialWriter);
beforeEach(async () => {
  time = Date.parse("2026-10-31T15:00:00Z");
  await env.DB.batch(["radar_deliveries", "radar_installations", "radar_windows", "radar_inbound", "radar_rate_limits"].map(t => env.DB.prepare(`DELETE FROM ${t}`)));
  await env.DB.prepare("UPDATE radar_settings SET enabled=1,phone_number_id=?,public_number=? WHERE id=1").bind(phone, user).run();
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    const data = JSON.parse(String(init?.body ?? "{}"));
    if (data.messaging_product) return Response.json({ messages: [{ id: "wamid.link" }] });
    return Response.json({ version: 1, requestId: data.requestId, status: "ok",
      ...(data.operation === "publish_candidates" ? { published: data.candidates.length } : data.operation === "pull_changes" ? { changes: [], cursor: data.after } : { ackedCursor: data.cursor }) });
  }));
});
afterEach(() => vi.unstubAllGlobals());
async function linked() {
  const r = await (await call("/installations", "", {})).json() as { token: string; installationId: string; message: string };
  await radarVerifiedWebhook({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: phone },
    messages: [{ id: crypto.randomUUID(), from: user, timestamp: String(time / 1000), type: "text", text: { body: r.message } }] } }] }] }, apiEnv(), () => time);
  vi.mocked(fetch).mockClear(); return r;
}
it("derives tenant/contact/installation from the bearer and signs the existing VPS bridge contract", async () => {
  const r = await linked();
  expect(await (await call("/candidates", r.token, { requestId: "publish-1", candidates: [candidate], tenantId: "foreign", whatsappUserId: "51988888888" })).json())
    .toMatchObject({ status: "ok", published: 1 });
  const [url, init] = vi.mocked(fetch).mock.calls[0]!;
  expect(String(url)).toBe("https://bridge.test/internal/manolo/v1/roles/radar/sync");
  const wire = JSON.parse(String(init!.body));
  expect(wire).toMatchObject({ tenantId: "manolo", whatsappUserId: user, installationId: r.installationId, operation: "publish_candidates" });
  const headers = new Headers(init!.headers);
  expect(headers.get("X-Manolo-Signature")).toBe(await signBridgePayload(secret, headers.get("X-Manolo-Timestamp")!, String(init!.body)));
  expect(init!.redirect).toBe("manual");
});
it("synchronizes selections and candidates with closed message window, without sending Meta messages", async () => {
  const r = await linked(); time += 86400000;
  expect((await call("/sync?after=0&limit=100", r.token)).status).toBe(200);
  expect((await call("/sync/ack", r.token, { requestId: "ack-1", cursor: 0 })).status).toBe(200);
  expect((await call("/candidates", r.token, { requestId: "publish-1", candidates: [candidate] })).status).toBe(200);
  expect(vi.mocked(fetch).mock.calls.every(([url]) => !String(url).includes("graph.facebook.com"))).toBe(true);
});
it("rejects revoked bearer, bad cursor, unlinked account and invalid/public-secret candidate content", async () => {
  const r = await linked();
  expect((await call("/sync?after=-1", r.token)).status).toBe(400);
  expect((await call("/candidates", r.token, { requestId: "bad", candidates: [{ alert: { ...candidate.alert, sourceUrl: "http://localhost/private" } }] })).status).toBe(400);
  await call("/revoke", r.token, {}); vi.mocked(fetch).mockClear();
  expect((await call("/sync", r.token)).status).toBe(401); expect(fetch).not.toHaveBeenCalled();
});
it("never accepts a mismatched or uncertain bridge response as persisted", async () => {
  const r = await linked();
  vi.mocked(fetch).mockResolvedValue(Response.json({ version: 1, requestId: "wrong", status: "ok", published: 1 }));
  expect((await call("/candidates", r.token, { requestId: "actual", candidates: [candidate] })).status).toBe(503);
});

it("publishes an older client's alert snapshot before Meta, without a separate candidates call", async () => {
  const r = await linked();
  expect(await (await call("/alerts", r.token, candidate.alert)).json()).toMatchObject({ status: "accepted" });
  const calls = vi.mocked(fetch).mock.calls;
  expect(String(calls[0]![0])).toContain("/v1/roles/radar/sync");
  expect(JSON.parse(String(calls[0]![1]!.body)).candidates).toEqual([candidate]);
  expect(String(calls[1]![0])).toContain("graph.facebook.com");
  vi.mocked(fetch).mockClear();
  expect(await (await call("/alerts", r.token, candidate.alert)).json()).toMatchObject({ status: "accepted", replayed: true });
  expect(vi.mocked(fetch).mock.calls.every(([url]) => !String(url).includes("graph.facebook.com"))).toBe(true);
});

it("a failed candidate publication leaves a safe pre-Meta rejection for later retry", async () => {
  const r = await linked(); vi.mocked(fetch).mockResolvedValue(new Response("unavailable", { status: 503 }));
  expect((await call("/alerts", r.token, candidate.alert)).status).toBe(503);
  expect(vi.mocked(fetch).mock.calls.every(([url]) => !String(url).includes("graph.facebook.com"))).toBe(true);
  expect(await env.DB.prepare("SELECT state,provider_message_id FROM radar_deliveries").first()).toEqual({ state: "rejected", provider_message_id: null });
});
