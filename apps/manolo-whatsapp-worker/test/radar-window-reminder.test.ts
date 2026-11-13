import { env } from "cloudflare:workers";
import { applyD1Migrations, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sha256 } from "../src/radar/contracts";
import worker from "../src/index";
import { radarVerifiedWebhook } from "../src/radar/webhook";
import { consumeRadarReminderReplies, radarReminderHttp, reminderDueAt, runRadarWindowReminders,
  withRadarWindowReminders, REMINDER_CRON } from "../src/radar/window-reminder";

const HOUR = 3_600_000, DAY = 24 * HOUR;
const phone = "123456", recipient = "51999999999", token = "b".repeat(64);
let time: number;
const runtime = (): Env => ({ ...env, VPS_BRIDGE_ENABLED: "false", META_APP_SECRET: "fake-meta-test-secret", META_ACCESS_TOKEN: "fake-test-token", META_GRAPH_API_VERSION: "v25.0" });
const now = () => time;
async function installation(id = "reminder-test", enabled = true) {
  await env.DB.prepare(`INSERT INTO radar_installations(id,token_hash,created_at,phone_number_id,recipient,opted_in_at)
    VALUES(?,?,?,?,?,?)`).bind(id, await sha256(id === "reminder-test" ? token : "c".repeat(64)), time - DAY, phone, recipient, time - DAY).run();
  await env.DB.prepare("INSERT INTO radar_reminder_preferences VALUES(?,?,?)").bind(id, Number(enabled), time).run();
}
async function windowAt(last = time - DAY + 2 * HOUR) {
  await env.DB.prepare(`INSERT INTO radar_windows VALUES(?,?,?,?) ON CONFLICT(phone_number_id,recipient)
    DO UPDATE SET last_user_message_at=excluded.last_user_message_at,message_id=excluded.message_id`)
    .bind(phone, recipient, last, crypto.randomUUID()).run();
}
async function preferences(enabled: boolean, bearer = token) {
  return radarReminderHttp(new Request("https://example.test/v1/projects/radar/reminders", {
    method: "POST", headers: { Authorization: `Bearer ${bearer}` }, body: JSON.stringify({ enabled }),
  }), runtime(), now);
}
function buttonPayload(id: string, messageId = crypto.randomUUID(), from = recipient) {
  return { object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: {
    metadata: { phone_number_id: phone }, messages: [{ id: messageId, from, timestamp: String(Math.floor(time / 1000)),
      type: "interactive", interactive: { type: "button_reply", button_reply: { id, title: "Seguir recibiendo" } } }],
  } }] }] };
}
beforeEach(async () => {
  time = Date.parse("2026-11-04T15:00:00Z");
  for (const table of ["radar_deliveries", "radar_reminder_preferences", "radar_installations", "radar_windows", "radar_inbound"])
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  await env.DB.prepare("UPDATE radar_settings SET enabled=1,phone_number_id=?,public_number=? WHERE id=1").bind(phone, recipient).run();
  await env.DB.prepare(`INSERT OR IGNORE INTO whatsapp_numbers(id,tenant_id,phone_number_id,display_name)
    VALUES('reminder-number','test-quotes',?,'Reminder fixture')`).bind(phone).run();
  await env.DB.prepare(`INSERT INTO contacts(tenant_id,whatsapp_user_id,active_role_key) VALUES('test-quotes',?,'radar')
    ON CONFLICT(tenant_id,whatsapp_user_id) DO UPDATE SET active_role_key='radar'`).bind(recipient).run();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ messages: [{ id: "wamid." + crypto.randomUUID() }] })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("calculates two-hour notices and shifts night expiry into a previous allowed interval", () => {
  for (const [last, due] of [
    ["2026-11-03T17:00:00Z", "2026-11-04T15:00:00Z"], // 12:00 -> 10:00
    ["2026-11-03T08:00:00Z", "2026-11-04T00:45:00Z"], // 03:00 -> preceding 19:45
    ["2026-11-03T13:10:00Z", "2026-11-04T00:45:00Z"], // 08:10 expiry: insufficient morning margin
    ["2026-11-03T14:00:00Z", "2026-11-04T13:00:00Z"], // 09:00 expiry -> 08:00
  ]) expect(new Date(reminderDueAt(Date.parse(last))).toISOString()).toBe(new Date(due).toISOString());
});

it("preferences require installation authentication and cannot address another recipient", async () => {
  await installation("reminder-test", false);
  expect((await preferences(true, "0".repeat(64))).status).toBe(401);
  expect(await (await preferences(true)).json()).toEqual({ enabled: true });
  const invalid = new Request("https://example.test", { method: "POST", headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ enabled: true, recipient: "51988888888" }) });
  expect((await radarReminderHttp(invalid, runtime(), now)).status).toBe(400);
  const oversized = new Request("https://example.test", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: " ".repeat(300) });
  expect((await radarReminderHttp(oversized, runtime(), now)).status).toBe(400);
  await env.DB.prepare("UPDATE radar_installations SET revoked_at=?").bind(time).run();
  expect((await preferences(true)).status).toBe(401);
});

