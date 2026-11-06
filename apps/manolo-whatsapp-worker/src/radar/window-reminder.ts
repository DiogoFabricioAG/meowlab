import { ALERT_INTERVAL_MS, nextAlertTime } from "./pacing";
import { SignedVpsBridgeClient } from "../adapters/bridge/signed-vps-client";

export const REMINDER_PATH = "/v1/projects/radar/reminders";
export const REMINDER_CRON = "*/15 * * * *";
const HOUR = 3_600_000, DAY = 24 * HOUR, SAFETY = 15 * 60_000;
const PREFIX = "radar-window-reminder:";
const BUTTON = "radar:window:continue:";
type Candidate = { id: string; phone_number_id: string; recipient: string; last_user_message_at: number };
type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

async function boundedJson(input: Request | Response, maximum: number): Promise<unknown> {
  const reader = input.body?.getReader();
  if (!reader) throw Error("missing_body");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > maximum) { await reader.cancel(); throw Error("body_too_large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

/** Usually two hours before expiry; overnight expiry moves to the preceding 19:45 Lima. */
export function reminderDueAt(lastMessage: number): number {
  const ideal = lastMessage + DAY - 2 * HOUR;
  const next = nextAlertTime(ideal);
  if (next <= lastMessage + DAY - SAFETY) return next;
  const peruDay = Math.floor((ideal - 5 * HOUR) / DAY) * DAY + 5 * HOUR;
  const previousClosing = peruDay + 20 * HOUR - SAFETY;
  return previousClosing <= ideal ? previousClosing : previousClosing - DAY;
}

/** Private API: installation token, never a client-supplied phone or recipient. */
export async function radarReminderHttp(request: Request, env: Env, now = () => Date.now()): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get("Authorization") ?? "")?.[1];
  if (!token) return json({ error: "unauthorized" }, 401);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))), b => b.toString(16).padStart(2, "0")).join("");
  const db = env.DB.withSession("first-primary");
  const installation = await db.prepare(`SELECT i.id FROM radar_installations i JOIN radar_settings s
    ON s.phone_number_id=i.phone_number_id AND s.id=1 AND s.enabled=1
    WHERE i.token_hash=? AND i.revoked_at IS NULL`).bind(hash).first<{ id: string }>();
  if (!installation) return json({ error: "unauthorized" }, 401);
  let input: JsonObject;
  try { input = object(await boundedJson(request, 256)); } catch { return json({ error: "invalid_preference" }, 400); }
  if (typeof input.enabled !== "boolean" || Object.keys(input).some(key => key !== "enabled")) return json({ error: "invalid_preference" }, 400);
  await db.prepare(`INSERT INTO radar_reminder_preferences(installation_id,enabled,updated_at) VALUES(?,?,?)
    ON CONFLICT(installation_id) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at`)
    .bind(installation.id, Number(input.enabled), now()).run();
  return json({ enabled: input.enabled });
}

function dailyStart(time: number) { return Math.floor((time - 5 * HOUR) / DAY) * DAY + 5 * HOUR; }

export async function hasRadarRole(env: Env, phone: string, recipient: string): Promise<boolean> {
  const db = env.DB.withSession("first-primary");
  const channel = await db.prepare(`SELECT n.tenant_id FROM whatsapp_numbers n JOIN tenants t ON t.id=n.tenant_id
    WHERE n.phone_number_id=? AND n.active=1 AND t.status='active' LIMIT 1`).bind(phone).first<{ tenant_id: string }>();
  if (!channel) return false;
  if (env.VPS_BRIDGE_ENABLED === "true") {
    // Use the existing signed role authority; never fall back to stale D1 roles on VPS failure.
    const role = await new SignedVpsBridgeClient(env.VPS_BRIDGE_API_URL, env.VPS_BRIDGE_HMAC_SECRET, () => {}).resolveContactRole({
      version: 1, requestId: crypto.randomUUID(), tenantId: channel.tenant_id, phoneNumberId: phone, whatsappUserId: recipient,
    });
    return role?.roleKey === "radar" && role.source !== "not_found";
  }
  const contact = await db.prepare(`SELECT COALESCE(NULLIF(TRIM(c.active_role_key),''),b.role_key) AS role_key
    FROM contacts c JOIN bot_configs b ON b.tenant_id=c.tenant_id WHERE c.tenant_id=? AND c.whatsapp_user_id=?`)
    .bind(channel.tenant_id, recipient).first<{ role_key: string }>();
  return contact?.role_key === "radar";
}

