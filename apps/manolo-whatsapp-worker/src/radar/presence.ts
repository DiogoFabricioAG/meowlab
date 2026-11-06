import { RadarStore } from "./store";
import { readLimitedJson } from "./http";
import { nextAlertTime } from "./pacing";
import { hasRadarRole } from "./window-reminder";

export const PRESENCE_PATH = "/v1/projects/radar/presence";
export const PRESENCE_CRON = "*/5 * * * *";
export const PRESENCE_LEASE_MS = 5 * 60_000;
const INTERVAL = 5 * 60_000, DAY = 86_400_000;
type Group = { phone_number_id: string; recipient: string; state: "online" | "offline" | "paused"; revision: number; last_notified_state: string | null };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function refreshGroup(db: D1DatabaseSession, phone: string, recipient: string, time: number) {
  await db.prepare(`INSERT INTO radar_presence_groups(phone_number_id,recipient,state,revision,changed_at,last_notified_state)
    SELECT ?,?,CASE WHEN EXISTS(SELECT 1 FROM radar_presence_active WHERE phone_number_id=? AND recipient=? AND online=1 AND last_seen_at>?)
      THEN 'online' WHEN EXISTS(SELECT 1 FROM radar_presence_active WHERE phone_number_id=? AND recipient=?) THEN 'offline' ELSE 'paused' END,1,?,NULL
    ON CONFLICT(phone_number_id,recipient) DO UPDATE SET state=excluded.state,revision=radar_presence_groups.revision+1,
      changed_at=excluded.changed_at,last_notified_state=CASE WHEN excluded.state='paused' THEN NULL ELSE radar_presence_groups.last_notified_state END
    WHERE radar_presence_groups.state<>excluded.state`)
    .bind(phone, recipient, phone, recipient, time - PRESENCE_LEASE_MS, phone, recipient, time).run();
}

// The condition is chosen from a server-owned enum; all identity/time values remain bound parameters.
function liveCondition(kind: "online" | "offline") {
  return `${kind === "offline" ? "NOT " : ""}EXISTS(SELECT 1 FROM radar_presence_active p WHERE p.phone_number_id=g.phone_number_id
    AND p.recipient=g.recipient AND p.online=1 AND p.last_seen_at>?)`;
}
const activeCondition = `EXISTS(SELECT 1 FROM radar_presence_active p WHERE p.phone_number_id=g.phone_number_id AND p.recipient=g.recipient)`;

