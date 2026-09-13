import { CAT_ROLE_KEY, CAT_SYSTEM_PROMPT } from "./roles/cat-role";
import {
  createAiProvider,
  createAudioTranscriber,
} from "./adapters/ai/factory";
import { createFinanceRepository } from "./adapters/finance/factory";
import { PrintSystemD1Repository } from "./adapters/print-system/d1-repository";
import { D1QuoteNumberAllocator } from "./adapters/quotes/d1-number-allocator";
import { D1RoleStateRepository } from "./adapters/roles/d1-role-state-repository";
import { SignedStoreDesignClient } from "./adapters/store-designer/client";
import { SignedStoreCommerceClient } from "./adapters/store-designer/commerce-client";
import { VpsFacturayaClient } from "./adapters/facturaya/vps-client";
import { R2DocumentStore } from "./adapters/documents/r2-store";
import { createWhatsAppClient } from "./adapters/whatsapp/factory";
import { D1ConversationRepository } from "./adapters/conversations/d1-repository";
import { SignedVpsBridgeClient } from "./adapters/bridge/signed-vps-client";
import type { AiProvider } from "./ai/contracts";
import {
  createContactRoleResolutionRequest,
  createPlatformInboundSyncRequest,
  createPlatformOutboundSyncRequest,
  createPrintAdvisorBridgeRequest,
} from "./bridge/contracts";
import { resolveEffectiveRole } from "./contact-control/resolver";
import type { ConversationRepository } from "./conversations/contracts";
import { withMultimodalContext } from "./ai/multimodal-context";
import { transcribeWhatsAppAudio } from "./audio/transcription";
import { analyzeWhatsAppImage } from "./image/analysis";
import { roleRegistry } from "./roles/registry";
import { ENTERPRISE_ADVISOR_ROLE_KEY } from "./roles/enterprise-advisor-role";
import { QUOTE_ROLE_KEY } from "./quotes/types";
import {
  PRINT_ADVISOR_PROVIDER,
  PRINT_ADVISOR_ROLE_KEY,
} from "./roles/print-advisor-role";
import type {
  ConversationHistoryMessage,
  IncomingMessage,
  SendResult,
  TenantContext,
} from "./roles/contracts";
import type { IncomingDocument } from "./documents/contracts";

const HEALTH_PATH = "/health";
const WEBHOOK_PATH = "/webhooks/whatsapp";
const STORE_PAYMENT_PATH = "/internal/store/payment";
const WHATSAPP_OBJECT = "whatsapp_business_account";
const DEFAULT_TENANT_ID = "manolo";
const FALLBACK_REPLY =
  "Miau 🐱 Estoy tomando una siesta sobre el teclado. Intenta escribirme de nuevo en un momento.";
const MAX_INCOMING_MESSAGE_LENGTH = 4_000;
const MAX_REPLY_LENGTH = 3_500;
const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;
const DEFAULT_GROQ_VISION_MODEL = "qwen/qwen3.6-27b";

type JsonObject = Record<string, unknown>;

type SafeWebhookMetadata = {
  event: "whatsapp_webhook_received";
  environment: string;
  object: string;
  entryCount: number;
  changeCount: number;
  eventTypes: string[];
  receivedAt: string;
};

function jsonResponse(body: JsonObject, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function methodNotAllowed(allow: string): Response {
  return new Response(null, {
    status: 405,
    headers: { Allow: allow },
  });
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return difference === 0;
}

function secureStringEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  return constantTimeEqual(encoder.encode(left), encoder.encode(right));
}

async function isValidMetaSignature(
  body: ArrayBuffer,
  headerValue: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!headerValue || appSecret.length === 0) {
    return false;
  }

  const match = /^sha256=([0-9a-fA-F]{64})$/.exec(headerValue.trim());
  if (!match) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, body));
  return constantTimeEqual(digest, hexToBytes(match[1]));
}

