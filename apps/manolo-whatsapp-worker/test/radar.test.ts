import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import worker from "../src/index";
import { radarHttp } from "../src/radar/http";
import { editorialWriter } from "./radar-editorial-fixture";
import { radarVerifiedWebhook } from "../src/radar/webhook";
import { RADAR_API_PATH } from "../src/radar/contracts";

let time = Date.parse("2026-10-18T14:00:00Z");
const phone = "123456";
const recipient = "51999999999";
const apiEnv = (): Env => ({ ...env, VPS_BRIDGE_ENABLED: "false", META_ACCESS_TOKEN: "test-token", META_APP_SECRET: "test-secret", META_GRAPH_API_VERSION: "v25.0" });
const alert = { ocid: "ocds-test-1", code: "CONV-TEST", description: "Papel bond A4", buyer: "Entidad ficticia",
  amount: "PEN 12000", deadline: "2026-10-25", sourceUrl: "https://contratacionesabiertas.oece.gob.pe" };
async function call(path: string, method = "GET", token = "", body?: unknown, ip = "test-client") {
  return radarHttp(new Request(`https://example.test${RADAR_API_PATH}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, "CF-Connecting-IP": ip, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), apiEnv(), () => time, editorialWriter);
}
async function register(ip?: string): Promise<{ token: string; message: string; installationId: string }> {
  const response = await call("/installations", "POST", "", undefined, ip);
  expect(response.status).toBe(201);
  return response.json();
}
function payload(text = "Hola", id: string = crypto.randomUUID(), timestamp = time, from = recipient, number = phone) {
  return { object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: {
    metadata: { phone_number_id: number }, messages: [{ id, from, timestamp: String(Math.floor(timestamp / 1000)), type: "text", text: { body: text } }],
  } }] }] };
}
async function inbound(text: string, id?: string, timestamp?: number, from?: string, number?: string) {
  return radarVerifiedWebhook(payload(text, id, timestamp, from, number), apiEnv(), () => time);
}
async function linked() {
  const registration = await register();
  const routed = await inbound(registration.message);
  expect(routed.entry[0].changes[0].value.messages).toHaveLength(0);
  return registration;
}

beforeEach(async () => {
  time = Date.parse("2026-10-18T14:00:00Z");
  await env.DB.batch(["radar_deliveries", "radar_installations", "radar_windows", "radar_inbound", "radar_rate_limits"].map(
    table => env.DB.prepare(`DELETE FROM ${table}`)));
  await env.DB.prepare("UPDATE radar_settings SET enabled=1,phone_number_id=?,public_number=? WHERE id=1").bind(phone, recipient).run();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ messages: [{ id: `wamid.${crypto.randomUUID()}` }] })));
});
afterEach(() => { vi.unstubAllGlobals(); });

it("bootstrap stores hashes; linking uses actual WhatsApp sender and never changes roles", async () => {
  const rolesBefore = (await env.DB.prepare("SELECT * FROM contacts").all()).results;
  const registration = await register();
  const row = await env.DB.prepare("SELECT * FROM radar_installations WHERE id=?").bind(registration.installationId).first();
  expect(JSON.stringify(row)).not.toContain(registration.token);
  expect(JSON.stringify(row)).not.toContain(registration.message.split(" ")[2]);
  expect((await (await call("/status", "GET", registration.token)).json() as any).linked).toBe(false);
  await inbound(registration.message);
  const status = await (await call("/status", "GET", registration.token)).json() as any;
  expect(status).toMatchObject({ linked: true, open: true, recipient: "***9999", expiresAt: time + 86_400_000 });
  expect((await env.DB.prepare("SELECT * FROM contacts").all()).results).toEqual(rolesBefore);
  expect((await call("/status", "GET", "0".repeat(64))).status).toBe(401);
});

it("normal messages keep their route; RADAR commands and replays are consumed once", async () => {
  const r = await register();
  const id = crypto.randomUUID();
  await inbound(r.message, id);
  const count = vi.mocked(fetch).mock.calls.length;
  const duplicate = await inbound(r.message, id);
  expect(duplicate.entry[0].changes[0].value.messages).toHaveLength(0);
  expect(vi.mocked(fetch).mock.calls).toHaveLength(count);
  time += 1000;
  const ordinary = await inbound("Necesito una factura");
  expect(ordinary.entry[0].changes[0].value.messages[0].text.body).toBe("Necesito una factura");
  expect((await (await call("/status", "GET", r.token)).json() as any).expiresAt).toBe(time + 86_400_000);
});

it("link controls tolerate WhatsApp whitespace and never fall through to fiscal roles", async () => {
  const r = await register();
  const spaced = r.message.replace("RADAR ACTIVAR ", "radar\nactivar\u00a0");
  expect((await inbound(spaced)).entry[0].changes[0].value.messages).toHaveLength(0);
  expect((await (await call("/status", "GET", r.token)).json() as any).linked).toBe(true);
  const malformed = await inbound("RADAR\nACTIVAR invalid");
  expect(malformed.entry[0].changes[0].value.messages).toHaveLength(0);
  const futureControl = await inbound(r.message, undefined, time + 60_000);
  expect(futureControl.entry[0].changes[0].value.messages).toHaveLength(0);
  const ordinary = await inbound("Necesito una factura");
  expect(ordinary.entry[0].changes[0].value.messages[0].text.body).toBe("Necesito una factura");
});

it("uses outbound request options supported by the real Workers runtime", async () => {
  const registration = await linked();
  await call("/alerts", "POST", registration.token, alert);
  expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThanOrEqual(2);
  for (const [url, options] of vi.mocked(fetch).mock.calls) {
    if (!String(url).startsWith("https://graph.facebook.com/")) continue;
    // Mocking fetch alone misses Workers' RequestInit validation before network I/O.
    expect(() => new Request(String(url), options)).not.toThrow();
  }
});

it("does not follow Meta redirects or forward credentials to their destination", async () => {
  const registration = await linked();
  vi.mocked(fetch).mockClear();
  vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 302, headers: { Location: "https://example.invalid/collect" } }));
  const response = await call("/alerts", "POST", registration.token, alert);
  expect(await response.json()).toMatchObject({ status: "rejected" });
  expect(fetch).toHaveBeenCalledOnce();
  expect(vi.mocked(fetch).mock.calls[0]?.[1]?.redirect).toBe("manual");
});

it("pairing expires, is single-use and cannot transfer to another WhatsApp sender", async () => {
  const r = await register();
  time += 600_000;
  await inbound(r.message);
  expect((await (await call("/status", "GET", r.token)).json() as any).linked).toBe(false);
  const newPair = await (await call("/pairing", "POST", r.token)).json() as any;
  await inbound(newPair.message);
  await inbound(newPair.message, undefined, undefined, "51988888888");
  const row = await env.DB.prepare("SELECT recipient FROM radar_installations WHERE id=?").bind(r.installationId).first();
  expect(row?.recipient).toBe(recipient);
});

it("refuses sends without binding, outside exact 24h, to another recipient or unsafe source", async () => {
  const r = await register();
  expect((await call("/alerts", "POST", r.token, alert)).status).toBe(403);
  await inbound(r.message);
  expect((await call("/alerts", "POST", r.token, { ...alert, sourceUrl: "https://127.0.0.1/private" })).status).toBe(400);
  time += 86_400_000;
  const closed = await call("/alerts", "POST", r.token, alert);
  expect(closed.status).toBe(409);
  expect(await closed.json()).toMatchObject({ status: "window_closed" });
  await inbound("hola", undefined, time - 1000, "51988888888");
  expect((await call("/alerts", "POST", r.token, alert)).status).toBe(409);
  await inbound("hola", undefined, time - 1000);
  vi.mocked(fetch).mockClear();
  expect(await (await call("/alerts", "POST", r.token, { ...alert, recipient: "51988888888" })).json()).toMatchObject({ status: "accepted" });
  const sent = JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body));
  expect(sent.to).toBe(recipient);
  expect(sent.type).toBe("interactive");
});

it("deduplicates concurrent alerts, detects payload conflict and does not renew window on send", async () => {
  const r = await linked();
  vi.mocked(fetch).mockClear();
  const responses = await Promise.all([call("/alerts", "POST", r.token, alert), call("/alerts", "POST", r.token, alert)]);
  expect(responses.every(response => response.status === 200)).toBe(true);
  expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
  expect((await call("/alerts", "POST", r.token, { ...alert, amount: "PEN 10" })).status).toBe(409);
  expect((await (await call("/status", "GET", r.token)).json() as any).expiresAt).toBe(time + 86_400_000);
  const row = await env.DB.prepare("SELECT * FROM radar_deliveries").first();
  expect(JSON.stringify(row)).not.toContain(alert.description);
});

it("transport uncertainty is durable and never resent, including server errors", async () => {
  const r = await linked();
  vi.mocked(fetch).mockClear();
  vi.mocked(fetch).mockRejectedValue(Error("private transport detail"));
  const first = await call("/alerts", "POST", r.token, alert);
  expect(await first.json()).toMatchObject({ status: "unknown" });
  expect(await (await call("/alerts", "POST", r.token, alert)).json()).toMatchObject({ status: "unknown", replayed: true });
  expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
});

it("paces 21 distinct opportunities atomically across installations and retains deferred ones", async () => {
  const r = await linked();
  vi.mocked(fetch).mockClear();
  const candidates = Array.from({ length: 21 }, (_, i) => ({ ...alert, ocid: `ocds-pace-${i}` }));
  const responses = await Promise.all(candidates.map(a => call("/alerts", "POST", r.token, a)));
  expect(responses.filter(r => r.status === 200)).toHaveLength(1);
  expect(responses.filter(r => r.status === 429)).toHaveLength(20);
  expect(fetch).toHaveBeenCalledOnce();
  expect((await env.DB.prepare("SELECT * FROM radar_deliveries").all()).results).toHaveLength(1);
  const deferredIndex = responses.findIndex(r => r.status === 429);
  expect(await responses[deferredIndex]!.json()).toEqual({ status: "deferred", retryAt: time + 30 * 60_000 });
  const another = await linked(); // Same recipient, different installation, same allowance.
  vi.mocked(fetch).mockClear();
  time += 30 * 60_000 - 1;
  expect((await call("/alerts", "POST", another.token, candidates[deferredIndex])).status).toBe(429);
  time += 1;
  expect(await (await call("/alerts", "POST", another.token, candidates[deferredIndex])).json()).toMatchObject({ status: "accepted" });
  expect(fetch).toHaveBeenCalledOnce();
});

it("defers quiet hours until 08:00 Peru without generating, reserving or sending", async () => {
  time = Date.parse("2026-10-19T00:59:00Z"); // 19:59 Peru.
  const r = await linked();
  expect((await call("/alerts", "POST", r.token, alert)).status).toBe(200);
  time += 60_000; // Exactly 20:00.
  vi.mocked(fetch).mockClear();
  const second = { ...alert, ocid: "ocds-quiet" };
  expect(await (await call("/alerts", "POST", r.token, second)).json()).toEqual({ status: "deferred", retryAt: Date.parse("2026-10-19T13:00:00Z") });
  time = Date.parse("2026-10-19T12:59:59.999Z");
  expect((await call("/alerts", "POST", r.token, second)).status).toBe(429);
  expect(fetch).not.toHaveBeenCalled();
  time += 1;
  expect(await (await call("/alerts", "POST", r.token, second)).json()).toMatchObject({ status: "accepted" });
  expect(fetch).toHaveBeenCalledOnce();
});

it("ambiguous reservations consume the interval and accepted replays never extend it", async () => {
  const r = await linked(); vi.mocked(fetch).mockClear();
  vi.mocked(fetch).mockRejectedValueOnce(Error("timeout"));
  expect(await (await call("/alerts", "POST", r.token, alert)).json()).toMatchObject({ status: "unknown" });
  const next = { ...alert, ocid: "ocds-after-unknown" };
  expect((await call("/alerts", "POST", r.token, next)).status).toBe(429);
  time += 30 * 60_000;
  expect(await (await call("/alerts", "POST", r.token, next)).json()).toMatchObject({ status: "accepted" });
  time += 29 * 60_000;
  expect(await (await call("/alerts", "POST", r.token, next)).json()).toMatchObject({ replayed: true });
  time += 60_000;
  expect((await call("/alerts", "POST", r.token, { ...alert, ocid: "ocds-third" })).status).toBe(200);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it("revoke invalidates credentials and RADAR BAJA disables all sender bindings without fiscal edits", async () => {
  const r = await linked();
  await call("/revoke", "POST", r.token);
  expect((await call("/status", "GET", r.token)).status).toBe(401);
  const another = await linked();
  const routed = await inbound("RADAR BAJA");
  expect(routed.entry[0].changes[0].value.messages).toHaveLength(0);
  expect((await call("/alerts", "POST", another.token, alert)).status).toBe(401);
  expect((await inbound("Crear boleta")).entry[0].changes[0].value.messages).toHaveLength(1);
});

it("rate limits public registration; disabled feature preserves payload", async () => {
  for (let i = 0; i < 5; i++) await register();
  expect((await call("/installations", "POST")).status).toBe(429);
  await env.DB.prepare("UPDATE radar_settings SET enabled=0 WHERE id=1").run();
  const input = payload("Hola");
  expect(await radarVerifiedWebhook(input, apiEnv())).toEqual(input);
  expect((await call("/installations", "POST")).status).toBe(503);
});

it("entry rejects forged Meta signatures before RADAR sees a linking command", async () => {
  const r = await register();
  const ctx = createExecutionContext();
  const request = new Request("https://example.test/webhooks/whatsapp", { method: "POST",
    headers: { "X-Hub-Signature-256": "sha256=" + "0".repeat(64) }, body: JSON.stringify(payload(r.message)) });
  const response = await worker.fetch(request as Request<unknown, IncomingRequestCfProperties>, apiEnv(), ctx);
  await waitOnExecutionContext(ctx);
  expect(response.status).toBe(401);
  expect((await (await call("/status", "GET", r.token)).json() as any).linked).toBe(false);
});

it("replay of an old opt-out cannot revoke a newly linked installation", async () => {
  await linked();
  const stopId = crypto.randomUUID();
  await inbound("RADAR BAJA", stopId);
  time += 2000;
  const newInstallation = await linked();
  await inbound("RADAR BAJA", stopId, time - 2000);
  expect((await (await call("/status", "GET", newInstallation.token)).json() as any).linked).toBe(true);
});

it("second-resolution Meta timestamps work with millisecond installation creation", async () => {
  time += 500;
  const registration = await linked();
  expect((await (await call("/status", "GET", registration.token)).json() as any).open).toBe(true);
});

it("future or stale messages do not extend a window and other phone numbers cannot bind", async () => {
  const registration = await register();
  await inbound(registration.message, undefined, time, recipient, "654321");
  expect((await (await call("/status", "GET", registration.token)).json() as any).linked).toBe(false);
  await inbound(registration.message);
  await inbound("future", undefined, time + 60_000);
  await inbound("old", undefined, time - 60_000);
  expect((await (await call("/status", "GET", registration.token)).json() as any).expiresAt).toBe(time + 86_400_000);
});

it("correlates delivery receipts to RADAR without putting them in fiscal conversations", async () => {
  const registration = await linked();
  await call("/alerts", "POST", registration.token, alert);
  const delivery = await env.DB.prepare("SELECT provider_message_id FROM radar_deliveries").first<{ provider_message_id: string }>();
  const originalExpiry = (await (await call("/status", "GET", registration.token)).json() as any).expiresAt;
  const callbacks = { object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: {
    metadata: { phone_number_id: phone }, statuses: [{ id: delivery!.provider_message_id, recipient_id: recipient, status: "read" }],
  } }] }] };
  await radarVerifiedWebhook(callbacks, apiEnv(), () => time);
  expect((await env.DB.prepare("SELECT delivery_status FROM radar_deliveries").first())?.delivery_status).toBe("read");
  expect((await (await call("/status", "GET", registration.token)).json() as any).expiresAt).toBe(originalExpiry);
  expect((await env.DB.prepare("SELECT * FROM messages WHERE content LIKE 'RADAR%'").all()).results).toHaveLength(0);
});

it("full Worker route: registration, signed linking, authenticated alert and opt-out", async () => {
  vi.mocked(fetch).mockImplementation(async url => String(url).includes("/chat/completions")
    ? Response.json({ choices: [{ message: { content: JSON.stringify({ what: "Buscan papel bond A4.", purpose: null,
      objectQuote: "Papel bond A4", purposeQuote: null }) } }] })
    : Response.json({ messages: [{ id: "wamid." + crypto.randomUUID() }] }));
  async function dispatch(request: Request) {
    const ctx = createExecutionContext();
    const response = await worker.fetch(request as Request<unknown, IncomingRequestCfProperties>, { ...apiEnv(), OPENAI_API_KEY: "test-openai",
      ENTERPRISE_AI_PROVIDER: "openai", ENTERPRISE_AI_BASE_URL: "https://api.openai.com/v1" }, ctx);
    await waitOnExecutionContext(ctx);
    return response;
  }
  async function signed(text: string) {
    const body = JSON.stringify(payload(text, crypto.randomUUID(), Date.now()));
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("test-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    const hex = Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, "0")).join("");
    return dispatch(new Request("https://example.test/webhooks/whatsapp", { method: "POST", body,
      headers: { "X-Hub-Signature-256": "sha256=" + hex } }));
  }
  const registration = await (await dispatch(new Request(`https://example.test${RADAR_API_PATH}/installations`, { method: "POST" }))).json() as any;
  expect((await signed(registration.message)).status).toBe(200);
  const response = await dispatch(new Request(`https://example.test${RADAR_API_PATH}/alerts`, {
    method: "POST", headers: { Authorization: `Bearer ${registration.token}` }, body: JSON.stringify(alert),
  }));
  expect(await response.json()).toMatchObject({ status: "accepted" });
  expect((await signed("RADAR BAJA")).status).toBe(200);
  expect((await dispatch(new Request(`https://example.test${RADAR_API_PATH}/status`, {
    headers: { Authorization: `Bearer ${registration.token}` },
  }))).status).toBe(401);
  expect((await env.DB.prepare("SELECT * FROM messages WHERE content LIKE 'RADAR%'").all()).results).toHaveLength(0);
});