it("concurrent cron runs and duplicate installations reserve one send; outbound does not renew the window", async () => {
  await installation(); await installation("other"); await windowAt();
  const before = await env.DB.prepare("SELECT last_user_message_at FROM radar_windows").first();
  await Promise.all([runRadarWindowReminders(runtime(), now), runRadarWindowReminders(runtime(), now)]);
  expect(fetch).toHaveBeenCalledOnce();
  const [url, init] = vi.mocked(fetch).mock.calls[0]!;
  expect(String(url)).toBe(`https://graph.facebook.com/v25.0/${phone}/messages`);
  expect(() => new Request(url, init)).not.toThrow();
  expect(init?.redirect).toBe("manual");
  const body = JSON.parse(String(init?.body));
  expect(body.interactive.action.buttons).toHaveLength(1);
  expect(body.interactive.action.buttons[0].reply.title).toBe("Seguir recibiendo");
  expect(await env.DB.prepare("SELECT last_user_message_at FROM radar_windows").first()).toEqual(before);
  time += HOUR;
  expect((await runRadarWindowReminders(runtime(), now)).attempted).toBe(0);
  expect(fetch).toHaveBeenCalledOnce();
});

it("honors pause, revocation, disabled service, closed/future windows and quiet hours", async () => {
  await installation("reminder-test", false); await windowAt();
  expect((await runRadarWindowReminders(runtime(), now)).attempted).toBe(0);
  await preferences(true);
  await env.DB.prepare("UPDATE radar_installations SET revoked_at=?").bind(time).run();
  expect((await runRadarWindowReminders(runtime(), now)).attempted).toBe(0);
  await env.DB.prepare("UPDATE radar_installations SET revoked_at=NULL").run();
  await env.DB.prepare("UPDATE radar_settings SET enabled=0").run();
  expect((await runRadarWindowReminders(runtime(), now)).attempted).toBe(0);
  await env.DB.prepare("UPDATE radar_settings SET enabled=1").run();
  for (const last of [time - DAY, time - DAY + 60_000, time + 1000]) {
    await windowAt(last); expect((await runRadarWindowReminders(runtime(), now)).attempted).toBe(0);
  }
  time = Date.parse("2026-11-04T03:00:00Z"); await windowAt();
  expect((await runRadarWindowReminders(runtime(), now)).attempted).toBe(0);
  expect(fetch).not.toHaveBeenCalled();
});

it("respects role changes and refuses stale D1 authorization when the signed VPS authority is unavailable", async () => {
  await installation(); await windowAt();
  await env.DB.prepare("UPDATE contacts SET active_role_key='facturaya' WHERE whatsapp_user_id=?").bind(recipient).run();
  expect((await runRadarWindowReminders(runtime(), now)).attempted).toBe(0);
  await env.DB.prepare("UPDATE contacts SET active_role_key='radar' WHERE whatsapp_user_id=?").bind(recipient).run();
  const live: Env = { ...runtime(), VPS_BRIDGE_ENABLED: "true", VPS_BRIDGE_API_URL: "https://facturas.meowlab.tech/internal/manolo",
    VPS_BRIDGE_HMAC_SECRET: "test-hmac-secret-at-least-32-characters" };
  vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
  expect((await runRadarWindowReminders(live, now)).attempted).toBe(0);
  expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).includes("/v1/control/contacts/resolve-role"))).toBe(true);
  expect(await env.DB.prepare("SELECT id FROM radar_deliveries").first()).toBeNull();
  vi.mocked(fetch).mockClear();
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (String(url).includes("facturas.meowlab.tech")) {
      expect((init?.headers as Record<string, string>)["x-manolo-signature"] ?? (init?.headers as Record<string, string>)["X-Manolo-Signature"]).toBeTruthy();
      const request = JSON.parse(String(init?.body));
      return Response.json({ version: 1, requestId: request.requestId, roleKey: "radar", source: "contact" });
    }
    return Response.json({ messages: [{ id: "wamid.test" }] });
  });
  expect((await runRadarWindowReminders(live, now)).attempted).toBe(1);
});

it("shares 30-minute pacing with opportunity alerts and limits even a new window to one notice per Lima day", async () => {
  await installation(); await windowAt();
  await env.DB.prepare(`INSERT INTO radar_deliveries(id,installation_id,phone_number_id,recipient,ocid,payload_hash,state,created_at)
    VALUES('prior','reminder-test',?,?,'opportunity','hash','accepted',?)`).bind(phone, recipient, time - 29 * 60_000).run();
  expect((await runRadarWindowReminders(runtime(), now)).attempted).toBe(0);
  time += 60_000;
  expect((await runRadarWindowReminders(runtime(), now)).attempted).toBe(1);
  await windowAt(time - DAY + 2 * HOUR + 60_000);
  time += HOUR;
  expect((await runRadarWindowReminders(runtime(), now)).attempted).toBe(0);
  expect(fetch).toHaveBeenCalledOnce();
});