async function notifyGroup(env: Env, phone: string, recipient: string, now: () => number): Promise<boolean> {
  const db = env.DB.withSession("first-primary");
  await refreshGroup(db, phone, recipient, now());
  const group = await db.prepare("SELECT * FROM radar_presence_groups WHERE phone_number_id=? AND recipient=?").bind(phone, recipient).first<Group>();
  if (group) await db.prepare("UPDATE radar_presence_groups SET checked_at=? WHERE phone_number_id=? AND recipient=?").bind(now(), phone, recipient).run();
  if (!group || group.state === "paused" || group.state === group.last_notified_state || nextAlertTime(now()) !== now()
    || !env.META_ACCESS_TOKEN || !/^v\d+\.\d+$/.test(env.META_GRAPH_API_VERSION)) return false;
  if (!(await new RadarStore(env.DB).window({ phone_number_id: phone, recipient }, now())).open) return false;
  if (await db.prepare(`SELECT id FROM radar_presence_notices WHERE phone_number_id=? AND recipient=? AND (revision=? OR created_at>?) LIMIT 1`)
    .bind(phone, recipient, group.revision, now() - INTERVAL).first()) return false;
  if (!await hasRadarRole(env, phone, recipient)) return false;
  const time = now(), id = crypto.randomUUID();
  const eligibility = `FROM radar_presence_groups g JOIN radar_windows w ON w.phone_number_id=g.phone_number_id AND w.recipient=g.recipient
    WHERE g.phone_number_id=? AND g.recipient=? AND g.revision=? AND g.state=? AND ${activeCondition} AND ${liveCondition(group.state)}
      AND w.last_user_message_at>? AND w.last_user_message_at<=?`;
  const reservation = await db.prepare(`INSERT INTO radar_presence_notices(id,phone_number_id,recipient,revision,kind,state,created_at)
    SELECT ?,g.phone_number_id,g.recipient,g.revision,g.state,'sending',? ${eligibility}
      AND NOT EXISTS(SELECT 1 FROM radar_presence_notices n WHERE n.phone_number_id=g.phone_number_id AND n.recipient=g.recipient AND n.created_at>?)
    ON CONFLICT(phone_number_id,recipient,revision) DO NOTHING RETURNING id`)
    .bind(id, time, phone, recipient, group.revision, group.state, time - PRESENCE_LEASE_MS, time - DAY, time, time - INTERVAL).first();
  if (!reservation) return false;
  const checkTime = now();
  const valid = await db.prepare(`SELECT g.revision ${eligibility}`)
    .bind(phone, recipient, group.revision, group.state, checkTime - PRESENCE_LEASE_MS, checkTime - DAY, checkTime).first();
  if (!valid || nextAlertTime(checkTime) !== checkTime) {
    await db.prepare("UPDATE radar_presence_notices SET state='rejected' WHERE id=?").bind(id).run(); return false;
  }
  const body = group.state === "online"
    ? "*RADAR está conectado*\n\nTu equipo está conectado y la búsqueda automática está habilitada. Te avisaré si encuentro oportunidades para revisar, dentro del horario de avisos."
    : "*RADAR se desconectó*\n\nDejé de recibir señal de tu equipo. Puede estar cerrado, suspendido o sin conexión. La búsqueda de nuevas oportunidades se retomará cuando vuelva a conectarse.\n\nPuedes seguir marcando las oportunidades recibidas; se sincronizarán al reconectar.";
  let state = "unknown", providerId: string | null = null;
  try {
    const response = await fetch(`https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/${phone}/messages`, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: recipient, type: "text", text: { body } }),
    });
    if (response.ok) {
      const result = await readLimitedJson(response, 16_384) as { messages?: { id?: unknown }[] };
      if (typeof result.messages?.[0]?.id === "string" && result.messages[0].id.length > 0 && result.messages[0].id.length <= 512) {
        providerId = result.messages[0].id; state = "accepted";
      }
    } else { state = response.status >= 300 && response.status < 500 && response.status !== 408 ? "rejected" : "unknown"; await response.body?.cancel(); }
  } catch { /* Do not resend an ambiguous transition. */ }
  await db.prepare("UPDATE radar_presence_notices SET state=?,provider_message_id=? WHERE id=?").bind(state, providerId, id).run();
  if (state !== "rejected") await db.prepare(`UPDATE radar_presence_groups SET last_notified_state=? WHERE phone_number_id=? AND recipient=?`)
    .bind(group.state, phone, recipient).run();
  return true;
}

