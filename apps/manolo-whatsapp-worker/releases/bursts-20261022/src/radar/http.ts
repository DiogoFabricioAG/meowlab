import { RADAR_API_PATH, randomSecret, sha256, validateAlert, alertText,
  type RadarInstallation, type RadarSettings } from "./contracts";
import { RadarStore } from "./store";

const json = (body: unknown, status = 200) => Response.json(body, { status,
  headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });

export async function readLimitedJson(request: Request | Response, max = 8192): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw Error("missing_body");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > max) { await reader.cancel(); throw Error("body_too_large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

async function pairing(store: RadarStore, installationId: string, config: RadarSettings, now: number) {
  const code = randomSecret();
  const expiresAt = now + 10 * 60_000;
  await store.db.prepare("UPDATE radar_installations SET pairing_hash=?, pairing_expires_at=? WHERE id=? AND revoked_at IS NULL AND recipient IS NULL")
    .bind(await sha256(code), expiresAt, installationId).run();
  const message = `RADAR ACTIVAR ${code}`;
  return { message, expiresAt, whatsappUrl: `https://wa.me/${config.public_number}?text=${encodeURIComponent(message)}`,
    notice: "Al enviar este mensaje autorizas alertas de RADAR en este celular. Puedes cancelarlas escribiendo RADAR BAJA." };
}

async function sendAlert(request: Request, store: RadarStore, installation: RadarInstallation,
  env: Env, now: () => number): Promise<Response> {
  let alert;
  try { alert = validateAlert(await readLimitedJson(request)); } catch { return json({ error: "invalid_alert" }, 400); }
  if (!alert) return json({ error: "invalid_alert" }, 400);
  if (!installation.recipient || !installation.opted_in_at) return json({ error: "not_linked" }, 403);
  const payloadHash = await sha256(JSON.stringify(alert));
  const previous = await store.db.prepare("SELECT state,payload_hash FROM radar_deliveries WHERE phone_number_id=? AND recipient=? AND ocid=?")
    .bind(installation.phone_number_id, installation.recipient, alert.ocid).first<{ state: string; payload_hash: string }>();
  if (previous && previous.payload_hash !== payloadHash) return json({ error: "idempotency_conflict" }, 409);
  if (previous && previous.state !== "rejected") return json({ status: previous.state === "sending" ? "unknown" : previous.state, replayed: true });
  if (!(await store.window(installation, now())).open) return json({ status: "window_closed" }, 409);
  if (!env.META_ACCESS_TOKEN || !/^v\d+\.\d+$/.test(env.META_GRAPH_API_VERSION)) return json({ error: "service_unavailable" }, 503);
  if (!await store.rateLimit(`send:${installation.phone_number_id}:${installation.recipient}`, 120, now())) return json({ error: "rate_limited" }, 429);
  const deliveryId = crypto.randomUUID();
  const time = now();
  // Reservation and authorization are atomic. A crash leaves 'sending', never an automatic resend.
  const reserved = await store.db.prepare(`INSERT INTO radar_deliveries
    (id,installation_id,phone_number_id,recipient,ocid,payload_hash,state,created_at)
    SELECT ?,i.id,i.phone_number_id,i.recipient,?,?,'sending',? FROM radar_installations i
    JOIN radar_windows w ON w.phone_number_id=i.phone_number_id AND w.recipient=i.recipient
    WHERE i.id=? AND i.revoked_at IS NULL AND i.opted_in_at IS NOT NULL
      AND w.last_user_message_at>? AND w.last_user_message_at<=?
    ON CONFLICT(phone_number_id,recipient,ocid) DO UPDATE SET state='sending',created_at=excluded.created_at
      WHERE radar_deliveries.state='rejected' AND radar_deliveries.payload_hash=excluded.payload_hash
    RETURNING id`).bind(deliveryId, alert.ocid, payloadHash, time, installation.id, time - 86_400_000, time).first<{ id: string }>();
  if (!reserved) {
    const row = await store.db.prepare("SELECT state FROM radar_deliveries WHERE phone_number_id=? AND recipient=? AND ocid=?")
      .bind(installation.phone_number_id, installation.recipient, alert.ocid).first<{ state: string }>();
    return row ? json({ status: row.state === "sending" ? "unknown" : row.state, replayed: true }) : json({ status: "window_closed" }, 409);
  }
  let state: "accepted" | "unknown" | "rejected" = "unknown";
  let providerId: string | null = null;
  const eligibility = await store.db.prepare(`SELECT w.last_user_message_at FROM radar_installations i
    JOIN radar_windows w ON w.phone_number_id=i.phone_number_id AND w.recipient=i.recipient
    WHERE i.id=? AND i.revoked_at IS NULL AND i.opted_in_at IS NOT NULL`)
    .bind(installation.id).first<{ last_user_message_at: number }>();
  if (!eligibility || now() < eligibility.last_user_message_at || now() - eligibility.last_user_message_at >= 86_400_000) {
    await store.db.prepare("UPDATE radar_deliveries SET state='rejected' WHERE id=?").bind(reserved.id).run();
    return json({ status: "window_closed" }, 409);
  }
  try {
    const response = await fetch(`https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/${installation.phone_number_id}/messages`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: installation.recipient,
        type: "text", text: { preview_url: false, body: alertText(alert) } }),
    });
    if (response.ok) {
      const data = await readLimitedJson(response, 16_384) as { messages?: { id?: unknown }[] };
      const id = data.messages?.[0]?.id;
      if (typeof id === "string" && id.length > 0 && id.length <= 512) { providerId = id; state = "accepted"; }
    } else { state = response.status >= 500 || response.status === 408 ? "unknown" : "rejected"; await response.body?.cancel(); }
  } catch { /* Transport ambiguity: do not retry automatically. */ }
  await store.db.prepare("UPDATE radar_deliveries SET state=?,provider_message_id=? WHERE id=?")
    .bind(state, providerId, reserved.id).run();
  return json({ status: state });
}

