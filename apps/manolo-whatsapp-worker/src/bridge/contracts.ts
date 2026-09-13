import type {
  ConversationHistoryMessage,
  IncomingMessage,
  TenantContext,
} from "../roles/contracts";

export const PRINT_ADVISOR_BRIDGE_PATH = "/v1/roles/print-advisor/respond";
export const CONTACT_ROLE_RESOLUTION_PATH = "/v1/control/contacts/resolve-role";
export const PLATFORM_INBOUND_SYNC_PATH = "/v1/platform/sync/inbound";
export const PLATFORM_OUTBOUND_SYNC_PATH = "/v1/platform/sync/outbound";
export const BRIDGE_PROTOCOL_VERSION = 1 as const;

const MAX_REQUEST_ID_LENGTH = 255;
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_HISTORY_MESSAGES = 20;
const MAX_HISTORY_MESSAGE_LENGTH = 4_000;
const MAX_PROMPT_LENGTH = 16_000;
const MAX_MODEL_LENGTH = 200;
const MAX_REPLY_LENGTH = 3_500;
const MAX_ROLE_KEY_LENGTH = 120;

export type PrintAdvisorBridgeRequest = {
  version: typeof BRIDGE_PROTOCOL_VERSION;
  requestId: string;
  tenant: {
    tenantId: string;
    phoneNumberId: string;
    systemPrompt: string;
    aiModel: string;
    temperature: number;
    maxTokens: number;
  };
  message: {
    id: string | null;
    inputType: IncomingMessage["inputType"];
    text: string;
  };
  history: readonly ConversationHistoryMessage[];
};

export type PrintAdvisorBridgeResponse = {
  version: typeof BRIDGE_PROTOCOL_VERSION;
  requestId: string;
  replyText: string;
  replayed: boolean;
};

export type ContactRoleResolutionRequest = {
  version: typeof BRIDGE_PROTOCOL_VERSION;
  requestId: string;
  tenantId: string;
  phoneNumberId: string;
  whatsappUserId: string;
};

export type ContactRoleResolutionResponse = {
  version: typeof BRIDGE_PROTOCOL_VERSION;
  requestId: string;
  roleKey: string | null;
  source: "contact" | "tenant" | "not_found";
};

export type PlatformSyncMessage = {
  metaMessageId: string | null;
  messageType: IncomingMessage["inputType"] | "interactive";
  content: string;
  status: string;
  createdAt: string;
};

export type PlatformInboundSyncRequest = {
  version: typeof BRIDGE_PROTOCOL_VERSION;
  requestId: string;
  tenantId: string;
  phoneNumberId: string;
  whatsappUserId: string;
  contactId: number | null;
  conversationId: string | null;
  message: PlatformSyncMessage;
};

export type PlatformOutboundSyncRequest = {
  version: typeof BRIDGE_PROTOCOL_VERSION;
  requestId: string;
  tenantId: string;
  phoneNumberId: string;
  whatsappUserId: string;
  contactId: number | null;
  conversationId: string | null;
  message: PlatformSyncMessage;
};

