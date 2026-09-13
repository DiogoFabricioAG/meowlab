import {
  BRIDGE_PROTOCOL_VERSION,
  type PrintAdvisorBridgeRequest,
  type PrintAdvisorBridgeResponse,
} from "../../bridge/contracts";
import type { AiProvider } from "../../ai/contracts";
import type { BusinessDataRepository } from "../../business/contracts";
import type { RoleLog, TenantContext } from "../../roles/contracts";
import {
  generatePrintAdvisorReply,
  PRINT_ADVISOR_PROVIDER,
  PRINT_ADVISOR_ROLE_KEY,
} from "../../roles/print-advisor-role";
import type {
  BridgeRequestIdentity,
  BridgeRequestStore,
} from "./request-store";

export type BridgeServiceResult =
  | { status: "completed"; response: PrintAdvisorBridgeResponse }
  | { status: "in_progress" }
  | { status: "conflict" };

export type PrintAdvisorBridgeServiceOptions = {
  aiModel?: string;
};

export class PrintAdvisorBridgeService {
  constructor(
    private readonly ai: AiProvider,
    private readonly businessData: BusinessDataRepository,
    private readonly requestStore: BridgeRequestStore,
    private readonly log: RoleLog,
    private readonly options: PrintAdvisorBridgeServiceOptions = {},
  ) {}

  async process(
    request: PrintAdvisorBridgeRequest,
    requestHash: string,
  ): Promise<BridgeServiceResult> {
    const identity: BridgeRequestIdentity = {
      requestId: request.requestId,
      tenantId: request.tenant.tenantId,
      roleKey: PRINT_ADVISOR_ROLE_KEY,
      requestHash,
    };
    const claim = await this.requestStore.claim(identity);
    if (claim.status === "conflict" || claim.status === "in_progress") {
      return claim;
    }
    if (claim.status === "completed") {
      return {
        status: "completed",
        response: {
          version: BRIDGE_PROTOCOL_VERSION,
          requestId: request.requestId,
          replyText: claim.replyText,
          replayed: true,
        },
      };
    }

    const tenant: TenantContext = {
      tenantId: request.tenant.tenantId,
      phoneNumberId: request.tenant.phoneNumberId,
      roleKey: PRINT_ADVISOR_ROLE_KEY,
      systemPrompt: request.tenant.systemPrompt,
      aiProvider: PRINT_ADVISOR_PROVIDER,
      aiModel: this.options.aiModel?.trim() || request.tenant.aiModel,
      temperature: request.tenant.temperature,
      maxTokens: request.tenant.maxTokens,
    };

    try {
      const replyText = await generatePrintAdvisorReply({
        tenant,
        ai: this.ai,
        businessData: this.businessData,
        history: request.history,
        messageText: request.message.text,
        log: this.log,
      });
      await this.requestStore.complete(identity, replyText);
      return {
        status: "completed",
        response: {
          version: BRIDGE_PROTOCOL_VERSION,
          requestId: request.requestId,
          replyText,
          replayed: false,
        },
      };
    } catch (error) {
      await this.requestStore.fail(identity, "processing_error");
      throw error;
    }
  }
}