export async function radarHttp(request: Request, env: Env, now = () => Date.now()): Promise<Response> {
  const store = new RadarStore(env.DB);
  try {
    const config = await store.settings();
    if (!config) return json({ error: "service_unavailable" }, 503);
    const path = new URL(request.url).pathname.slice(RADAR_API_PATH.length);
    if (path === "/installations" && request.method === "POST") {
      // Salt the network identifier; do not store IPs or request bodies.
      if (!env.META_APP_SECRET) return json({ error: "service_unavailable" }, 503);
      const network = await sha256(`${env.META_APP_SECRET}:${request.headers.get("CF-Connecting-IP") ?? "unknown"}`);
      if (!await store.rateLimit(`register:${network}`, 5, now())) return json({ error: "rate_limited" }, 429);
      const token = randomSecret();
      const id = crypto.randomUUID();
      await store.db.prepare("INSERT INTO radar_installations (id,token_hash,created_at,phone_number_id) VALUES (?,?,?,?)")
        .bind(id, await sha256(token), now(), config.phone_number_id).run();
      await store.db.prepare("DELETE FROM radar_rate_limits WHERE expires_at<?").bind(now()).run();
      return json({ installationId: id, token, ...await pairing(store, id, config, now()) }, 201);
    }
    const bearer = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get("Authorization") ?? "")?.[1] ?? "";
    const installation = await store.authenticate(bearer);
    if (!installation || installation.phone_number_id !== config.phone_number_id) return json({ error: "unauthorized" }, 401);
    if (path === "/status" && request.method === "GET") {
      return json({ linked: Boolean(installation.recipient && installation.opted_in_at),
        recipient: installation.recipient ? `***${installation.recipient.slice(-4)}` : null,
        ...await store.window(installation, now()) });
    }
    if (path === "/pairing" && request.method === "POST") {
      if (installation.recipient) return json({ error: "already_linked" }, 409);
      if (!await store.rateLimit(`pair:${installation.id}`, 5, now())) return json({ error: "rate_limited" }, 429);
      return json(await pairing(store, installation.id, config, now()));
    }
    if (path === "/revoke" && request.method === "POST") { await store.revoke(installation, now()); return json({ revoked: true }); }
    if (path === "/alerts" && request.method === "POST") return await sendAlert(request, store, installation, env, now);
    return json({ error: "not_found" }, 404);
  } catch { return json({ error: "service_unavailable" }, 503); }
}
