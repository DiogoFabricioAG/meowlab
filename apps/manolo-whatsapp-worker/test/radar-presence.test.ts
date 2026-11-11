import { env } from "cloudflare:workers";
import { applyD1Migrations, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sha256 } from "../src/radar/contracts";
import { radarPresenceHttp, runRadarPresence, presenceReceipts, withRadarPresence, PRESENCE_CRON, PRESENCE_LEASE_MS } from "../src/radar/presence";
import worker from "../src/index";

const phone = "123456", recipient = "51999999999", token = "b".repeat(64), otherToken = "c".repeat(64);
let time: number;
const now = () => time;
const runtime = (): Env => ({ ...env, RADAR_PRESENCE_ENABLED: "true" as Env["RADAR_PRESENCE_ENABLED"], VPS_BRIDGE_ENABLED: "false", META_ACCESS_TOKEN: "fake-presence-token", META_GRAPH_API_VERSION: "v25.0" });
async function installation(id = "presence-1", bearer = token) {
  await env.DB.prepare(`INSERT INTO radar_installations(id,token_hash,created_at,phone_number_id,recipient,opted_in_at)
    VALUES(?,?,?,?,?,?)`).bind(id, await sha256(bearer), time - 3_600_000, phone, recipient, time - 3_600_000).run();
}
const pulse = (sequence = 1, online = true, alertsEnabled = true, bearer = token, customEnv = runtime()) => radarPresenceHttp(new Request("https://example.test/v1/projects/radar/presence", {
  method: "POST", headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" }, body: JSON.stringify({ sequence, online, alertsEnabled }),
}), customEnv, now);
beforeEach(async () => {
  time = Date.parse("2026-11-05T15:00:00Z");
  for (const table of ["radar_presence_notices", "radar_presence_groups", "radar_presence", "radar_deliveries", "radar_installations", "radar_windows", "radar_rate_limits"])
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  await env.DB.prepare("UPDATE radar_settings SET enabled=1,phone_number_id=?,public_number=? WHERE id=1").bind(phone, recipient).run();
  await env.DB.prepare(`INSERT OR IGNORE INTO whatsapp_numbers(id,tenant_id,phone_number_id,display_name) VALUES('presence-number','test-quotes',?,'Presence fixture')`).bind(phone).run();
  await env.DB.prepare(`INSERT INTO contacts(tenant_id,whatsapp_user_id,active_role_key) VALUES('test-quotes',?,'radar')
    ON CONFLICT(tenant_id,whatsapp_user_id) DO UPDATE SET active_role_key='radar'`).bind(recipient).run();
  await installation();
  await env.DB.prepare("INSERT INTO radar_windows VALUES(?,?,?,?)").bind(phone, recipient, time - 3_600_000, "user-message").run();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ messages: [{ id: "wamid." + crypto.randomUUID() }] })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("announces connection once without promising offers or renewing the user window", async () => {
  const before = await env.DB.prepare("SELECT last_user_message_at FROM radar_windows").first();
  expect(await (await pulse()).json()).toEqual({ accepted: true });
  await pulse(2); await runRadarPresence(runtime(), now);
  expect(fetch).toHaveBeenCalledOnce();
  const [url, init] = vi.mocked(fetch).mock.calls[0]!;
  expect(() => new Request(url, init)).not.toThrow(); expect(init?.redirect).toBe("manual");
  expect(JSON.parse(String(init?.body)).text.body).toContain("RADAR está conectado");
  expect(JSON.parse(String(init?.body)).text.body).toContain("si encuentro");
  expect(await env.DB.prepare("SELECT last_user_message_at FROM radar_windows").first()).toEqual(before);
  expect(await env.DB.prepare("SELECT id FROM radar_deliveries").first()).toBeNull();
});

it("detects a lost heartbeat after the lease, and a newer reconnect; old pulses cannot keep it online", async () => {
  await pulse(10); time += PRESENCE_LEASE_MS + 1000;
  await pulse(9); // Replaying an old request must not refresh last_seen_at.
  await runRadarPresence(runtime(), now);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]![1]?.body)).text.body).toContain("Puede estar cerrado, suspendido o sin conexión");
  await runRadarPresence(runtime(), now); expect(fetch).toHaveBeenCalledTimes(2);
  time += PRESENCE_LEASE_MS; await pulse(11);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[2]![1]?.body)).text.body).toContain("RADAR está conectado");
});

it("an orderly stop is immediate when allowed; rapid transitions are coalesced", async () => {
  await pulse(); await pulse(2, false); expect(fetch).toHaveBeenCalledOnce();
  time += PRESENCE_LEASE_MS; await pulse(3, true); expect(fetch).toHaveBeenCalledOnce();
  await pulse(4, false); expect(fetch).toHaveBeenCalledTimes(2);
  expect((await env.DB.prepare("SELECT kind FROM radar_presence_notices ORDER BY created_at DESC LIMIT 1").first())?.kind).toBe("offline");
});

