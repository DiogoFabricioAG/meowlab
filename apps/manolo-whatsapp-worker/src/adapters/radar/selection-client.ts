import type { RadarInterestState, RadarSelectionResult } from "../../roles/radar-contracts";
import type { RadarSyncRequest, RadarSyncResponse } from "../../radar/sync-contracts";

export type TrustedRadarSelection = {
  tenantId: string;
  phoneNumberId: string;
  whatsappUserId: string;
  installationId: string;
  ocid: string;
  state: RadarInterestState;
  metaMessageId: string;
};

export interface RadarSelectionClient {
  setInterest(input: TrustedRadarSelection): Promise<RadarSelectionResult>;
}

export interface RadarSyncExecutor {
  execute(request: RadarSyncRequest): Promise<RadarSyncResponse | null>;
}

/** Converts a D1-authorized WhatsApp selection into the signed VPS sync call. */
export class RadarSelectionGateway implements RadarSelectionClient {
  constructor(private readonly sync: RadarSyncExecutor) {}

  async setInterest(input: TrustedRadarSelection): Promise<RadarSelectionResult> {
    const requestId = await selectionRequestId(input.metaMessageId);
    const response = await this.sync.execute({ version: 1, requestId, tenantId: input.tenantId,
      phoneNumberId: input.phoneNumberId, whatsappUserId: input.whatsappUserId,
      installationId: input.installationId, operation: "select_candidate", ocid: input.ocid,
      state: input.state, metaMessageId: input.metaMessageId });
    if (!response) throw new Error("radar_selection_sync_uncertain");
    if (response.status !== "ok") return { status: response.status };
    if (!response.selection || response.selection.ocid !== input.ocid || response.selection.state !== input.state)
      throw new Error("radar_selection_sync_unconfirmed");
    return { status: "ok", revision: response.selection.seq, changedAt: response.selection.changedAt,
      candidate: response.selection.candidate };
  }
}

async function selectionRequestId(metaMessageId: string): Promise<string> {
  const direct = `radar-selection:${metaMessageId}`;
  if (direct.length <= 255) return direct;
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(metaMessageId));
  const hex = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
  return `radar-selection:${hex}`;
}
