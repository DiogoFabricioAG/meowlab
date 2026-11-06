import { RadarStore } from "../../radar/store";
import type { RadarContactService, RadarContactStatus } from "../../roles/radar-contracts";
import type { RadarInterestState, RadarSelectionResult } from "../../roles/radar-contracts";
import type { RadarSelectionClient } from "./selection-client";

export class D1RadarContactService implements RadarContactService {
  constructor(private readonly database: D1Database, private readonly tenantId: string,
    private readonly phoneNumberId: string, private readonly recipient: string,
    private readonly now: () => number = () => Date.now(),
    private readonly selectionClient?: RadarSelectionClient) {}

  async setInterest(deliveryId: string, state: RadarInterestState, metaMessageId: string): Promise<RadarSelectionResult> {
    if (!this.selectionClient || !/^[a-f0-9-]{36}$/i.test(deliveryId) || !metaMessageId || metaMessageId.length > 255)
      return { status: "forbidden" };
    const store = new RadarStore(this.database);
    const settings = await store.settings();
    if (!settings || settings.phone_number_id !== this.phoneNumberId) return { status: "forbidden" };
    const channel = await store.db.prepare(`SELECT id FROM whatsapp_numbers
      WHERE tenant_id=? AND phone_number_id=? AND active=1 LIMIT 1`)
      .bind(this.tenantId, this.phoneNumberId).first();
    if (!channel) return { status: "forbidden" };
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
    return this.selectionClient.setInterest({ tenantId: this.tenantId, phoneNumberId: this.phoneNumberId,
      whatsappUserId: this.recipient, installationId: trusted.installation_id, ocid: trusted.ocid,
      state, metaMessageId });
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
