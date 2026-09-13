export type BridgeRequestClaim =
  | { status: "claimed" }
  | { status: "completed"; replyText: string }
  | { status: "in_progress" }
  | { status: "conflict" };

export type BridgeRequestIdentity = {
  requestId: string;
  tenantId: string;
  roleKey: string;
  requestHash: string;
};

export interface BridgeRequestStore {
  claim(identity: BridgeRequestIdentity): Promise<BridgeRequestClaim>;
  complete(identity: BridgeRequestIdentity, replyText: string): Promise<void>;
  fail(identity: BridgeRequestIdentity, errorCode: string): Promise<void>;
}
