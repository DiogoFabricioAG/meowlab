import { validateAlert, type RadarAlert } from "./contracts";
import { validateEvidence, type RadarEvidence } from "./evidence";

export const RADAR_SYNC_BRIDGE_PATH = "/v1/roles/radar/sync";
export type RadarCandidate = { alert: RadarAlert; evidence?: RadarEvidence };
export type RadarSelectionState = "interesting" | "dismissed";
export type RadarChange = { seq: number; ocid: string; state: RadarSelectionState; changedAt: string; candidate: RadarCandidate };
export type RadarSyncRequest = {
  version: 1; requestId: string; tenantId: string; phoneNumberId: string; whatsappUserId: string; installationId: string;
  operation: "publish_candidates" | "select_candidate" | "pull_changes" | "ack_changes";
  candidates?: RadarCandidate[]; ocid?: string; state?: RadarSelectionState; metaMessageId?: string;
  after?: number; limit?: number; cursor?: number;
};
export type RadarSyncResponse = {
  version: 1; requestId: string; status: "ok" | "forbidden" | "conflict";
  published?: number; changes?: RadarChange[]; cursor?: number; ackedCursor?: number; selection?: RadarChange;
};
const text = (s: unknown, max: number) => typeof s === "string" && s.length > 0 && s.length <= max && !/[\u0000-\u001f]/u.test(s);
export const radarCursor = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function validateRadarCandidate(value: unknown): RadarCandidate | null {
  try {
    if (!value || typeof value !== "object") return null;
    const v = value as RadarCandidate;
    const alert = validateAlert(v.alert);
    if (!alert) return null;
    const evidence = v.evidence === undefined ? undefined : validateEvidence(v.evidence, alert.ocid);
    return evidence === null ? null : { alert, ...(evidence ? { evidence } : {}) };
  } catch { return null; }
}

export function isRadarSyncRequest(value: unknown): value is RadarSyncRequest {
  if (!value || typeof value !== "object") return false;
  const v = value as RadarSyncRequest;
  if (v.version !== 1 || !text(v.requestId, 255) || !text(v.tenantId, 120) || !text(v.installationId, 100)
    || !/^\d{5,30}$/.test(v.phoneNumberId) || !/^[1-9]\d{7,14}$/.test(v.whatsappUserId)) return false;
  if (v.operation === "publish_candidates") return Array.isArray(v.candidates) && v.candidates.length > 0
    && v.candidates.length <= 20 && v.candidates.every(c => validateRadarCandidate(c) !== null);
  if (v.operation === "select_candidate") return text(v.ocid, 200) && ["interesting", "dismissed"].includes(v.state!) && text(v.metaMessageId, 255);
  if (v.operation === "pull_changes") return radarCursor(v.after) && Number.isInteger(v.limit) && v.limit! > 0 && v.limit! <= 100;
  if (v.operation === "ack_changes") return radarCursor(v.cursor);
  return false;
}

export function isRadarChange(value: unknown): value is RadarChange {
  if (!value || typeof value !== "object") return false;
  const v = value as RadarChange;
  const c = validateRadarCandidate(v.candidate);
  return radarCursor(v.seq) && v.seq > 0 && ["interesting", "dismissed"].includes(v.state)
    && typeof v.changedAt === "string" && Number.isFinite(Date.parse(v.changedAt)) && c !== null && v.ocid === c.alert.ocid;
}

export function isRadarSyncResponse(value: unknown): value is RadarSyncResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as RadarSyncResponse;
  return v.version === 1 && text(v.requestId, 255) && ["ok", "forbidden", "conflict"].includes(v.status)
    && (v.cursor === undefined || radarCursor(v.cursor)) && (v.ackedCursor === undefined || radarCursor(v.ackedCursor))
    && (v.published === undefined || radarCursor(v.published))
    && (v.changes === undefined || (Array.isArray(v.changes) && v.changes.length <= 100 && v.changes.every(isRadarChange)))
    && (v.selection === undefined || isRadarChange(v.selection));
}
