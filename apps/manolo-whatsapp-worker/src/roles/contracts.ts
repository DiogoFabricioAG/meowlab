import type { AiProvider } from "../ai/contracts";
import type { BusinessDataRepository } from "../business/contracts";
import type { QuoteNumberAllocator } from "../quotes/numbering";
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
import type { RadarContactService } from "./radar-contracts";

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
  // Set by media normalization after successful analysis, never from image text.
  hasVisualContext?: boolean;
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
  businessData: BusinessDataRepository | null;
  quoteNumberAllocator: QuoteNumberAllocator | null;
  roleState?: RoleStateRepository | null;
  radar?: RadarContactService | null;
  storeDesigner?: StoreDesignClient | null;
  storeCommerce?: StoreCommerceClient | null;
  document?: IncomingDocument | null;
  documentStore?: DocumentStore | null;
  facturaya?: FacturayaClient | null;
  history: readonly ConversationHistoryMessage[];
  reply: (replyText: string) => Promise<void>;
  sendText?: (replyText: string) => Promise<SendResult>;
  sendImage?: (
    imageUrl: string,
    caption: string,
  ) => Promise<SendResult>;
  sendButtons?: (
    body: string,
    buttons: readonly WhatsAppReplyButton[],
  ) => Promise<SendResult>;
  /** A button that opens a link; falls back to text with the link when it cannot be shown. */
  sendCtaUrl?: (
    body: string,
    displayText: string,
    url: string,
  ) => Promise<SendResult>;
  sendList?: (
    body: string,
    buttonText: string,
    sections: readonly WhatsAppListSection[],
  ) => Promise<SendResult>;
  sendDocument: (document: RoleDocument) => Promise<SendResult>;
  /**
   * Stock Cat (ADR-0014): after Invoice Cat issues a document, brings stock up to date and
   * returns the low-stock alert to show in the same chat, or null.
   */
  stockAlertsAfterInvoice?: () => Promise<string | null>;
  /** Renders self-contained print HTML to PDF; absent when no renderer is bound. */
  renderPdf?: (html: string) => Promise<Blob | null>;
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
