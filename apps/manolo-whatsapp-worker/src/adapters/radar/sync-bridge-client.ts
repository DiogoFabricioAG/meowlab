import { signBridgePayload } from "../../bridge/signature";
import { RADAR_SYNC_BRIDGE_PATH, isRadarSyncResponse, type RadarSyncRequest, type RadarSyncResponse } from "../../radar/sync-contracts";
import type { RoleLog } from "../../roles/contracts";

export class RadarSyncBridgeClient {
  constructor(private readonly env: Env, private readonly log: RoleLog = () => {}) {}

  async execute(request: RadarSyncRequest): Promise<RadarSyncResponse | null> {
    if (this.env.VPS_BRIDGE_ENABLED !== "true" || !this.env.VPS_BRIDGE_API_URL || !this.env.VPS_BRIDGE_HMAC_SECRET) return null;
    try {
      const url = new URL(this.env.VPS_BRIDGE_API_URL);
      if (url.protocol !== "https:" || url.username || url.password) return null;
      url.pathname = url.pathname.replace(/\/$/, "") + RADAR_SYNC_BRIDGE_PATH;
      url.search = ""; url.hash = "";
      const body = JSON.stringify(request), timestamp = String(Math.floor(Date.now() / 1000));
      const response = await fetch(url, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(15_000),
        headers: { "Content-Type": "application/json", "X-Manolo-Request-Id": request.requestId,
          "X-Manolo-Timestamp": timestamp, "X-Manolo-Signature": await signBridgePayload(this.env.VPS_BRIDGE_HMAC_SECRET, timestamp, body) }, body });
      if (!response.ok) { await response.body?.cancel(); this.log("radar_sync_bridge_failed", { status: response.status }); return null; }
      const reader = response.body?.getReader();
      if (!reader) return null;
      const chunks: Uint8Array[] = []; let size = 0;
      try { while (true) { const { done, value } = await reader.read(); if (done) break;
        size += value.length; if (size > 4 * 1024 * 1024) { await reader.cancel(); return null; } chunks.push(value); }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const data: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      return isRadarSyncResponse(data) && data.requestId === request.requestId ? data : null;
    } catch { this.log("radar_sync_bridge_failed", { reason: "transport_uncertain" }); return null; }
  }
}
