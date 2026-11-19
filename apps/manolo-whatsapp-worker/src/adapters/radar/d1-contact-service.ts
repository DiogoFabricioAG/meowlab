import { RadarStore } from "../../radar/store";
import type {
  RadarAcceptedDelivery,
  RadarBasesUploadInput,
  RadarBasesUploadResult,
  RadarContactService,
  RadarContactStatus,
  RadarDeliveryResolution,
  RadarInterestState,
  RadarSelectionResult,
} from "../../roles/radar-contracts";
import type { RadarSelectionClient } from "./selection-client";

const BASES_UPLOAD_TTL_MS = 7 * 24 * 3_600_000;
const RECENT_DELIVERY_MS = 48 * 3_600_000;

type DeliveryRow = {
  id: string;
  installation_id: string;
  ocid: string;
  created_at: number;
  code: string | null;
  expires_at: number | null;
};

function toAcceptedDelivery(row: DeliveryRow): RadarAcceptedDelivery {
  const code = typeof row.code === "string" && row.code.trim() ? row.code.trim() : row.ocid;
  return {
    deliveryId: row.id,
    installationId: row.installation_id,
    ocid: row.ocid,
    code,
  };
}

export class D1RadarContactService implements RadarContactService {
  constructor(
    private readonly database: D1Database,
    private readonly tenantId: string,
    private readonly phoneNumberId: string,
    private readonly recipient: string,
    private readonly now: () => number = () => Date.now(),
    private readonly selectionClient?: RadarSelectionClient,
    private readonly bucket?: R2Bucket | null,
  ) {}

  private async hasActiveChannel(store: RadarStore): Promise<boolean> {
    const settings = await store.settings();
    if (!settings || settings.phone_number_id !== this.phoneNumberId) return false;
    const channel = await store.db.prepare(
      "SELECT id FROM whatsapp_numbers WHERE tenant_id=? AND phone_number_id=? AND active=1 LIMIT 1",
    )
      .bind(this.tenantId, this.phoneNumberId)
      .first();
    return Boolean(channel);
  }

  async setInterest(deliveryId: string, state: RadarInterestState, metaMessageId: string): Promise<RadarSelectionResult> {
    if (!this.selectionClient || !/^[a-f0-9-]{36}$/i.test(deliveryId) || !metaMessageId || metaMessageId.length > 255)
      return { status: "forbidden" };
    const store = new RadarStore(this.database);
    if (!(await this.hasActiveChannel(store))) return { status: "forbidden" };
    // Delivery and installation are durable D1 records. Do not depend on the
    // 48-hour alert_context cache: genuine old button clicks may still select.
    const trusted = await store.db.prepare(`SELECT d.ocid,i.id AS installation_id
      FROM radar_deliveries d
      JOIN radar_installations i ON i.id=d.installation_id
      WHERE d.id=? AND d.phone_number_id=? AND d.recipient=? AND d.state='accepted'
        AND i.phone_number_id=d.phone_number_id AND i.recipient=d.recipient
        AND i.revoked_at IS NULL AND i.opted_in_at IS NOT NULL LIMIT 1`)
      .bind(deliveryId, this.phoneNumberId, this.recipient)
      .first<{ ocid: string; installation_id: string }>();
    if (!trusted) return { status: "forbidden" };
    return this.selectionClient.setInterest({
      tenantId: this.tenantId,
      phoneNumberId: this.phoneNumberId,
      whatsappUserId: this.recipient,
      installationId: trusted.installation_id,
      ocid: trusted.ocid,
      state,
      metaMessageId,
    });
  }