async function sendReminder(env: Env, candidate: Candidate, now: () => number): Promise<boolean> {
  const db = env.DB.withSession("first-primary"), time = now();
  if (time < reminderDueAt(candidate.last_user_message_at) || time >= candidate.last_user_message_at + DAY - SAFETY
    || nextAlertTime(time) !== time) return false;
  if (!await hasRadarRole(env, candidate.phone_number_id, candidate.recipient)) return false;
  const id = crypto.randomUUID(), key = PREFIX + candidate.last_user_message_at;
  // Both reminder and opportunity sends use this ledger, so races share the same pacing reservation.
  const reserve = await db.prepare(`INSERT INTO radar_deliveries
    (id,installation_id,phone_number_id,recipient,ocid,payload_hash,state,created_at)
    SELECT ?,i.id,i.phone_number_id,i.recipient,?,?,'sending',? FROM radar_installations i
    JOIN radar_settings s ON s.id=1 AND s.enabled=1 AND s.phone_number_id=i.phone_number_id
    JOIN radar_reminder_preferences p ON p.installation_id=i.id AND p.enabled=1
    JOIN radar_windows w ON w.phone_number_id=i.phone_number_id AND w.recipient=i.recipient
    WHERE i.id=? AND i.revoked_at IS NULL AND i.opted_in_at IS NOT NULL
      AND w.last_user_message_at=? AND w.last_user_message_at>? AND w.last_user_message_at<=?
      AND NOT EXISTS(SELECT 1 FROM radar_deliveries d WHERE d.phone_number_id=i.phone_number_id AND d.recipient=i.recipient
        AND d.state IN ('sending','accepted','unknown') AND d.created_at>?)
      AND NOT EXISTS(SELECT 1 FROM radar_deliveries d WHERE d.phone_number_id=i.phone_number_id AND d.recipient=i.recipient
        AND d.ocid LIKE 'radar-window-reminder:%' AND d.created_at>=?)
    ON CONFLICT(phone_number_id,recipient,ocid) DO NOTHING RETURNING id`)
    .bind(id, key, key, time, candidate.id, candidate.last_user_message_at, time - DAY + SAFETY, time,
      time - ALERT_INTERVAL_MS, dailyStart(time)).first<{ id: string }>();
  if (!reserve) return false;
  const checkTime = now();
  const valid = await db.prepare(`SELECT i.id FROM radar_installations i
    JOIN radar_reminder_preferences p ON p.installation_id=i.id AND p.enabled=1
    JOIN radar_settings s ON s.id=1 AND s.enabled=1 AND s.phone_number_id=i.phone_number_id
    JOIN radar_windows w ON w.phone_number_id=i.phone_number_id AND w.recipient=i.recipient
    WHERE i.id=? AND i.revoked_at IS NULL AND i.opted_in_at IS NOT NULL AND w.last_user_message_at=?`)
    .bind(candidate.id, candidate.last_user_message_at).first();
  if (!valid || nextAlertTime(checkTime) !== checkTime || checkTime >= candidate.last_user_message_at + DAY - SAFETY) {
    await db.prepare("UPDATE radar_deliveries SET state='rejected' WHERE id=?").bind(id).run(); return false;
  }
  let state = "unknown", providerId: string | null = null;
  try {
    const response = await fetch(`https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/${candidate.phone_number_id}/messages`, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: candidate.recipient, type: "interactive", interactive: {
        type: "button", body: { text: "¿Quieres seguir recibiendo oportunidades para tu negocio?\n\nToca «Seguir recibiendo» o escríbeme. Tu respuesta habilita los avisos durante otras 24 horas.\n\nPara cancelarlos: RADAR BAJA." },
        action: { buttons: [{ type: "reply", reply: { id: BUTTON + id, title: "Seguir recibiendo" } }] },
      } }),
    });
    if (response.ok) {
      const first = object(array(object(await boundedJson(response, 16_384)).messages)[0]);
      if (typeof first.id === "string" && first.id.length > 0 && first.id.length <= 512) { providerId = first.id; state = "accepted"; }
    } else { state = response.status >= 300 && response.status < 500 ? "rejected" : "unknown"; await response.body?.cancel(); }
  } catch { /* Ambiguous sends stay reserved; cron must never resend this window. */ }
  await db.prepare("UPDATE radar_deliveries SET state=?,provider_message_id=? WHERE id=?").bind(state, providerId, id).run();
  return true;
}

export async function runRadarWindowReminders(env: Env, now = () => Date.now()): Promise<{ attempted: number }> {
  const time = now();
  if (nextAlertTime(time) !== time || !env.META_ACCESS_TOKEN || !/^v\d+\.\d+$/.test(env.META_GRAPH_API_VERSION)) return { attempted: 0 };
  const db = env.DB.withSession("first-primary");
  const { results } = await db.prepare(`SELECT i.id,i.phone_number_id,i.recipient,w.last_user_message_at FROM radar_installations i
    JOIN radar_reminder_preferences p ON p.installation_id=i.id AND p.enabled=1
    JOIN radar_settings s ON s.id=1 AND s.enabled=1 AND s.phone_number_id=i.phone_number_id
    JOIN radar_windows w ON w.phone_number_id=i.phone_number_id AND w.recipient=i.recipient
    WHERE i.revoked_at IS NULL AND i.opted_in_at IS NOT NULL AND w.last_user_message_at>? AND w.last_user_message_at<=?
      AND NOT EXISTS(SELECT 1 FROM radar_deliveries d WHERE d.phone_number_id=i.phone_number_id AND d.recipient=i.recipient
        AND (d.ocid=('radar-window-reminder:' || w.last_user_message_at)
          OR (d.ocid LIKE 'radar-window-reminder:%' AND d.created_at>=?)
          OR (d.state IN ('sending','accepted','unknown') AND d.created_at>?)))
    ORDER BY w.last_user_message_at,i.id LIMIT 200`)
    .bind(time - DAY + SAFETY, time - 10 * HOUR, dailyStart(time), time - ALERT_INTERVAL_MS).all<Candidate>();
  const due = results.filter(row => reminderDueAt(row.last_user_message_at) <= time).slice(0, 50);
  let attempted = 0;
  // Bound outbound concurrency and work per scheduled invocation.
  for (let i = 0; i < due.length; i += 5) {
    const batch = await Promise.allSettled(due.slice(i, i + 5).map(row => sendReminder(env, row, now)));
    for (const result of batch) {
      if (result.status === "fulfilled") attempted += Number(result.value);
      else console.warn("[radar-reminder] persistence_failed");
    }
  }
  return { attempted };
}

