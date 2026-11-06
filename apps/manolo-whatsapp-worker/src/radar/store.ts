import { sha256, type RadarInstallation, type RadarSettings } from "./contracts";
import { validateAlert, type RadarAlert } from "./contracts";
import type { RadarAlertContext } from "./presentation";
import { validateEvidence, type RadarEvidence } from "./evidence";
import { ALERT_INTERVAL_MS, nextAlertTime } from "./pacing";

export class RadarStore {
  // Always use the primary: windows/revocations must not come from stale replicas.
  readonly db: D1DatabaseSession;
  constructor(database: D1Database) { this.db = database.withSession("first-primary"); }

  async settings(): Promise<RadarSettings | null> {
    const installed = await this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='radar_settings'").first();
    if (!installed) return null; // Existing deployments without 0014 keep Manolo unchanged.
    const config = await this.db.prepare("SELECT * FROM radar_settings WHERE id=1").first<RadarSettings>();
    return config?.enabled && /^\d+$/.test(config.phone_number_id) && /^[1-9]\d{7,14}$/.test(config.public_number) ? config : null;
  }

  async authenticate(token: string): Promise<RadarInstallation | null> {
    if (!/^[a-f0-9]{64}$/.test(token)) return null;
    return this.db.prepare("SELECT * FROM radar_installations WHERE token_hash=? AND revoked_at IS NULL")
      .bind(await sha256(token)).first<RadarInstallation>();
  }

  async saveAlertContext(deliveryId: string, alert: RadarAlert, message: string, now: number, sentAt = now): Promise<void> {
    await this.db.batch([
      this.db.prepare("DELETE FROM radar_alert_context WHERE expires_at<=?").bind(now),
      this.db.prepare(`INSERT INTO radar_alert_context(delivery_id,facts_json,message_text,created_at,expires_at)
        VALUES(?,?,?,?,?) ON CONFLICT(delivery_id) DO NOTHING`)
        .bind(deliveryId, JSON.stringify(alert), message, sentAt, sentAt + 48 * 3_600_000),
    ]);
  }

  async preparedAlertText(deliveryId: string, now: number): Promise<string | null> {
    const row = await this.db.prepare("SELECT message_text FROM radar_alert_context WHERE delivery_id=? AND expires_at>?")
      .bind(deliveryId, now).first<{ message_text: string }>();
    return row?.message_text ?? null;
  }

  async saveEvidence(deliveryId: string, evidence: RadarEvidence, now: number, installationId: string): Promise<void> {
    // Supplemental public facts do not mutate the delivery hash, TTL or window.
    await this.db.prepare(`UPDATE radar_alert_context SET facts_json=json_set(facts_json,'$.evidence',json(?))
      WHERE delivery_id=? AND expires_at>?
        AND EXISTS(SELECT 1 FROM radar_deliveries d WHERE d.id=delivery_id AND d.installation_id=?)
        AND (json_extract(facts_json,'$.evidence.observedAt') IS NULL
          OR julianday(json_extract(facts_json,'$.evidence.observedAt'))<=julianday(?))`)
      .bind(JSON.stringify(evidence), deliveryId, now, installationId, evidence.observedAt).run();
  }

  async latestAlert(phoneNumberId: string, recipient: string, now: number, deliveryId: string | null = null): Promise<RadarAlertContext | null> {
    const row = await this.db.prepare(`SELECT d.id,c.facts_json,c.created_at,c.expires_at FROM radar_alert_context c
      JOIN radar_deliveries d ON d.id=c.delivery_id
      JOIN radar_installations i ON i.id=d.installation_id
      WHERE d.phone_number_id=? AND d.recipient=? AND d.state='accepted'
        AND i.revoked_at IS NULL AND i.opted_in_at IS NOT NULL AND c.expires_at>?
        AND (? IS NULL OR d.id=?)
      ORDER BY c.created_at DESC,c.delivery_id DESC LIMIT 1`)
      .bind(phoneNumberId, recipient, now, deliveryId, deliveryId).first<{ id: string; facts_json: string; created_at: number; expires_at: number }>();
    if (!row) return null;
    try {
      const facts = JSON.parse(row.facts_json);
      const alert = validateAlert(facts);
      const evidence = alert ? validateEvidence(facts.evidence, alert.ocid) : null;
      return alert ? { deliveryId: row.id, alert, ...(evidence ? { evidence } : {}), sentAt: row.created_at, expiresAt: row.expires_at } : null;
    } catch { return null; }
  }

  async rateLimit(key: string, maximum: number, now: number, period = 3_600_000): Promise<boolean> {
    const slot = Math.floor(now / period);
    const result = await this.db.prepare(`INSERT INTO radar_rate_limits (key,count,expires_at) VALUES (?,1,?)
      ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count`)
      .bind(`${key}:${slot}`, (slot + 1) * period).first<{ count: number }>();
    return Boolean(result && result.count <= maximum);
  }

  async nextAlertAt(installation: Pick<RadarInstallation, "phone_number_id" | "recipient">, now: number): Promise<number> {
    // Existing durable reservations survive restarts and span installations of the same recipient.
    const last = await this.db.prepare(`SELECT MAX(created_at) AS time FROM radar_deliveries
      WHERE phone_number_id=? AND recipient=? AND state IN ('sending','accepted','unknown')`)
      .bind(installation.phone_number_id, installation.recipient).first<{ time: number | null }>();
    return nextAlertTime(Math.max(now, last?.time == null ? now : last.time + ALERT_INTERVAL_MS));
  }

  async window(installation: Pick<RadarInstallation, "phone_number_id" | "recipient">, now: number): Promise<{ open: boolean; expiresAt: number | null }> {
    const row = await this.db.prepare("SELECT last_user_message_at FROM radar_windows WHERE phone_number_id=? AND recipient=?")
      .bind(installation.phone_number_id, installation.recipient).first<{ last_user_message_at: number }>();
    const time = row?.last_user_message_at;
    return { open: time !== undefined && time <= now && now - time < 86_400_000,
      expiresAt: time === undefined ? null : time + 86_400_000 };
  }

  async revoke(installation: RadarInstallation, now: number): Promise<void> {
    await this.db.prepare(`UPDATE radar_installations SET revoked_at=?, pairing_hash=NULL,
      pairing_expires_at=NULL, opted_in_at=NULL WHERE id=?`).bind(now, installation.id).run();
  }
}