  async resolveAcceptedDelivery(deliveryId?: string | null, codeHint?: string | null): Promise<RadarDeliveryResolution> {
    const store = new RadarStore(this.database);
    if (!(await this.hasActiveChannel(store))) return { status: "none" };
    const now = this.now();

    if (deliveryId && /^[a-f0-9-]{36}$/i.test(deliveryId)) {
      const exact = await store.db.prepare(`SELECT d.id,d.installation_id,d.ocid,d.created_at,
        json_extract(c.facts_json,'$.code') AS code,c.expires_at
        FROM radar_deliveries d
        JOIN radar_installations i ON i.id=d.installation_id
        LEFT JOIN radar_alert_context c ON c.delivery_id=d.id
        WHERE d.id=? AND d.phone_number_id=? AND d.recipient=? AND d.state='accepted'
          AND i.phone_number_id=d.phone_number_id AND i.recipient=d.recipient
          AND i.revoked_at IS NULL AND i.opted_in_at IS NOT NULL LIMIT 1`)
        .bind(deliveryId, this.phoneNumberId, this.recipient)
        .first<DeliveryRow>();
      if (exact) return { status: "resolved", delivery: toAcceptedDelivery(exact) };
    }

    const { results } = await store.db.prepare(`SELECT d.id,d.installation_id,d.ocid,d.created_at,
      json_extract(c.facts_json,'$.code') AS code,c.expires_at
      FROM radar_deliveries d
      JOIN radar_installations i ON i.id=d.installation_id
      LEFT JOIN radar_alert_context c ON c.delivery_id=d.id
      WHERE d.phone_number_id=? AND d.recipient=? AND d.state='accepted'
        AND i.phone_number_id=d.phone_number_id AND i.recipient=d.recipient
        AND i.revoked_at IS NULL AND i.opted_in_at IS NOT NULL
      ORDER BY d.created_at DESC, d.id DESC LIMIT 20`)
      .bind(this.phoneNumberId, this.recipient)
      .all<DeliveryRow>();

    const rows = results ?? [];
    if (!rows.length) return { status: "none" };

    const normalizedHint = codeHint?.trim().toLowerCase() ?? "";
    if (normalizedHint.length >= 4) {
      const hinted = rows.filter((row) => {
        const delivery = toAcceptedDelivery(row);
        return delivery.code.toLowerCase() === normalizedHint
          || normalizedHint.includes(delivery.code.toLowerCase())
          || normalizedHint.includes(delivery.ocid.toLowerCase());
      });
      if (hinted.length === 1) return { status: "resolved", delivery: toAcceptedDelivery(hinted[0]!) };
      if (hinted.length > 1) return { status: "ambiguous", candidates: hinted.map(toAcceptedDelivery) };
    }

    const active = rows.filter((row) => (row.expires_at !== null ? row.expires_at > now : row.created_at > now - RECENT_DELIVERY_MS));
    if (active.length === 1) return { status: "resolved", delivery: toAcceptedDelivery(active[0]!) };
    if (active.length > 1) return { status: "ambiguous", candidates: active.map(toAcceptedDelivery) };
    return { status: "none" };
  }

