import type {
  ConversationHistoryMessage,
  IncomingMessage,
  PersistedInboundMessage,
  SendResult,
  TenantContext,
} from "../roles/contracts";

export type TenantConfiguration = {
  tenantId: string;
  phoneNumberId: string;
  roleKey: string;
  systemPrompt: string;
  aiProvider: string;
  aiModel: string | null;
  temperature: number;
  maxTokens: number;
};

export type TenantLookupResult =
  | { status: "found"; tenant: TenantConfiguration }
  | { status: "not_found" }
  | { status: "unavailable" }
  | { status: "error" };

export interface ConversationRepository {
  findTenant(phoneNumberId: string): Promise<TenantLookupResult>;
  persistInbound(
    message: IncomingMessage,
    tenant: TenantContext,
  ): Promise<PersistedInboundMessage>;
  updateInboundContent(
    message: IncomingMessage,
    tenant: TenantContext,
    content: string,
  ): Promise<void>;
  loadHistory(
    tenant: TenantContext,
    whatsappUserId: string,
  ): Promise<ConversationHistoryMessage[]>;
  persistOutbound(
    tenant: TenantContext,
    conversationId: string | null,
    replyText: string,
    result: SendResult,
    messageType?: string,
  ): Promise<void>;
  resolveContactRole(
    tenant: TenantContext,
    contactId: number | null,
  ): Promise<string | null>;
}