it("aggregates multiple desktops and reserves a single notice across concurrent workers", async () => {
  await installation("presence-2", otherToken);
  await Promise.all([pulse(), pulse(1, true, true, otherToken), runRadarPresence(runtime(), now)]);
  expect(fetch).toHaveBeenCalledOnce();
  time += 4 * 60_000; await pulse(2, true, true, otherToken);
  time += 2 * 60_000; await pulse(2, false); await runRadarPresence(runtime(), now);
  expect(fetch).toHaveBeenCalledOnce();
  time += PRESENCE_LEASE_MS; await runRadarPresence(runtime(), now);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("respects pause, role, consent and closed windows", async () => {
  await pulse(1, true, false); await runRadarPresence(runtime(), now); expect(fetch).not.toHaveBeenCalled();
  await env.DB.prepare("UPDATE contacts SET active_role_key='facturaya' WHERE whatsapp_user_id=?").bind(recipient).run();
  await pulse(2); expect(fetch).not.toHaveBeenCalled();
  await env.DB.prepare("UPDATE contacts SET active_role_key='radar' WHERE whatsapp_user_id=?").bind(recipient).run();
  await env.DB.prepare("UPDATE radar_windows SET last_user_message_at=?").bind(time - 86_400_000).run();
  await pulse(3); expect(fetch).not.toHaveBeenCalled();
  await env.DB.prepare("UPDATE radar_windows SET last_user_message_at=?").bind(time).run();
  await pulse(4); expect(fetch).toHaveBeenCalledOnce();
  await env.DB.prepare("UPDATE radar_installations SET revoked_at=?").bind(time).run();
  expect((await pulse(5)).status).toBe(401); time += PRESENCE_LEASE_MS; await runRadarPresence(runtime(), now);
  expect(fetch).toHaveBeenCalledOnce();
});

it("defers quiet-hour notices and discards stale intermediate states", async () => {
  time = Date.parse("2026-11-06T02:00:00Z");
  await env.DB.prepare("UPDATE radar_windows SET last_user_message_at=?").bind(time).run();
  await pulse(); time += PRESENCE_LEASE_MS; await runRadarPresence(runtime(), now); expect(fetch).not.toHaveBeenCalled();
  time = Date.parse("2026-11-06T13:00:00Z"); await pulse(2);
  expect(fetch).toHaveBeenCalledOnce();
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body)).text.body).toContain("RADAR está conectado");
});

it.each(["timeout", "server-error", "malformed", "rejected"])("never retries an ambiguous or rejected transition: %s", async mode => {
  vi.mocked(fetch).mockImplementation(async () => {
    if (mode === "timeout") throw Error("test timeout");
    return mode === "server-error" ? new Response(null, { status: 503 }) : mode === "rejected" ? new Response(null, { status: 400 }) : Response.json({ messages: [] });
  });
  await pulse(); time += 60_000; await pulse(2); time += 60_000; await runRadarPresence(runtime(), now);
  expect(fetch).toHaveBeenCalledOnce();
});

it("requires installation authentication, bounds input and accepts no recipient or client timestamp", async () => {
  expect((await pulse(1, true, true, "0".repeat(64))).status).toBe(401);
  for (const body of [{ sequence: 1, online: true, alertsEnabled: true, recipient: "51988888888" }, { sequence: -1, online: true, alertsEnabled: true }, " ".repeat(300)]) {
    const response = await radarPresenceHttp(new Request("https://example.test", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }), runtime(), now);
    expect(response.status).toBe(400);
  }
  expect(fetch).not.toHaveBeenCalled();
});

it("a revocation during signed role resolution prevents the outbound request", async () => {
  const live: Env = { ...runtime(), VPS_BRIDGE_ENABLED: "true", VPS_BRIDGE_API_URL: "https://facturas.meowlab.tech/internal/manolo", VPS_BRIDGE_HMAC_SECRET: "test-hmac-secret-at-least-32-characters" };
  vi.mocked(fetch).mockImplementation(async (_url, init) => {
    await env.DB.prepare("UPDATE radar_installations SET revoked_at=?").bind(time).run();
    const request = JSON.parse(String(init?.body));
    return Response.json({ version: 1, requestId: request.requestId, roleKey: "radar", source: "contact" });
  });
  await pulse(1, true, true, token, live);
  expect(fetch).toHaveBeenCalledOnce(); expect(String(vi.mocked(fetch).mock.calls[0]![0])).toContain("resolve-role");
  expect(await env.DB.prepare("SELECT id FROM radar_presence_notices").first()).toBeNull();
});

