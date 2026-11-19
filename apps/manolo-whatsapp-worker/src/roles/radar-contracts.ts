/** Bound to the authenticated contact by the composition root, never by AI arguments. */
export type RadarContactStatus = {
  available: boolean;
  linked: boolean;
  open: boolean;
  expiresAt: number | null;
};

export type RadarInterestState = "interesting" | "dismissed";
export type RadarSelectionResult = {
  status: "ok" | "forbidden" | "conflict";
  revision?: number;
  changedAt?: string;
  candidate?: import("../radar/sync-contracts").RadarCandidate;
};

export type RadarAcceptedDelivery = {
  deliveryId: string;
  installationId: string;
  ocid: string;
  code: string;
};

export type RadarDeliveryResolution =
  | { status: "resolved"; delivery: RadarAcceptedDelivery }
  | { status: "ambiguous"; candidates: RadarAcceptedDelivery[] }
  | { status: "none" };

export type RadarBasesUploadInput = {
  deliveryId: string;
  ocid: string;
  code: string;
  metaMessageId: string;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  sha256: string;
};

export type RadarBasesUploadResult =
  | { status: "stored"; uploadId: string }
  | { status: "duplicate"; uploadId: string }
  | { status: "forbidden" | "storage_unavailable" };

export interface RadarContactService {
  status(): Promise<RadarContactStatus>;
  latestAlert?(): Promise<import("../radar/presentation").RadarAlertContext | null>;
  alertById?(deliveryId: string): Promise<import("../radar/presentation").RadarAlertContext | null>;
  setInterest?(deliveryId: string, state: RadarInterestState, metaMessageId: string): Promise<RadarSelectionResult>;
  resolveAcceptedDelivery?(deliveryId?: string | null, codeHint?: string | null): Promise<RadarDeliveryResolution>;
  enqueueBasesUpload?(input: RadarBasesUploadInput): Promise<RadarBasesUploadResult>;
}