export async function radarPresenceHttp(request: Request, env: Env, now = () => Date.now(), background?: (task: Promise<void>) => void): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const store = new RadarStore(env.DB), config = await store.settings();
  if (!config) return json({ error: "service_unavailable" }, 503);
  const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get("Authorization") ?? "")?.[1] ?? "";
  const installation = await store.authenticate(token);
  if (!installation || installation.phone_number_id !== config.phone_number_id) return json({ error: "unauthorized" }, 401);
  let body: Record<string, unknown>;
  try { body = await readLimitedJson(request, 256) as Record<string, unknown>; } catch { return json({ error: "invalid_presence" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 3
    || !Object.keys(body).every(key => ["sequence", "online", "alertsEnabled"].includes(key))
    || !Number.isSafeInteger(body.sequence) || (body.sequence as number) <= 0
    || typeof body.online !== "boolean" || typeof body.alertsEnabled !== "boolean") return json({ error: "invalid_presence" }, 400);
  if (!installation.recipient || !installation.opted_in_at) return json({ error: "not_linked" }, 403);
  if (!await store.rateLimit(`presence:${installation.id}`, 180, now())) return json({ error: "rate_limited" }, 429);
  await store.db.prepare(`INSERT INTO radar_presence(installation_id,sequence,online,alerts_enabled,last_seen_at) VALUES(?,?,?,?,?)
    ON CONFLICT(installation_id) DO UPDATE SET sequence=excluded.sequence,online=excluded.online,
      alerts_enabled=excluded.alerts_enabled,last_seen_at=excluded.last_seen_at WHERE radar_presence.sequence<excluded.sequence`)
    .bind(installation.id, body.sequence, Number(body.online), Number(body.alertsEnabled), now()).run();
  const task = notifyGroup(env, installation.phone_number_id, installation.recipient, now).then(() => {}, () => { console.warn("[radar-presence] notice_pending"); });
  if (background) background(task); else await task;
  return json({ accepted: true });
}

export async function runRadarPresence(env: Env, now = () => Date.now()): Promise<void> {
  const db = env.DB.withSession("first-primary");
  const groups = await db.prepare(`WITH recipients AS (
      SELECT DISTINCT i.phone_number_id,i.recipient FROM radar_installations i JOIN radar_presence p ON p.installation_id=i.id
      WHERE i.revoked_at IS NULL AND i.opted_in_at IS NOT NULL AND i.recipient IS NOT NULL)
    SELECT r.phone_number_id,r.recipient FROM recipients r LEFT JOIN radar_presence_groups g
      ON g.phone_number_id=r.phone_number_id AND g.recipient=r.recipient
    WHERE g.state IS NULL OR g.state<>CASE WHEN EXISTS(SELECT 1 FROM radar_presence_active p WHERE p.phone_number_id=r.phone_number_id
      AND p.recipient=r.recipient AND p.online=1 AND p.last_seen_at>?) THEN 'online'
      WHEN EXISTS(SELECT 1 FROM radar_presence_active p WHERE p.phone_number_id=r.phone_number_id AND p.recipient=r.recipient) THEN 'offline' ELSE 'paused' END
      OR (g.state IN ('online','offline') AND (g.last_notified_state IS NULL OR g.last_notified_state<>g.state)
        AND EXISTS(SELECT 1 FROM radar_windows w WHERE w.phone_number_id=r.phone_number_id AND w.recipient=r.recipient
          AND w.last_user_message_at>? AND w.last_user_message_at<=?)
        AND NOT EXISTS(SELECT 1 FROM radar_presence_notices n WHERE n.phone_number_id=r.phone_number_id AND n.recipient=r.recipient AND n.revision=g.revision))
    ORDER BY COALESCE(g.checked_at,0),r.phone_number_id,r.recipient LIMIT 100`)
    .bind(now() - PRESENCE_LEASE_MS, now() - DAY, now()).all<{ phone_number_id: string; recipient: string }>();
  for (let index = 0; index < groups.results.length; index += 5) {
    const result = await Promise.allSettled(groups.results.slice(index, index + 5).map(group => notifyGroup(env, group.phone_number_id, group.recipient, now)));
    if (result.some(item => item.status === "rejected")) console.warn("[radar-presence] reconciliation_pending");
  }
}

type Obj = Record<string, unknown>;
const object = (v: unknown): Obj => v && typeof v === "object" && !Array.isArray(v) ? v as Obj : {};
const array = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
/** Call only after the existing webhook has validated Meta's signature. */
export async function presenceReceipts<T>(payload: T, env: Env): Promise<T> {
  for (const entry of array(object(payload).entry)) for (const change of array(object(entry).changes)) {
    const c = object(change), value = object(c.value), phone = object(value.metadata).phone_number_id;
    if (c.field !== "messages" || typeof phone !== "string") continue;
    for (const raw of array(value.statuses)) {
      const status = object(raw);
      if (typeof status.id !== "string" || typeof status.recipient_id !== "string" || typeof status.status !== "string"
        || !["sent", "delivered", "read", "failed"].includes(status.status)) continue;
      await env.DB.prepare(`UPDATE radar_presence_notices SET delivery_status=? WHERE provider_message_id=? AND phone_number_id=? AND recipient=?
        AND (delivery_status IS NULL OR delivery_status='sent' OR (delivery_status='delivered' AND ?='read'))`)
        .bind(status.status, status.id, phone, status.recipient_id, status.status).run();
    }
  }
  return payload;
}

export function withRadarPresence(handler: ExportedHandler<Env>) {
  return { ...handler,
    async fetch(request, env, ctx) {
      if (new URL(request.url).pathname === PRESENCE_PATH) {
        try { return await radarPresenceHttp(request, env, undefined, task => ctx.waitUntil(task)); }
        catch { console.warn("[radar-presence] unavailable"); return json({ error: "service_unavailable" }, 503); }
      }
      return handler.fetch ? handler.fetch(request, env, ctx) : new Response(null, { status: 404 });
    },
    async scheduled(controller, env, ctx) {
      if (handler.scheduled) await handler.scheduled(controller, env, ctx);
      if (controller.cron === PRESENCE_CRON) ctx.waitUntil(runRadarPresence(env));
    },
  } satisfies ExportedHandler<Env>;
}