/** Only AFTER Meta signature validation and radarVerifiedWebhook's inbound dedup/window update. */
export async function consumeRadarReminderReplies<T>(payload: T, env: Env, now = () => Date.now(),
  background?: (task: Promise<void>) => void): Promise<T> {
  const output = structuredClone(payload), db = env.DB.withSession("first-primary");
  for (const entry of array(object(output).entry)) for (const change of array(object(entry).changes)) {
    const c = object(change), value = object(c.value), phone = object(value.metadata).phone_number_id;
    if (c.field !== "messages" || typeof phone !== "string" || !Array.isArray(value.messages)) continue;
    const remaining: unknown[] = [];
    for (const item of value.messages) {
      const message = object(item), reply = object(object(message.interactive).button_reply);
      if (message.type !== "interactive" || typeof reply.id !== "string" || !reply.id.startsWith(BUTTON)) { remaining.push(item); continue; }
      // Recognized RADAR controls must never be routed to a fiscal role, including invalid/replayed controls.
      const id = reply.id.slice(BUTTON.length);
      if (!/^[a-f0-9-]{36}$/.test(id) || typeof message.id !== "string" || typeof message.from !== "string") continue;
      const timestamp = typeof message.timestamp === "string" && /^\d{1,12}$/.test(message.timestamp) ? Number(message.timestamp) * 1000 : NaN;
      if (!Number.isSafeInteger(timestamp) || timestamp > now() || timestamp <= now() - DAY) continue;
      const claim = await db.prepare(`UPDATE radar_inbound SET consumed=1 WHERE message_id=? AND consumed=0
        AND EXISTS(SELECT 1 FROM radar_deliveries d JOIN radar_installations i ON i.id=d.installation_id
          JOIN radar_settings s ON s.id=1 AND s.enabled=1 AND s.phone_number_id=i.phone_number_id
          WHERE d.id=? AND d.phone_number_id=? AND d.recipient=? AND d.ocid LIKE 'radar-window-reminder:%'
            AND d.state IN ('accepted','unknown','sending') AND i.revoked_at IS NULL AND i.opted_in_at IS NOT NULL)
        RETURNING message_id`).bind(message.id, id, phone, message.from).first();
      if (!claim || !env.META_ACCESS_TOKEN || !/^v\d+\.\d+$/.test(env.META_GRAPH_API_VERSION)
        || !await hasRadarRole(env, phone, message.from)) continue;
      const task = (async () => {
        try {
          const response = await fetch(`https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/${phone}/messages`, {
            method: "POST", redirect: "manual", signal: AbortSignal.timeout(5000),
            headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ messaging_product: "whatsapp", to: message.from, type: "text",
              text: { body: "Recibí tu respuesta. Tus avisos siguen según la configuración de RADAR. Para cancelarlos: RADAR BAJA." } }),
          }); await response.body?.cancel();
        } catch { /* The authenticated inbound message has already updated the window durably. */ }
      })();
      if (background) background(task); else await task;
    }
    value.messages = remaining;
  }
  return output;
}

/** Preserve existing routes/exports and compose only the private preference API and this cron. */
export function withRadarWindowReminders(handler: ExportedHandler<Env>) {
  return { ...handler,
    async fetch(request, env, ctx) {
      if (new URL(request.url).pathname === REMINDER_PATH) {
        try { return await radarReminderHttp(request, env); }
        catch { console.warn("[radar-reminder] preference_unavailable"); return json({ error: "service_unavailable" }, 503); }
      }
      return handler.fetch ? handler.fetch(request, env, ctx) : new Response(null, { status: 404 });
    },
    async scheduled(controller, env, ctx) {
      if (handler.scheduled) await handler.scheduled(controller, env, ctx);
      if (controller.cron === REMINDER_CRON) ctx.waitUntil(runRadarWindowReminders(env).then(
        result => { console.log(JSON.stringify({ event: "radar_reminders_checked", attempted: result.attempted })); },
        () => { console.warn("[radar-reminder] scheduled_failed"); throw Error("radar_reminders_unavailable"); },
      ));
    },
  } satisfies ExportedHandler<Env>;
}
