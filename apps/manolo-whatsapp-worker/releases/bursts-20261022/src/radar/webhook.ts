import { sha256 } from "./contracts";
import { RadarStore } from "./store";

type ObjectValue = Record<string, any>;

async function acknowledge(env: Env, phoneNumberId: string, recipient: string, body: string): Promise<void> {
  if (!env.META_ACCESS_TOKEN || !/^v\d+\.\d+$/.test(env.META_GRAPH_API_VERSION)) return;
  try {
    const response = await fetch(`https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(5000),
      headers: { Authorization: `Bearer ${env.META_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: recipient, type: "text", text: { body } }),
    });
    await response.body?.cancel();
  } catch { /* Linking is durable; status polling remains authoritative if acknowledgement fails. */ }
}

/** Called ONLY after the existing webhook validates Meta's signature. */
export async function radarVerifiedWebhook(payload: ObjectValue, env: Env, now = () => Date.now(),
  background?: (task: Promise<void>) => void): Promise<ObjectValue> {
  const store = new RadarStore(env.DB);
  const config = await store.settings();
  if (!config) return payload;
  const output = structuredClone(payload);
  for (const entry of Array.isArray(output.entry) ? output.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value;
      if (change?.field !== "messages" || value?.metadata?.phone_number_id !== config.phone_number_id) continue;
      for (const status of Array.isArray(value.statuses) ? value.statuses : []) {
        if (!status || typeof status.id !== "string" || typeof status.recipient_id !== "string"
          || !["sent", "delivered", "read", "failed"].includes(status.status)) continue;
        await store.db.prepare(`UPDATE radar_deliveries SET delivery_status=?
          WHERE provider_message_id=? AND phone_number_id=? AND recipient=?
          AND (delivery_status IS NULL OR delivery_status='sent' OR (delivery_status='delivered' AND ?='read'))`)
          .bind(status.status, status.id, config.phone_number_id, status.recipient_id, status.status).run();
      }
      if (!Array.isArray(value.messages)) continue;
      const remaining = [];
      for (const message of value.messages) {
        const recipient = message?.from;
        const timestamp = typeof message?.timestamp === "string" && /^\d{1,12}$/.test(message.timestamp) ? Number(message.timestamp) * 1000 : NaN;
        if (typeof recipient !== "string" || !/^[1-9]\d{7,14}$/.test(recipient)
          || typeof message?.id !== "string" || !message.id || message.id.length > 512
          || !Number.isSafeInteger(timestamp) || timestamp <= 0 || timestamp > now()
          || !["text", "image", "audio", "video", "document", "sticker", "location", "contacts", "interactive", "button", "order"].includes(message.type)
          || !message[message.type] || typeof message[message.type] !== "object") { remaining.push(message); continue; }
        const text = typeof message.text?.body === "string" ? message.text.body.trim() : "";
        const pairing = /^RADAR ACTIVAR ([a-f0-9]{64})$/i.exec(text);
        const stop = /^RADAR BAJA$/i.test(text);
        const consumed = Boolean(pairing || stop || /^RADAR ACTIVAR\b/i.test(text));
        const binding = await store.db.prepare(`SELECT id FROM radar_installations
          WHERE phone_number_id=? AND recipient=? AND revoked_at IS NULL AND opted_in_at IS NOT NULL LIMIT 1`)
          .bind(config.phone_number_id, recipient).first();
        if (!binding && !consumed) { remaining.push(message); continue; }
        const claim = crypto.randomUUID();
        const statements = [store.db.prepare("INSERT OR IGNORE INTO radar_inbound (message_id,received_at,processing_token,consumed) VALUES (?,?,?,?) RETURNING message_id")
          .bind(message.id, now(), claim, Number(consumed))];
        if (pairing) statements.push(store.db.prepare(`UPDATE radar_installations
          SET recipient=?,opted_in_at=?,pairing_hash=NULL,pairing_expires_at=NULL
          WHERE pairing_hash=? AND phone_number_id=? AND pairing_expires_at>?
            AND created_at<? AND recipient IS NULL AND revoked_at IS NULL
            AND EXISTS (SELECT 1 FROM radar_inbound WHERE message_id=? AND processing_token=?) RETURNING id`)
          .bind(recipient, timestamp, await sha256(pairing[1]!.toLowerCase()), config.phone_number_id, now(), timestamp + 1000, message.id, claim));
        if (stop) statements.push(store.db.prepare(`UPDATE radar_installations SET opted_in_at=NULL,revoked_at=?,pairing_hash=NULL,pairing_expires_at=NULL
          WHERE phone_number_id=? AND recipient=? AND revoked_at IS NULL
            AND EXISTS (SELECT 1 FROM radar_inbound WHERE message_id=? AND processing_token=?) RETURNING id`)
          .bind(now(), config.phone_number_id, recipient, message.id, claim));
        statements.push(store.db.prepare(`INSERT INTO radar_windows (phone_number_id,recipient,last_user_message_at,message_id)
          SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM radar_installations WHERE phone_number_id=? AND recipient=? AND revoked_at IS NULL AND opted_in_at IS NOT NULL)
          AND EXISTS (SELECT 1 FROM radar_inbound WHERE message_id=? AND processing_token=?)
          ON CONFLICT(phone_number_id,recipient) DO UPDATE SET last_user_message_at=excluded.last_user_message_at,message_id=excluded.message_id
          WHERE excluded.last_user_message_at>radar_windows.last_user_message_at`)
          .bind(config.phone_number_id, recipient, timestamp, message.id, config.phone_number_id, recipient, message.id, claim));
        const results = await store.db.batch(statements);
        if (consumed) {
          if (results[0]?.results.length && now() - timestamp < 86_400_000) {
            const changed = (results[1]?.results.length ?? 0) > 0;
            const body = stop
              ? "Las alertas de RADAR quedaron desactivadas. Tu atención habitual con Manolo continúa disponible."
              : changed ? "Celular vinculado a RADAR. Recibirás las alertas autorizadas mientras esté abierta la ventana de 24 horas. Para cancelarlas escribe RADAR BAJA."
                : "No pudimos vincular ese código de RADAR. Vuelve a pedir el enlace desde el chat de RADAR; el código vence en 10 minutos.";
            const task = acknowledge(env, config.phone_number_id, recipient, body);
            if (background) background(task); else await task;
          }
        } else { remaining.push(message); }
      }
      value.messages = remaining;
    }
  }
  return output;
}
