export type StoreDesignReference = {
  designId: string;
  accessToken: string;
};

export type StoreDesignRequest = {
  tenantId: string;
  contactId: number;
  whatsappUserId: string;
  input: string;
  currentDesign: StoreDesignReference | null;
};

export type StoreDesignApprovalRequest = {
  tenantId: string;
  contactId: number;
  whatsappUserId: string;
  designId: string;
  accessToken: string;
  version: number;
};

export type StoreDesignProposal = {
  designId: string;
  accessToken: string;
  version: number;
  brief: string;
  proposalUrl: string;
  imageUrl: string;
};

export type StoreDesignFailureReason =
  | "design_access_invalid"
  | "api_not_configured"
  | "api_error"
  | "invalid_response";

export type StoreDesignApproval = {
  designId: string;
  version: number;
  proposalUrl: string;
  alreadyApproved: boolean;
};

export type StoreDesignResult =
  | { ok: true; proposal: StoreDesignProposal }
  | { ok: false; reason: StoreDesignFailureReason };

export type StoreDesignApprovalResult =
  | { ok: true; approval: StoreDesignApproval }
  | { ok: false; reason: StoreDesignFailureReason };

export interface StoreDesignClient {
  generate(request: StoreDesignRequest): Promise<StoreDesignResult>;
  approve(request: StoreDesignApprovalRequest): Promise<StoreDesignApprovalResult>;
}