async function isValidStoreSignature(
  rawBody: string,
  timestampHeader: string | null,
  signatureHeader: string | null,
  secret: string | undefined,
): Promise<boolean> {
  const timestamp = Number(timestampHeader);
  const configuredSecret = secret?.trim() || "";
  if (
    !configuredSecret
    || !timestampHeader
    || !Number.isInteger(timestamp)
    || Math.abs(Math.floor(Date.now() / 1_000) - timestamp) > 300
  ) return false;

  const match = /^sha256=([0-9a-fA-F]{64})$/.exec(signatureHeader?.trim() || "");
  if (!match) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(configuredSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestampHeader}.${rawBody}`),
  ));
  return constantTimeEqual(digest, hexToBytes(match[1]));
}

function summarizeWebhook(
  payload: JsonObject,
  environment: string,
): SafeWebhookMetadata {
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  const changes = entries.flatMap((entry) => {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) {
      return [];
    }
    return entry.changes;
  });
  const eventTypes = [
    ...new Set(
      changes.map((change) => {
        if (!isRecord(change) || typeof change.field !== "string") {
          return "unknown";
        }
        return change.field.slice(0, 80);
      }),
    ),
  ].slice(0, 10);

  return {
    event: "whatsapp_webhook_received",
    environment,
    object: WHATSAPP_OBJECT,
    entryCount: entries.length,
    changeCount: changes.length,
    eventTypes,
    receivedAt: new Date().toISOString(),
  };
}

function logWebhookMetadata(metadata: SafeWebhookMetadata): void {
  console.log(JSON.stringify(metadata));
}

function logSafeEvent(event: string, details: JsonObject = {}): void {
  console.log(JSON.stringify({ event, ...details }));
}

function extractIncomingMessages(
  payload: JsonObject,
  env: Env,
): IncomingMessage[] {
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  const incomingMessages: IncomingMessage[] = [];

  for (const entry of entries) {
    if (!isRecord(entry) || !Array.isArray(entry.changes)) {
      continue;
    }

    for (const change of entry.changes) {
      if (!isRecord(change) || !isRecord(change.value)) {
        continue;
      }

      const messages = Array.isArray(change.value.messages)
        ? change.value.messages
        : [];
      const metadata = isRecord(change.value.metadata)
        ? change.value.metadata
        : {};
      const phoneNumberId =
        typeof metadata.phone_number_id === "string" &&
        metadata.phone_number_id.trim().length > 0
          ? metadata.phone_number_id.trim()
          : env.WHATSAPP_PHONE_NUMBER_ID;
      for (const message of messages) {
        if (!isRecord(message) || typeof message.from !== "string") {
          continue;
        }

        const messageType =
          typeof message.type === "string" ? message.type.trim().toLowerCase() : "";
        const audio = isRecord(message.audio) ? message.audio : null;
        const audioMediaId =
          audio && typeof audio.id === "string" && audio.id.trim().length > 0
            ? audio.id.trim()
            : null;
        const audioMimeType =
          audio && typeof audio.mime_type === "string" && audio.mime_type.trim().length > 0
            ? audio.mime_type.trim()
            : null;
        const image = isRecord(message.image) ? message.image : null;
        const imageMediaId =
          image && typeof image.id === "string" && image.id.trim().length > 0
            ? image.id.trim()
            : null;
        const imageMimeType =
          image && typeof image.mime_type === "string" && image.mime_type.trim().length > 0
            ? image.mime_type.trim()
            : null;
        const imageCaption =
          image && typeof image.caption === "string"
            ? image.caption.trim()
            : "";
        const documentMessage = isRecord(message.document) ? message.document : null;
        const documentMediaId =
          documentMessage && typeof documentMessage.id === "string" && documentMessage.id.trim().length > 0
            ? documentMessage.id.trim()
            : null;
        const documentMimeType =
          documentMessage && typeof documentMessage.mime_type === "string"
            ? documentMessage.mime_type.trim()
            : null;
        const documentFilename =
          documentMessage && typeof documentMessage.filename === "string"
            ? documentMessage.filename.trim()
            : null;
        const documentCaption =
          documentMessage && typeof documentMessage.caption === "string"
            ? documentMessage.caption.trim()
            : "";
        const isAudioMessage = messageType === "audio";
        const isImageMessage = messageType === "image";
        const isDocumentMessage = messageType === "document";
        const textValue = isRecord(message.text) ? message.text.body : null;
        const interactive = isRecord(message.interactive)
          ? message.interactive
          : null;
        const buttonReply =
          interactive && isRecord(interactive.button_reply)
            ? interactive.button_reply
            : null;
        const listReply =
          interactive && isRecord(interactive.list_reply)
            ? interactive.list_reply
            : null;
        const interactionId =
          buttonReply && typeof buttonReply.id === "string"
            ? buttonReply.id
            : listReply && typeof listReply.id === "string"
              ? listReply.id
              : null;
        const messageText =
          typeof textValue === "string" && textValue.trim().length > 0
            ? textValue
            : interactionId ?? (
                isImageMessage
                  ? imageCaption
                  : isDocumentMessage
                    ? documentCaption
                    : isAudioMessage
                      ? ""
                      : null
              );
        if (
          message.from.length === 0 ||
          ((isAudioMessage || isImageMessage || isDocumentMessage)
            ? (isAudioMessage ? audioMediaId : isImageMessage ? imageMediaId : documentMediaId) === null
            : typeof messageText !== "string" || messageText.trim().length === 0)
        ) {
          continue;
        }

        incomingMessages.push({
          id:
            typeof message.id === "string" && message.id.length > 0
              ? message.id
              : null,
          interactionId,
          phoneNumberId,
          to: message.from,
          inputType: isAudioMessage
            ? "audio"
            : isImageMessage
              ? "image"
              : isDocumentMessage
                ? "document"
                : "text",
          audioMediaId: isAudioMessage ? audioMediaId : null,
          audioMimeType: isAudioMessage ? audioMimeType : null,
          imageMediaId: isImageMessage ? imageMediaId : null,
          imageMimeType: isImageMessage ? imageMimeType : null,
          ...(isImageMessage ? { imageCaption } : {}),
          ...(isDocumentMessage
            ? {
                documentMediaId,
                documentMimeType,
                documentFilename,
                documentCaption,
              }
            : {}),
          text:
            typeof messageText === "string"
              ? messageText.trim().slice(0, MAX_INCOMING_MESSAGE_LENGTH)
              : "",
        });

        if (incomingMessages.length >= 20) {
          return incomingMessages;
        }
      }
    }
  }

  return incomingMessages;
}

function fallbackTenantContext(
  phoneNumberId: string,
  env: Env,
): TenantContext | null {
  if (env.ENVIRONMENT === "production") {
    return null;
  }

  return {
    tenantId: DEFAULT_TENANT_ID,
    phoneNumberId,
    roleKey: CAT_ROLE_KEY,
    systemPrompt: CAT_SYSTEM_PROMPT,
    aiProvider: "groq",
    aiModel: env.GROQ_MODEL,
    temperature: 0.8,
    maxTokens: 180,
  };
}

async function resolveTenantContext(
  phoneNumberId: string,
  env: Env,
  conversations: ConversationRepository,
): Promise<TenantContext | null> {
  const result = await conversations.findTenant(phoneNumberId);
  if (result.status === "unavailable") {
    logSafeEvent("whatsapp_tenant_lookup_failed", {
      reason: "missing_database_binding",
    });
    return fallbackTenantContext(phoneNumberId, env);
  }
  if (result.status === "not_found") {
    logSafeEvent("whatsapp_tenant_route_failed", {
      reason: "unknown_phone_number",
    });
    return fallbackTenantContext(phoneNumberId, env);
  }
  if (result.status === "error") {
    return fallbackTenantContext(phoneNumberId, env);
  }

  const tenant = result.tenant;
  return {
    tenantId: tenant.tenantId,
    phoneNumberId: tenant.phoneNumberId,
    roleKey: tenant.roleKey,
    systemPrompt: tenant.systemPrompt,
    aiProvider: tenant.aiProvider,
    aiModel: tenant.aiModel?.trim() || env.GROQ_MODEL,
    temperature:
      Number.isFinite(tenant.temperature) && tenant.temperature >= 0
        ? Math.min(tenant.temperature, 2)
        : 0.8,
    maxTokens:
      Number.isInteger(tenant.maxTokens) && tenant.maxTokens > 0
        ? Math.min(tenant.maxTokens, 1_000)
        : 180,
  };
}

async function generateAiReply(
  messageText: string,
  tenant: TenantContext,
  ai: AiProvider | null,
  history: readonly ConversationHistoryMessage[] = [],
): Promise<string | null> {
  if (!ai) {
    logSafeEvent("whatsapp_ai_skipped", {
      provider: tenant.aiProvider,
      reason: "unsupported_ai_provider",
    });
    return null;
  }

  const content = await ai.complete(
    {
      model: tenant.aiModel,
      messages: [
        { role: "system", content: tenant.systemPrompt },
        ...history.map((item) => ({
          role: item.role,
          content: item.content,
        })),
        {
          role: "user",
          content: messageText.slice(0, MAX_INCOMING_MESSAGE_LENGTH),
        },
      ],
      temperature: tenant.temperature,
      maxTokens: tenant.maxTokens,
      reasoningEffort: tenant.aiReasoningEffort,
    },
    logSafeEvent,
  );
  if (!content) {
    logSafeEvent("whatsapp_ai_failed", {
      provider: ai.key,
      reason: "provider_error",
    });
    return null;
  }

  logSafeEvent("whatsapp_ai_generated", { provider: ai.key });
  return content.slice(0, MAX_REPLY_LENGTH);
}

async function downloadIncomingDocument(
  message: IncomingMessage,
  whatsappClient: ReturnType<typeof createWhatsAppClient>,
  log: (event: string, details?: JsonObject) => void,
): Promise<IncomingDocument | null> {
  if (message.inputType !== "document" || !message.documentMediaId) return null;

  const metadata = await whatsappClient.getMediaMetadata(
    message.documentMediaId,
    message.phoneNumberId,
  );
  if (!metadata || (metadata.fileSize !== null && metadata.fileSize > MAX_DOCUMENT_BYTES)) {
    log("whatsapp_document_ingestion_failed", { reason: "document_too_large_or_unavailable" });
    return null;
  }

  const downloaded = await whatsappClient.downloadMedia(metadata);
  if (!downloaded || downloaded.bytes.byteLength > MAX_DOCUMENT_BYTES) {
    log("whatsapp_document_ingestion_failed", { reason: "document_download_failed" });
    return null;
  }

  return {
    bytes: downloaded.bytes,
    mimeType: message.documentMimeType?.trim() || downloaded.mimeType || "application/pdf",
    filename: message.documentFilename?.trim() || "documento.pdf",
  };
}

async function processIncomingMessages(
  payload: JsonObject,
  env: Env,
): Promise<void> {
  const messages = extractIncomingMessages(payload, env);
  const whatsappClient = createWhatsAppClient(
    env.META_ACCESS_TOKEN,
    env.META_GRAPH_API_VERSION,
    logSafeEvent,
  );
  const audioTranscriber = createAudioTranscriber("groq", {
    groqApiKey: env.GROQ_API_KEY,
  });
  const visionProvider = createAiProvider("groq", {
    groqApiKey: env.GROQ_API_KEY,
  });
  const visionModel =
    env.GROQ_VISION_MODEL?.trim() || DEFAULT_GROQ_VISION_MODEL;
  const conversations = new D1ConversationRepository(env.DB, logSafeEvent);
  await Promise.all(
    messages.map(async (message) => {
      const tenant = await resolveTenantContext(
        message.phoneNumberId,
        env,
        conversations,
      );
      if (!tenant) {
        logSafeEvent("whatsapp_message_skipped", {
          reason: "tenant_not_configured",
        });
        return;
      }

      const conversationHistory = await conversations.loadHistory(
        tenant,
        message.to,
      );
      const persisted = await conversations.persistInbound(message, tenant);
      if (persisted.duplicate) {
        logSafeEvent("whatsapp_message_deduplicated");
        return;
      }

      if (message.id) {
        await whatsappClient.sendTypingIndicator(
          message.id,
          tenant.phoneNumberId,
        );
      }

      let activeMessage = message;
      if (message.inputType === "audio") {
        const transcript = await transcribeWhatsAppAudio(
          message.audioMediaId ?? null,
          message.audioMimeType ?? null,
          message.phoneNumberId,
          whatsappClient,
          audioTranscriber,
          env.GROQ_TRANSCRIPTION_MODEL,
          logSafeEvent,
        );
        if (!transcript) {
          const replyText =
            "No pude entender la nota de voz. Intenta enviarla nuevamente o escribe el mensaje.";
          const sendResult = await whatsappClient.sendText(
            message.to,
            replyText,
            tenant.phoneNumberId,
          );
          await conversations.persistOutbound(
            tenant,
            persisted.conversationId,
            replyText,
            sendResult,
          );
          return;
        }

        activeMessage = { ...message, text: transcript };
        await conversations.updateInboundContent(message, tenant, transcript);
      } else if (message.inputType === "image") {
        const visualContext = await analyzeWhatsAppImage(
          message.imageMediaId ?? null,
          message.imageMimeType ?? null,
          message.imageCaption ?? message.text,
          message.phoneNumberId,
          whatsappClient,
          visionProvider,
          visionModel,
          logSafeEvent,
        );
        if (!visualContext && !message.text.trim()) {
          const replyText =
            "No pude analizar la imagen. Intenta enviarla nuevamente con una breve explicación.";
          const sendResult = await whatsappClient.sendText(
            message.to,
            replyText,
            tenant.phoneNumberId,
          );
          await conversations.persistOutbound(
            tenant,
            persisted.conversationId,
            replyText,
            sendResult,
          );
          return;
        }

        const normalizedImageText = visualContext || message.text;
        activeMessage = { ...message, text: normalizedImageText };
        await conversations.updateInboundContent(
          message,
          tenant,
          normalizedImageText,
        );
      }

      const incomingDocument = await downloadIncomingDocument(
        message,
        whatsappClient,
        logSafeEvent,
      );

      const bridgeRequestId = activeMessage.id
        ?? activeMessage.interactionId
        ?? crypto.randomUUID();
      const bridgeEnabled = env.VPS_BRIDGE_ENABLED === "true";
      const platformShadowEnabled = env.VPS_PLATFORM_SHADOW_ENABLED === "true";
      const bridgeClient = (bridgeEnabled || platformShadowEnabled)
        ? new SignedVpsBridgeClient(
            env.VPS_BRIDGE_API_URL,
            env.VPS_BRIDGE_HMAC_SECRET,
            logSafeEvent,
          )
        : null;
      const roleResolution = await resolveEffectiveRole({
        tenantRoleKey: tenant.roleKey,
        allowedRoleKeys: roleRegistry.keys(),
        d1Lookup: () => conversations.resolveContactRole(
          tenant,
          persisted.contactId,
        ),
        ...(bridgeEnabled && bridgeClient
          ? {
              vpsLookup: () => bridgeClient.resolveContactRole(
                createContactRoleResolutionRequest(
                  bridgeRequestId,
                  activeMessage,
                  tenant,
                ),
              ),
            }
          : {}),
        log: logSafeEvent,
      });

      const configuredTenant = roleRegistry.apply(
        tenant,
        roleResolution.roleKey,
      );
      const effectiveTenant: TenantContext = {
        ...configuredTenant,
        systemPrompt: withMultimodalContext(configuredTenant.systemPrompt),
        aiProvider:
          configuredTenant.roleKey === ENTERPRISE_ADVISOR_ROLE_KEY
            ? env.ENTERPRISE_AI_PROVIDER?.trim() || "openai"
            : configuredTenant.roleKey === PRINT_ADVISOR_ROLE_KEY
            ? PRINT_ADVISOR_PROVIDER
            : configuredTenant.aiProvider,
        aiModel:
          configuredTenant.roleKey === ENTERPRISE_ADVISOR_ROLE_KEY
            ? env.ENTERPRISE_AI_MODEL?.trim() || configuredTenant.aiModel
            : configuredTenant.roleKey === PRINT_ADVISOR_ROLE_KEY
            ? env.PRINT_ADVISOR_MODEL?.trim() || configuredTenant.aiModel
            : configuredTenant.roleKey === QUOTE_ROLE_KEY
              ? env.GROQ_QUOTES_MODEL?.trim() || configuredTenant.aiModel
              : configuredTenant.aiModel,
        temperature:
          configuredTenant.roleKey === ENTERPRISE_ADVISOR_ROLE_KEY
            ? 0.2
            : configuredTenant.temperature,
        maxTokens:
          configuredTenant.roleKey === ENTERPRISE_ADVISOR_ROLE_KEY
            ? 1_800
            : configuredTenant.maxTokens,
        aiReasoningEffort:
          configuredTenant.roleKey === ENTERPRISE_ADVISOR_ROLE_KEY
            ? String(env.ENTERPRISE_AI_REASONING_EFFORT) === "low" || String(env.ENTERPRISE_AI_REASONING_EFFORT) === "medium"
              ? String(env.ENTERPRISE_AI_REASONING_EFFORT) as "low" | "medium"
              : "high"
              : configuredTenant.aiReasoningEffort,
      };
      if (platformShadowEnabled && bridgeClient) {
        const syncResponse = await bridgeClient.mirrorInbound(
          createPlatformInboundSyncRequest(
            bridgeRequestId,
            activeMessage,
            effectiveTenant,
            persisted,
            activeMessage.text,
          ),
        );
        if (!syncResponse) {
          logSafeEvent("vps_platform_shadow_failed", {
            direction: "inbound",
          });
        }
      }
      const persistOutbound = async (
        replyText: string,
        sendResult: SendResult,
        messageType = "text",
      ): Promise<void> => {
        await conversations.persistOutbound(
          effectiveTenant,
          persisted.conversationId,
          replyText,
          sendResult,
          messageType,
        );
        if (platformShadowEnabled && bridgeClient) {
          const syncResponse = await bridgeClient.mirrorOutbound(
            createPlatformOutboundSyncRequest(
              crypto.randomUUID(),
              activeMessage,
              effectiveTenant,
              persisted,
              replyText,
              sendResult,
              messageType === "interactive" || messageType === "document"
                ? messageType
                : activeMessage.inputType,
            ),
          );
          if (!syncResponse) {
            logSafeEvent("vps_platform_shadow_failed", {
              direction: "outbound",
              messageType,
            });
          }
        }
      };
      const replyWithText = async (replyText: string): Promise<void> => {
        const sendResult = await whatsappClient.sendText(
          activeMessage.to,
          replyText,
          effectiveTenant.phoneNumberId,
        );
        await persistOutbound(replyText, sendResult);
      };

      if (
        effectiveTenant.roleKey === PRINT_ADVISOR_ROLE_KEY
        && bridgeEnabled
        && bridgeClient
      ) {
        const bridgeResponse = await bridgeClient.requestPrintAdvisorReply(
          createPrintAdvisorBridgeRequest(
            bridgeRequestId,
            activeMessage,
            effectiveTenant,
            conversationHistory,
          ),
        );
        if (bridgeResponse) {
          await replyWithText(bridgeResponse.replyText);
          return;
        }
        logSafeEvent("vps_bridge_fallback_activated", {
          role: PRINT_ADVISOR_ROLE_KEY,
        });
      }

      const ai = createAiProvider(effectiveTenant.aiProvider, {
        groqApiKey: env.GROQ_API_KEY,
        openAiApiKey: env.OPENAI_API_KEY,
        openAiBaseUrl: env.ENTERPRISE_AI_BASE_URL,
      });
      const finance = createFinanceRepository(
        env.NEON_DATABASE_URL,
        logSafeEvent,
      );
      const businessData = new PrintSystemD1Repository(
        env.PRINT_DB,
        logSafeEvent,
      );
      const quoteNumberAllocator = new D1QuoteNumberAllocator(
        env.DB,
        logSafeEvent,
      );
      const roleState = new D1RoleStateRepository(env.DB);
      const storeDesigner = new SignedStoreDesignClient(
        env.STORE_DESIGN_API_URL,
        env.STORE_DESIGN_API_SECRET,
        logSafeEvent,
      );
      const storeCommerce = new SignedStoreCommerceClient(
        env.STORE_DESIGN_API_URL,
        env.STORE_DESIGN_API_SECRET,
        logSafeEvent,
      );
      const facturaya = new VpsFacturayaClient(
        bridgeClient,
        effectiveTenant.tenantId,
        persisted.contactId,
        bridgeRequestId,
        logSafeEvent,
      );
      const documentStore = new R2DocumentStore(env.ENTERPRISE_DOCUMENTS);

      const roleHandler = roleRegistry.resolve(effectiveTenant.roleKey);
      await roleHandler.handle({
        message: activeMessage,
        tenant: effectiveTenant,
        persisted,
        env,
        ai,
        finance,
        businessData,
        quoteNumberAllocator,
        roleState,
        storeDesigner,
        storeCommerce,
        facturaya,
        document: incomingDocument,
        documentStore,
        history: conversationHistory,
        reply: replyWithText,
        sendImage: async (imageUrl, caption) => {
          const sendResult = await whatsappClient.sendImage(
            activeMessage.to,
            imageUrl,
            caption,
            effectiveTenant.phoneNumberId,
          );
          await persistOutbound(caption, sendResult, "image");
          return sendResult;
        },
        sendButtons: async (body, buttons) => {
          const sendResult = await whatsappClient.sendButtons(
            activeMessage.to,
            body,
            buttons,
            effectiveTenant.phoneNumberId,
          );
          await persistOutbound(body, sendResult, "interactive");
          if (sendResult.status !== "sent") {
            const fallbackText = `${body}\n\nNo pude mostrar los botones. Responde confirmar o cancelar.`;
            const fallbackResult = await whatsappClient.sendText(
              activeMessage.to,
              fallbackText,
              effectiveTenant.phoneNumberId,
            );
            await persistOutbound(fallbackText, fallbackResult);
            return fallbackResult;
          }
          return sendResult;
        },
        sendList: async (body, buttonText, sections) => {
          const sendResult = await whatsappClient.sendList(
            activeMessage.to,
            body,
            buttonText,
            sections,
            effectiveTenant.phoneNumberId,
          );
          await persistOutbound(body, sendResult, "interactive");
          return sendResult;
        },
        sendDocument: async (document) => {
          const sendResult = await whatsappClient.sendDocument(
            activeMessage.to,
            document.pdf,
            document.filename,
            document.caption,
            effectiveTenant.phoneNumberId,
          );
          await persistOutbound(
            `${document.filename}: ${document.caption}`,
            sendResult,
            "document",
          );
          return sendResult;
        },
        generateAiReply: () =>
          generateAiReply(activeMessage.text, effectiveTenant, ai),
        generateAiReplyWithHistory: () =>
          generateAiReply(
            activeMessage.text,
            effectiveTenant,
            ai,
            conversationHistory,
          ),
        fallbackReply: FALLBACK_REPLY,
        log: logSafeEvent,
      });
    }),
  );
}

async function verificationResponse(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const verifyToken = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === null || verifyToken === null || challenge === null) {
    logSafeEvent("whatsapp_verification_rejected", {
      reason: "missing_parameters",
    });
    return jsonResponse({ error: "missing_verification_parameters" }, 400);
  }

  if (!env.WHATSAPP_VERIFY_TOKEN) {
    logSafeEvent("whatsapp_verification_rejected", {
      reason: "missing_server_configuration",
    });
    return jsonResponse({ error: "server_configuration_error" }, 500);
  }

  if (
    mode !== "subscribe" ||
    verifyToken.length === 0 ||
    challenge.length === 0
  ) {
    logSafeEvent("whatsapp_verification_rejected", {
      reason: "invalid_parameters",
    });
    return new Response(null, { status: 403 });
  }

  if (!secureStringEqual(verifyToken, env.WHATSAPP_VERIFY_TOKEN)) {
    logSafeEvent("whatsapp_verification_rejected", {
      reason: "invalid_verify_token",
    });
    return new Response(null, { status: 403 });
  }

  logSafeEvent("whatsapp_verification_succeeded");

  return new Response(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

async function webhookResponse(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!env.META_APP_SECRET) {
    logSafeEvent("whatsapp_webhook_rejected", {
      reason: "missing_server_configuration",
    });
    return jsonResponse({ error: "server_configuration_error" }, 500);
  }

  const body = await request.arrayBuffer();
  const signature = request.headers.get("X-Hub-Signature-256");

  if (
    !(await isValidMetaSignature(body, signature, env.META_APP_SECRET))
  ) {
    logSafeEvent("whatsapp_webhook_rejected", {
      reason: signature === null ? "missing_signature" : "invalid_signature",
    });
    return new Response(null, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(body));
  } catch {
    logSafeEvent("whatsapp_webhook_rejected", { reason: "invalid_json" });
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  if (!isRecord(payload) || payload.object !== WHATSAPP_OBJECT) {
    logSafeEvent("whatsapp_webhook_rejected", {
      reason: "invalid_whatsapp_payload",
    });
    return jsonResponse({ error: "invalid_whatsapp_payload" }, 400);
  }

  const metadata = summarizeWebhook(payload, env.ENVIRONMENT);
  ctx.waitUntil(Promise.resolve().then(() => logWebhookMetadata(metadata)));
  ctx.waitUntil(processIncomingMessages(payload, env));

  return jsonResponse({ received: true });
}

type StorePaymentNotification = {
  action?: unknown;
  tenantId?: unknown;
  contactId?: unknown;
  whatsappUserId?: unknown;
  phoneNumberId?: unknown;
  orderId?: unknown;
  paymentId?: unknown;
  amount?: unknown;
  currencyId?: unknown;
};

async function storePaymentNotificationResponse(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");
  const rawBody = await request.text();
  if (rawBody.length > 20_000) return jsonResponse({ error: "payload_too_large" }, 413);
  if (!(await isValidStoreSignature(
    rawBody,
    request.headers.get("X-Store-Timestamp"),
    request.headers.get("X-Store-Signature"),
    env.STORE_DESIGN_API_SECRET,
  ))) {
    logSafeEvent("store_payment_notification_rejected", { reason: "invalid_signature" });
    return new Response(null, { status: 401 });
  }

  let body: StorePaymentNotification;
  try {
    body = JSON.parse(rawBody) as StorePaymentNotification;
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }
  const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "";
  const whatsappUserId = typeof body.whatsappUserId === "string" ? body.whatsappUserId.trim() : "";
  const phoneNumberId = typeof body.phoneNumberId === "string" ? body.phoneNumberId.trim() : "";
  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  const paymentId = typeof body.paymentId === "string" ? body.paymentId.trim() : "";
  const currencyId = typeof body.currencyId === "string" ? body.currencyId.trim() : "";
  const contactId = Number(body.contactId);
  const amount = Number(body.amount);
  if (
    body.action !== "payment_confirmed"
    || !tenantId
    || !whatsappUserId
    || !phoneNumberId
    || !orderId
    || !paymentId
    || !currencyId
    || !Number.isInteger(contactId)
    || contactId < 1
    || !Number.isFinite(amount)
    || amount <= 0
  ) return jsonResponse({ error: "invalid_payment_notification" }, 400);
  if (!env.DB) return jsonResponse({ error: "database_unavailable" }, 503);

  const conversations = new D1ConversationRepository(env.DB, logSafeEvent);
  const tenant = await resolveTenantContext(
    phoneNumberId,
    env,
    conversations,
  );
  if (!tenant || tenant.tenantId !== tenantId) {
    return jsonResponse({ error: "tenant_not_configured" }, 403);
  }

  let inserted = false;
  try {
    const result = await env.DB.prepare(
      `INSERT OR IGNORE INTO store_payment_notifications
       (tenant_id, order_id, payment_id)
       VALUES (?1, ?2, ?3)`,
    ).bind(tenantId, orderId, paymentId).run();
    inserted = result.meta.changes > 0;
  } catch {
    return jsonResponse({ error: "database_error" }, 503);
  }
  if (!inserted) return jsonResponse({ received: true, duplicate: true });

  const replyText = "Pago confirmado. Tu pedido entró en preparación.";
  const client = createWhatsAppClient(
    env.META_ACCESS_TOKEN,
    env.META_GRAPH_API_VERSION,
    logSafeEvent,
  );
  const sendResult = await client.sendText(whatsappUserId, replyText, phoneNumberId);
  if (sendResult.status !== "sent") {
    try {
      await env.DB.prepare(
        `DELETE FROM store_payment_notifications
         WHERE tenant_id = ?1 AND order_id = ?2 AND payment_id = ?3`,
      ).bind(tenantId, orderId, paymentId).run();
    } catch {
      logSafeEvent("store_payment_notification_cleanup_failed");
    }
    return jsonResponse({ error: "whatsapp_delivery_failed" }, 503);
  }
  await conversations.persistOutbound(
    tenant,
    `${tenantId}:${whatsappUserId}`,
    replyText,
    sendResult,
  );
  logSafeEvent("store_payment_notification_sent", { tenantId, orderId });
  return jsonResponse({ received: true, notified: true });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === HEALTH_PATH) {
      if (request.method !== "GET") {
        return methodNotAllowed("GET");
      }
      return jsonResponse({ status: "ok", service: "whatsapp-webhook" });
    }

    if (url.pathname === STORE_PAYMENT_PATH) {
      try {
        return await storePaymentNotificationResponse(request, env);
      } catch {
        logSafeEvent("store_payment_notification_failed", { reason: "request_processing_error" });
        return jsonResponse({ error: "request_processing_error" }, 500);
      }
    }

    if (url.pathname === WEBHOOK_PATH) {
      if (request.method === "GET") {
        return verificationResponse(request, env);
      }
      if (request.method === "POST") {
        try {
          return await webhookResponse(request, env, ctx);
        } catch {
          logSafeEvent("whatsapp_webhook_failed", {
            reason: "request_processing_error",
          });
          return jsonResponse({ error: "request_processing_error" }, 500);
        }
      }
      return methodNotAllowed("GET, POST");
    }

    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
