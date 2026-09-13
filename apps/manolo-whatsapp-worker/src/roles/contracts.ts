import type { AiProvider } from "../ai/contracts";
import type { BusinessDataRepository } from "../business/contracts";
import type { QuoteNumberAllocator } from "../quotes/numbering";
import type {
  FinanceProposal,
  FinanceRepository,
} from "../finance/contracts";
import type {
  WhatsAppReplyButton,
  WhatsAppListSection,
  WhatsAppSendResult,
} from "../whatsapp/contracts";
import type { StoreDesignClient } from "../store-designer/contracts";
import type { StoreCommerceClient } from "../store-commerce/contracts";
import type { IncomingDocument, DocumentStore } from "../documents/contracts";
import type { FacturayaClient } from "../facturaya/contracts";
import type { RoleStateRepository } from "./state";

export type IncomingMessage = {
  id: string | null;
  interactionId: string | null;
  phoneNumberId: string;
  to: string;
  inputType: "text" | "audio" | "image" | "document";
  audioMediaId?: string | null;
  audioMimeType?: string | null;
  imageMediaId?: string | null;
  imageMimeType?: string | null;
  imageCaption?: string;
  documentMediaId?: string | null;
  documentMimeType?: string | null;
  documentFilename?: string | null;
  documentCaption?: string;
  text: string;
};

export type TenantContext = {
  tenantId: string;
  phoneNumberId: string;
  roleKey: string;
  systemPrompt: string;
  aiProvider: string;
  aiModel: string;
  temperature: number;
  maxTokens: number;
  aiReasoningEffort?: "low" | "medium" | "high";
};

export type PersistedInboundMessage = {
  duplicate: boolean;
  conversationId: string | null;
  contactId: number | null;
};

export type ConversationHistoryMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
};

export type SendResult = WhatsAppSendResult;

export type RoleDocument = {
  pdf: Blob;
  filename: string;
  caption: string;
};

export type { FinanceProposal };

export type PendingActionRow = {
  id: string;
  payload_json: string;
};

export type FinanceExtractionResult = {
  status: "detected" | "needs_clarification" | "error";
  message: string;
  proposal?: FinanceProposal;
};

export type RoleLog = (
  event: string,
  details?: Record<string, unknown>,
) => void;

export type RoleHandlerContext = {
  message: IncomingMessage;
  tenant: TenantContext;
  persisted: PersistedInboundMessage;
  env: Env;
  ai: AiProvider | null;
  finance: FinanceRepository | null;
  businessData: BusinessDataRepository | null;
  quoteNumberAllocator: QuoteNumberAllocator | null;
  roleState?: RoleStateRepository | null;
  storeDesigner?: StoreDesignClient | null;
  storeCommerce?: StoreCommerceClient | null;
  document?: IncomingDocument | null;
  documentStore?: DocumentStore | null;
  facturaya?: FacturayaClient | null;
  history: readonly ConversationHistoryMessage[];
  reply: (replyText: string) => Promise<void>;
  sendImage?: (
    imageUrl: string,
    caption: string,
  ) => Promise<SendResult>;
  sendButtons?: (
    body: string,
    buttons: readonly WhatsAppReplyButton[],
  ) => Promise<SendResult>;
  sendList?: (
    body: string,
    buttonText: string,
    sections: readonly WhatsAppListSection[],
  ) => Promise<SendResult>;
  sendDocument: (document: RoleDocument) => Promise<SendResult>;
  generateAiReply: () => Promise<string | null>;
  generateAiReplyWithHistory: () => Promise<string | null>;
  fallbackReply: string;
  log: RoleLog;
};

export interface RoleHandler {
  readonly key: string;
  configure(tenant: TenantContext): TenantContext;
  handle(context: RoleHandlerContext): Promise<void>;
}
