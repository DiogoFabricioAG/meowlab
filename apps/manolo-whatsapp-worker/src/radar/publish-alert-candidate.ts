import type { RadarAlert, RadarInstallation } from "./contracts";
import { sha256 } from "./contracts";
import type { RadarEvidence } from "./evidence";
import type { RadarStore } from "./store";
import { RadarSyncBridgeClient } from "../adapters/radar/sync-bridge-client";

/** Compatibility for older clients that do not publish a candidate outbox yet. */
export async function publishAlertCandidate(store: RadarStore, installation: RadarInstallation, alert: RadarAlert,
  evidence: RadarEvidence | null, env: Env): Promise<boolean> {
  if (env.VPS_BRIDGE_ENABLED !== "true") return true;
  if (!installation.recipient) return false;
  const channel = await store.db.prepare("SELECT tenant_id FROM whatsapp_numbers WHERE phone_number_id=? AND active=1")
    .bind(installation.phone_number_id).first<{ tenant_id: string }>();
  if (!channel) return false;
  const candidate = { alert, ...(evidence ? { evidence } : {}) };
  const requestId = `radar-alert-candidate:${await sha256(JSON.stringify([installation.id, candidate]))}`;
  const response = await new RadarSyncBridgeClient(env).execute({ version: 1, requestId,
    tenantId: channel.tenant_id, phoneNumberId: installation.phone_number_id, whatsappUserId: installation.recipient,
    installationId: installation.id, operation: "publish_candidates", candidates: [candidate] });
  return response?.status === "ok" && response.published === 1;
}
