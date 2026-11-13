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

export interface RadarContactService {
  status(): Promise<RadarContactStatus>;
  latestAlert?(): Promise<import("../radar/presentation").RadarAlertContext | null>;
  alertById?(deliveryId: string): Promise<import("../radar/presentation").RadarAlertContext | null>;
  setInterest?(deliveryId: string, state: RadarInterestState, metaMessageId: string): Promise<RadarSelectionResult>;
}