it.each(["timeout", "server_error", "rejected", "malformed_success", "redirect"])("never retries %s within the same window", async mode => {
  await installation(); await windowAt();
  vi.mocked(fetch).mockImplementation(async () => {
    if (mode === "timeout") throw Error("test timeout");
    return mode === "server_error" ? new Response(null, { status: 503 })
      : mode === "rejected" ? new Response(null, { status: 400 })
      : mode === "redirect" ? new Response(null, { status: 302, headers: { Location: "https://example.invalid" } })
      : Response.json({ messages: [] });
  });
  await runRadarWindowReminders(runtime(), now); time += HOUR;
  await runRadarWindowReminders(runtime(), now);
  expect(fetch).toHaveBeenCalledOnce();
  expect((await env.DB.prepare("SELECT state FROM radar_deliveries").first())?.state)
    .toBe(mode === "rejected" || mode === "redirect" ? "rejected" : "unknown");
});

it("consumes the genuine reply once, renews only from inbound, and keeps controls away from fiscal roles", async () => {
  await installation(); await windowAt(); await runRadarWindowReminders(runtime(), now);
  const sent = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
  const button = sent.interactive.action.buttons[0].reply.id as string;
  time += 60_000;
  const input = buttonPayload(button);
  async function verified(payload: typeof input) {
    return consumeRadarReminderReplies(await radarVerifiedWebhook(payload, runtime(), now), runtime(), now);
  }
  vi.mocked(fetch).mockClear();
  const routed = await verified(input);
  expect(routed.entry[0]!.changes[0]!.value.messages).toHaveLength(0);
  expect((await env.DB.prepare("SELECT last_user_message_at FROM radar_windows").first())?.last_user_message_at).toBe(time);
  expect(fetch).toHaveBeenCalledOnce();
  await verified(input); expect(fetch).toHaveBeenCalledOnce();
  await verified(buttonPayload(button, crypto.randomUUID(), "51988888888"));
  expect(fetch).toHaveBeenCalledOnce();
  const unverified = buttonPayload(button);
  await consumeRadarReminderReplies(unverified, runtime(), now); // No inbound claim: no acknowledgement.
  expect(fetch).toHaveBeenCalledOnce();
  const ordinary = buttonPayload("radar:alert:products:test");
  expect((await consumeRadarReminderReplies(ordinary, runtime(), now)).entry[0]!.changes[0]!.value.messages).toHaveLength(1);
});

it("composes existing fetch and scheduled handlers without changing their routes", async () => {
  const fetchExisting = vi.fn(async () => new Response("original"));
  const scheduledExisting = vi.fn(async () => {});
  const wrapped = withRadarWindowReminders({ fetch: fetchExisting, scheduled: scheduledExisting });
  const ctx = createExecutionContext();
  expect(await (await wrapped.fetch(new Request("https://example.test/health") as Request<unknown, IncomingRequestCfProperties>, runtime(), ctx)).text()).toBe("original");
  expect(fetchExisting).toHaveBeenCalledOnce();
  await wrapped.scheduled({ cron: REMINDER_CRON, scheduledTime: time, noRetry() {} }, runtime(), ctx);
  await waitOnExecutionContext(ctx);
  expect(scheduledExisting).toHaveBeenCalledOnce();
});

it("the real webhook rejects an invalid signature and consumes a signed reminder reply before role routing", async () => {
  vi.spyOn(Date, "now").mockImplementation(now);
  await installation(); await windowAt(); await runRadarWindowReminders(runtime(), now);
  const sent = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
  time += 60_000;
  const body = JSON.stringify(buttonPayload(sent.interactive.action.buttons[0].reply.id));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(runtime().META_APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const signature = "sha256=" + Array.from(new Uint8Array(signed), b => b.toString(16).padStart(2, "0")).join("");
  const ctx = createExecutionContext();
  const invoke = (value: string) => worker.fetch(new Request("https://example.test/webhooks/whatsapp", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": value }, body,
  }) as Request<unknown, IncomingRequestCfProperties>, runtime(), ctx);
  vi.mocked(fetch).mockClear();
  expect((await invoke("sha256=" + "0".repeat(64))).status).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
  expect((await invoke(signature)).status).toBe(200);
  await waitOnExecutionContext(ctx);
  expect(fetch).toHaveBeenCalledOnce();
  expect((await env.DB.prepare("SELECT last_user_message_at FROM radar_windows").first())?.last_user_message_at).toBe(time);
});

it("upgrades the prior D1 schema without changing existing installations or enabling them implicitly", async () => {
  await installation();
  const existing = await env.DB.prepare("SELECT * FROM radar_installations").first();
  await env.DB.prepare("DROP TABLE radar_reminder_preferences").run();
  await env.DB.prepare("DROP INDEX radar_delivery_recipient_time").run();
  await env.DB.prepare("DELETE FROM d1_migrations WHERE name='0018_radar_window_reminders.sql'").run();
  const migrations = (env as typeof env & { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }).TEST_MIGRATIONS;
  await applyD1Migrations(env.DB, migrations.filter(migration => migration.name === "0018_radar_window_reminders.sql"));
  expect(await env.DB.prepare("SELECT * FROM radar_installations").first()).toEqual(existing);
  expect((await env.DB.prepare("SELECT * FROM radar_reminder_preferences").all()).results).toHaveLength(0);
});
