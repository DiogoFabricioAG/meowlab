import { sha256, type RadarInstallation, type RadarSettings } from "./contracts";

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

  async rateLimit(key: string, maximum: number, now: number, period = 3_600_000): Promise<boolean> {
    const slot = Math.floor(now / period);
    const result = await this.db.prepare(`INSERT INTO radar_rate_limits (key,count,expires_at) VALUES (?,1,?)
      ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count`)
      .bind(`${key}:${slot}`, (slot + 1) * period).first<{ count: number }>();
    return Boolean(result && result.count <= maximum);
  }

  async window(installation: RadarInstallation, now: number): Promise<{ open: boolean; expiresAt: number | null }> {
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