  async enqueueBasesUpload(input: RadarBasesUploadInput): Promise<RadarBasesUploadResult> {
    if (!this.bucket) return { status: "storage_unavailable" };
    if (!/^[a-f0-9-]{36}$/i.test(input.deliveryId) || !input.metaMessageId || input.metaMessageId.length > 255) {
      return { status: "forbidden" };
    }
    const store = new RadarStore(this.database);
    if (!(await this.hasActiveChannel(store))) return { status: "forbidden" };

    const trusted = await store.db.prepare(`SELECT d.id,d.ocid,i.id AS installation_id
      FROM radar_deliveries d
      JOIN radar_installations i ON i.id=d.installation_id
      WHERE d.id=? AND d.ocid=? AND d.phone_number_id=? AND d.recipient=? AND d.state='accepted'
        AND i.phone_number_id=d.phone_number_id AND i.recipient=d.recipient
        AND i.revoked_at IS NULL AND i.opted_in_at IS NOT NULL LIMIT 1`)
      .bind(input.deliveryId, input.ocid, this.phoneNumberId, this.recipient)
      .first<{ id: string; ocid: string; installation_id: string }>();
    if (!trusted) return { status: "forbidden" };

    const existing = await store.db.prepare(
      "SELECT id FROM radar_bases_uploads WHERE phone_number_id=? AND recipient=? AND meta_message_id=? LIMIT 1",
    )
      .bind(this.phoneNumberId, this.recipient, input.metaMessageId)
      .first<{ id: string }>();
    if (existing) return { status: "duplicate", uploadId: existing.id };

    const uploadId = crypto.randomUUID();
    const r2Key = `radar-bases/${trusted.installation_id}/${uploadId}`;
    try {
      await this.bucket.put(r2Key, input.bytes, {
        httpMetadata: { contentType: input.mimeType },
        customMetadata: {
          filename: input.filename.slice(0, 255),
          sha256: input.sha256,
        },
      });
    } catch {
      return { status: "storage_unavailable" };
    }

    const now = this.now();
    const inserted = await store.db.prepare(`INSERT INTO radar_bases_uploads (
      id,installation_id,phone_number_id,recipient,delivery_id,ocid,code,meta_message_id,
      r2_key,filename,mime_type,byte_size,sha256,status,created_at,updated_at,expires_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?)
      ON CONFLICT(phone_number_id,recipient,meta_message_id) DO NOTHING
      RETURNING id`)
      .bind(
        uploadId,
        trusted.installation_id,
        this.phoneNumberId,
        this.recipient,
        trusted.id,
        trusted.ocid,
        input.code.slice(0, 200),
        input.metaMessageId,
        r2Key,
        input.filename.slice(0, 180),
        input.mimeType.slice(0, 120),
        input.bytes.byteLength,
        input.sha256,
        now,
        now,
        now + BASES_UPLOAD_TTL_MS,
      )
      .first<{ id: string }>();

    if (!inserted) {
      await this.bucket.delete(r2Key).catch(() => {});
      const winner = await store.db.prepare(
        "SELECT id FROM radar_bases_uploads WHERE phone_number_id=? AND recipient=? AND meta_message_id=? LIMIT 1",
      )
        .bind(this.phoneNumberId, this.recipient, input.metaMessageId)
        .first<{ id: string }>();
      return winner ? { status: "duplicate", uploadId: winner.id } : { status: "storage_unavailable" };
    }

    return { status: "stored", uploadId: inserted.id };
  }

  async status(): Promise<RadarContactStatus> {
    const unavailable: RadarContactStatus = { available: false, linked: false, open: false, expiresAt: null };
    const store = new RadarStore(this.database);
    const config = await store.settings();
    if (!config || config.phone_number_id !== this.phoneNumberId) return unavailable;
    const channel = await store.db.prepare("SELECT id FROM whatsapp_numbers WHERE tenant_id=? AND phone_number_id=? AND active=1")
      .bind(this.tenantId, this.phoneNumberId).first();
    if (!channel) return unavailable;
    const installation = await store.db.prepare(`SELECT id FROM radar_installations
      WHERE phone_number_id=? AND recipient=? AND revoked_at IS NULL AND opted_in_at IS NOT NULL LIMIT 1`)
      .bind(this.phoneNumberId, this.recipient).first();
    if (!installation) return { ...unavailable, available: true };
    const window = await store.window({ phone_number_id: this.phoneNumberId, recipient: this.recipient }, this.now());
    return { available: true, linked: true, open: window.open, expiresAt: window.expiresAt };
  }

  async latestAlert() {
    const status = await this.status();
    if (!status.available || !status.linked) return null;
    return new RadarStore(this.database).latestAlert(this.phoneNumberId, this.recipient, this.now());
  }

  async alertById(deliveryId: string) {
    const status = await this.status();
    if (!status.available || !status.linked) return null;
    return new RadarStore(this.database).latestAlert(this.phoneNumberId, this.recipient, this.now(), deliveryId);
  }
}