export type PlatformSyncResponse = {
  version: typeof BRIDGE_PROTOCOL_VERSION;
  requestId: string;
  accepted: boolean;
  duplicate: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(
  value: unknown,
  maximumLength: number,
  allowEmpty = false,
): value is string {
  return typeof value === "string"
    && value.length <= maximumLength
    && (allowEmpty || value.trim().length > 0);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isInputType(value: unknown): value is IncomingMessage["inputType"] {
  return value === "text"
    || value === "audio"
    || value === "image"
    || value === "document";
}

function isHistoryMessage(value: unknown): value is ConversationHistoryMessage {
  if (!isRecord(value)) return false;
  return (value.role === "user" || value.role === "assistant")
    && isBoundedString(value.content, MAX_HISTORY_MESSAGE_LENGTH, true)
    && (value.createdAt === undefined || typeof value.createdAt === "string");
}

export function isPrintAdvisorBridgeRequest(
  value: unknown,
): value is PrintAdvisorBridgeRequest {
  if (!isRecord(value) || value.version !== BRIDGE_PROTOCOL_VERSION) {
    return false;
  }
  if (
    !isBoundedString(value.requestId, MAX_REQUEST_ID_LENGTH)
    || !isRecord(value.tenant)
    || !isRecord(value.message)
    || !Array.isArray(value.history)
    || value.history.length > MAX_HISTORY_MESSAGES
  ) {
    return false;
  }

  const tenant = value.tenant;
  const message = value.message;
  return isBoundedString(tenant.tenantId, 120)
    && isBoundedString(tenant.phoneNumberId, 120)
    && isBoundedString(tenant.systemPrompt, MAX_PROMPT_LENGTH)
    && isBoundedString(tenant.aiModel, MAX_MODEL_LENGTH)
    && isFiniteNumber(tenant.temperature)
    && tenant.temperature >= 0
    && tenant.temperature <= 2
    && Number.isInteger(tenant.maxTokens)
    && Number(tenant.maxTokens) >= 1
    && Number(tenant.maxTokens) <= 4_000
    && (message.id === null || isBoundedString(message.id, MAX_REQUEST_ID_LENGTH))
    && isInputType(message.inputType)
    && isBoundedString(message.text, MAX_MESSAGE_LENGTH)
    && value.history.every(isHistoryMessage);
}

export function isPrintAdvisorBridgeResponse(
  value: unknown,
): value is PrintAdvisorBridgeResponse {
  return isRecord(value)
    && value.version === BRIDGE_PROTOCOL_VERSION
    && isBoundedString(value.requestId, MAX_REQUEST_ID_LENGTH)
    && isBoundedString(value.replyText, MAX_REPLY_LENGTH)
    && typeof value.replayed === "boolean";
}

export function isContactRoleResolutionRequest(
  value: unknown,
): value is ContactRoleResolutionRequest {
  return isRecord(value)
    && value.version === BRIDGE_PROTOCOL_VERSION
    && isBoundedString(value.requestId, MAX_REQUEST_ID_LENGTH)
    && isBoundedString(value.tenantId, 120)
    && isBoundedString(value.phoneNumberId, 120)
    && isBoundedString(value.whatsappUserId, 120);
}

export function isContactRoleResolutionResponse(
  value: unknown,
): value is ContactRoleResolutionResponse {
  return isRecord(value)
    && value.version === BRIDGE_PROTOCOL_VERSION
    && isBoundedString(value.requestId, MAX_REQUEST_ID_LENGTH)
    && (
      value.roleKey === null
      || isBoundedString(value.roleKey, MAX_ROLE_KEY_LENGTH)
    )
    && (
      value.source === "contact"
      || value.source === "tenant"
      || value.source === "not_found"
    );
}

function isPlatformSyncMessage(value: unknown): value is PlatformSyncMessage {
  if (!isRecord(value)) return false;
  return (value.metaMessageId === null || isBoundedString(value.metaMessageId, 255))
    && (isInputType(value.messageType) || value.messageType === "interactive")
    && isBoundedString(value.content, MAX_MESSAGE_LENGTH, true)
    && isBoundedString(value.status, 80, true)
    && isBoundedString(value.createdAt, 80);
}

function isPlatformSyncRequest(value: unknown): value is PlatformInboundSyncRequest {
  if (!isRecord(value) || value.version !== BRIDGE_PROTOCOL_VERSION) return false;
  return isBoundedString(value.requestId, MAX_REQUEST_ID_LENGTH)
    && isBoundedString(value.tenantId, 120)
    && isBoundedString(value.phoneNumberId, 120)
    && isBoundedString(value.whatsappUserId, 120)
    && (value.contactId === null || (Number.isInteger(value.contactId) && Number(value.contactId) > 0))
    && (value.conversationId === null || isBoundedString(value.conversationId, 255))
    && isPlatformSyncMessage(value.message);
}

export function isPlatformInboundSyncRequest(
  value: unknown,
): value is PlatformInboundSyncRequest {
  return isPlatformSyncRequest(value);
}

export function isPlatformOutboundSyncRequest(
  value: unknown,
): value is PlatformOutboundSyncRequest {
  return isPlatformSyncRequest(value);
}

export function isPlatformSyncResponse(
  value: unknown,
): value is PlatformSyncResponse {
  return isRecord(value)
    && value.version === BRIDGE_PROTOCOL_VERSION
    && isBoundedString(value.requestId, MAX_REQUEST_ID_LENGTH)
    && typeof value.accepted === "boolean"
    && typeof value.duplicate === "boolean";
}

export function createPrintAdvisorBridgeRequest(
  requestId: string,
  message: IncomingMessage,
  tenant: TenantContext,
  history: readonly ConversationHistoryMessage[],
): PrintAdvisorBridgeRequest {
  return {
    version: BRIDGE_PROTOCOL_VERSION,
    requestId,
    tenant: {
      tenantId: tenant.tenantId,
      phoneNumberId: tenant.phoneNumberId,
      systemPrompt: tenant.systemPrompt,
      aiModel: tenant.aiModel,
      temperature: tenant.temperature,
      maxTokens: tenant.maxTokens,
    },
    message: {
      id: message.id,
      inputType: message.inputType,
      text: message.text.slice(0, MAX_MESSAGE_LENGTH),
    },
    history: history.slice(-MAX_HISTORY_MESSAGES).map((item) => ({
      role: item.role,
      content: item.content.slice(0, MAX_HISTORY_MESSAGE_LENGTH),
      ...(item.createdAt ? { createdAt: item.createdAt } : {}),
    })),
  };
}

export function createContactRoleResolutionRequest(
  requestId: string,
  message: IncomingMessage,
  tenant: TenantContext,
): ContactRoleResolutionRequest {
  return {
    version: BRIDGE_PROTOCOL_VERSION,
    requestId,
    tenantId: tenant.tenantId,
    phoneNumberId: tenant.phoneNumberId,
    whatsappUserId: message.to,
  };
}

function createPlatformSyncMessage(
  message: IncomingMessage,
  content: string,
  status: string,
  createdAt: string,
): PlatformSyncMessage {
  return {
    metaMessageId: message.id,
    messageType: message.inputType,
    content: content.slice(0, MAX_MESSAGE_LENGTH),
    status: status.slice(0, 80),
    createdAt,
  };
}

export function createPlatformInboundSyncRequest(
  requestId: string,
  message: IncomingMessage,
  tenant: TenantContext,
  persisted: { contactId: number | null; conversationId: string | null },
  content = message.text,
): PlatformInboundSyncRequest {
  return {
    version: BRIDGE_PROTOCOL_VERSION,
    requestId,
    tenantId: tenant.tenantId,
    phoneNumberId: tenant.phoneNumberId,
    whatsappUserId: message.to,
    contactId: persisted.contactId,
    conversationId: persisted.conversationId,
    message: createPlatformSyncMessage(
      message,
      content,
      "received",
      new Date().toISOString(),
    ),
  };
}

export function createPlatformOutboundSyncRequest(
  requestId: string,
  message: IncomingMessage,
  tenant: TenantContext,
  persisted: { contactId: number | null; conversationId: string | null },
  content: string,
  result: { status: string; metaMessageId: string | null },
  messageType: PlatformSyncMessage["messageType"] = "text",
): PlatformOutboundSyncRequest {
  return {
    version: BRIDGE_PROTOCOL_VERSION,
    requestId,
    tenantId: tenant.tenantId,
    phoneNumberId: tenant.phoneNumberId,
    whatsappUserId: message.to,
    contactId: persisted.contactId,
    conversationId: persisted.conversationId,
    message: {
      metaMessageId: result.metaMessageId,
      messageType,
      content: content.slice(0, MAX_MESSAGE_LENGTH),
      status: result.status.slice(0, 80),
      createdAt: new Date().toISOString(),
    },
  };
}