it("correlates authenticated receipt payloads without changing the availability or user window", async () => {
  await pulse(); const row = await env.DB.prepare("SELECT provider_message_id FROM radar_presence_notices").first<{ provider_message_id: string }>();
  const payload = (user: string) => ({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: phone },
    statuses: [{ id: row!.provider_message_id, recipient_id: user, status: "delivered" }] } }] }] });
  await presenceReceipts(payload("51988888888"), runtime());
  expect((await env.DB.prepare("SELECT delivery_status FROM radar_presence_notices").first())?.delivery_status).toBeNull();
  await presenceReceipts(payload(recipient), runtime());
  expect((await env.DB.prepare("SELECT delivery_status FROM radar_presence_notices").first())?.delivery_status).toBe("delivered");
});

it("upgrades the previous schema without creating inferred presence for existing installations", async () => {
  await env.DB.exec("DROP VIEW radar_presence_active; DROP TABLE radar_presence_notices; DROP TABLE radar_presence_groups; DROP TABLE radar_presence;");
  await env.DB.prepare("DELETE FROM d1_migrations WHERE name='0019_radar_presence.sql'").run();
  const migrations = (env as typeof env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }).TEST_MIGRATIONS;
  await applyD1Migrations(env.DB, migrations.filter(m => m.name === "0019_radar_presence.sql"));
  expect((await env.DB.prepare("SELECT count(*) AS n FROM radar_installations").first())?.n).toBe(1);
  expect((await env.DB.prepare("SELECT count(*) AS n FROM radar_presence").first())?.n).toBe(0);
});

it("composes the existing handler and only runs the five-minute presence cron", async () => {
  const original = { fetch: vi.fn(async () => new Response("existing")), scheduled: vi.fn(async () => {}) };
  const handler = withRadarPresence(original), ctx = createExecutionContext();
  expect(await (await handler.fetch(new Request("https://example.test/health") as Request<unknown, IncomingRequestCfProperties>, runtime(), ctx)).text()).toBe("existing");
  await handler.scheduled({ cron: PRESENCE_CRON, scheduledTime: time, noRetry() {} }, runtime(), ctx);
  await waitOnExecutionContext(ctx); expect(original.scheduled).toHaveBeenCalledOnce();
});

it("the real Worker authenticates presence and validates Meta signatures before recording receipts", async () => {
  vi.spyOn(Date, "now").mockImplementation(now);
  const live = { ...runtime(), META_APP_SECRET: "presence-test-secret" }, ctx = createExecutionContext();
  const request = new Request("https://example.test/v1/projects/radar/presence", { method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ sequence: 1, online: true, alertsEnabled: true }) });
  expect((await worker.fetch(request as Request<unknown, IncomingRequestCfProperties>, live, ctx)).status).toBe(200);
  await waitOnExecutionContext(ctx);
  const row = await env.DB.prepare("SELECT provider_message_id FROM radar_presence_notices").first<{ provider_message_id: string }>();
  expect(row?.provider_message_id).toBeTruthy();
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: phone },
    statuses: [{ id: row!.provider_message_id, recipient_id: recipient, status: "delivered" }] } }] }] });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(live.META_APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const signature = "sha256=" + Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
  async function callback(signed: string) {
    const context = createExecutionContext();
    const response = await worker.fetch(new Request("https://example.test/webhooks/whatsapp", { method: "POST",
      headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signed }, body }) as Request<unknown, IncomingRequestCfProperties>, live, context);
    await waitOnExecutionContext(context); return response;
  }
  expect((await callback("sha256=" + "0".repeat(64))).status).toBe(401);
  expect((await env.DB.prepare("SELECT delivery_status FROM radar_presence_notices").first())?.delivery_status).toBeNull();
  expect((await callback(signature)).status).toBe(200);
  expect((await env.DB.prepare("SELECT delivery_status FROM radar_presence_notices").first())?.delivery_status).toBe("delivered");
});

it("stays off until RADAR_PRESENCE_ENABLED is true: no route, no cron and no receipts", async () => {
  const off: Env = { ...runtime(), RADAR_PRESENCE_ENABLED: "false" };
  const original: ExportedHandler<Env> = { fetch: async () => new Response("existing"), scheduled: async () => {} };
  const handler = withRadarPresence(original), ctx = createExecutionContext();
  const response = await handler.fetch!(new Request("https://example.test/v1/projects/radar/presence", { method: "POST" }) as Request<unknown, IncomingRequestCfProperties>, off, ctx);
  expect(await response.text()).toBe("existing");
  const prepare = vi.spyOn(off.DB, "prepare");
  await handler.scheduled!({ cron: PRESENCE_CRON, scheduledTime: Date.now(), noRetry() {} }, off, ctx);
  await presenceReceipts({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "x" }, statuses: [{ id: "m", recipient_id: "r", status: "read" }] } }] }] }, off);
  await waitOnExecutionContext(ctx);
  expect(prepare).not.toHaveBeenCalled();
  prepare.mockRestore();
});
