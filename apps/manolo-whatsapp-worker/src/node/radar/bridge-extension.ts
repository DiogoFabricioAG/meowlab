import { createHash } from "node:crypto";
import {
  RADAR_SYNC_BRIDGE_PATH,
  isRadarSyncRequest,
  type RadarSyncRequest,
} from "../../radar/sync-contracts";
import type { PgRadarSelectionService } from "./selection-service";
import type { BridgeHttpRequest, BridgeHttpResponse } from "../bridge/http-handler";
import { verifyBridgeSignature } from "../bridge/signature-verifier";

export { PgRadarSelectionService } from "./selection-service";

type LegacyDependencies = {
  sharedSecret: string;
  log?: (event: string, details?: Record<string, unknown>) => void;
  nowSeconds?: () => number;
};
type LegacyHandler = (request: BridgeHttpRequest) => Promise<BridgeHttpResponse>;
type LegacyFactory = (dependencies: any) => LegacyHandler;
type SelectionExecutor = Pick<PgRadarSelectionService, "execute">;

function jsonResponse(status: number, body: Record<string, unknown>): BridgeHttpResponse {
  return {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
    body: JSON.stringify(body),
  };
}

export function createRadarBridgeExtension(
  legacyFactory: LegacyFactory,
  selectionService: SelectionExecutor | null | undefined,
  dependencies: LegacyDependencies,
): LegacyHandler {
  const legacyHandler = legacyFactory(dependencies);
  return async (request) => {
    if (request.path !== RADAR_SYNC_BRIDGE_PATH) return legacyHandler(request);
    if (request.method !== "POST") return jsonResponse(405, { error: "method_not_allowed" });

    const verification = verifyBridgeSignature(
      request.body,
      request.headers["x-manolo-timestamp"],
      request.headers["x-manolo-signature"],
      dependencies.sharedSecret,
      dependencies.nowSeconds?.(),
    );
    if (!verification.valid) {
      dependencies.log?.("vps_bridge_auth_rejected", { reason: verification.reason });
      return jsonResponse(401, { error: "unauthorized" });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(request.body);
    } catch {
      return jsonResponse(400, { error: "invalid_json" });
    }
    const requestId = typeof payload === "object" && payload !== null && "requestId" in payload
      && typeof payload.requestId === "string" ? payload.requestId : null;
    const headerRequestId = request.headers["x-manolo-request-id"];
    if (!headerRequestId || requestId !== headerRequestId) {
      return jsonResponse(400, { error: "request_id_mismatch" });
    }
    if (!isRadarSyncRequest(payload)) return jsonResponse(400, { error: "invalid_request" });
    if (!selectionService) return jsonResponse(503, { error: "radar_unavailable" });

    const requestHash = createHash("sha256").update(request.body, "utf8").digest("hex");
    try {
      const response = await selectionService.execute(payload as RadarSyncRequest, requestHash);
      return jsonResponse(200, response);
    } catch {
      dependencies.log?.("vps_radar_sync_failed", { reason: "database_error" });
      return jsonResponse(503, { error: "radar_unavailable" });
    }
  };
}
