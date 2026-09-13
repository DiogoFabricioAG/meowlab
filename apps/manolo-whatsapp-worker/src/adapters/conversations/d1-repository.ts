import type { ConversationRepository, TenantLookupResult } from "../../conversations/contracts";
import type {
  ConversationHistoryMessage,
  IncomingMessage,
  PersistedInboundMessage,
  RoleLog,
  SendResult,
  TenantContext,
} from "../../roles/contracts";

const DEFAULT_MAX_MEMORY_MESSAGES = 20;
const DEFAULT_MAX_MEMORY_MESSAGE_LENGTH = 1_200;
const AUDIO_PLACEHOLDER = "[Nota de voz]";
const IMAGE_PLACEHOLDER = "[Imagen adjunta]";
const DOCUMENT_PLACEHOLDER = "[Documento adjunto]";

type TenantRow = {
  tenant_id: string;
  phone_number_id: string;
  role_key: string;
  system_prompt: string;
  ai_provider: string;
  ai_model: string | null;
  temperature: number;
  max_tokens: number;
};

type ContactRoleRow = {
  active_role_key: string | null;
};

type D1ConversationRepositoryOptions = {
  maxMemoryMessages?: number;
  maxMemoryMessageLength?: number;
};

export class D1ConversationRepository implements ConversationRepository {
  private readonly maxMemoryMessages: number;
  private readonly maxMemoryMessageLength: number;

  constructor(
    private readonly database: D1Database | null | undefined,
    private readonly log: RoleLog,
    options: D1ConversationRepositoryOptions = {},
  ) {
    this.maxMemoryMessages =
      options.maxMemoryMessages ?? DEFAULT_MAX_MEMORY_MESSAGES;
    this.maxMemoryMessageLength =
      options.maxMemoryMessageLength ?? DEFAULT_MAX_MEMORY_MESSAGE_LENGTH;
  }

  async findTenant(phoneNumberId: string): Promise<TenantLookupResult> {
    if (!this.database) return { status: "unavailable" };

    try {
      const row = await this.database.prepare(
        `SELECT
           wn.tenant_id,
           wn.phone_number_id,
           bc.role_key,
           bc.system_prompt,
           bc.ai_provider,
           bc.ai_model,
           bc.temperature,
           bc.max_tokens
         FROM whatsapp_numbers wn
         INNER JOIN tenants t ON t.id = wn.tenant_id
         INNER JOIN bot_configs bc ON bc.tenant_id = t.id
         WHERE wn.phone_number_id = ?1
           AND wn.active = 1
           AND t.status = 'active'
         LIMIT 1`,
      )
        .bind(phoneNumberId)
        .first<TenantRow>();

      if (!row) return { status: "not_found" };

      return {
        status: "found",
        tenant: {
          tenantId: row.tenant_id,
          phoneNumberId: row.phone_number_id,
          roleKey: row.role_key,
          systemPrompt: row.system_prompt,
          aiProvider: row.ai_provider,
          aiModel: row.ai_model,
          temperature: row.temperature,
          maxTokens: row.max_tokens,
        },
      };
    } catch {
      this.log("whatsapp_tenant_lookup_failed", { reason: "database_error" });
      return { status: "error" };
    }
  }

  async persistInbound(
    message: IncomingMessage,
    tenant: TenantContext,
  ): Promise<PersistedInboundMessage> {
    if (!this.database) {
      return { duplicate: false, conversationId: null, contactId: null };
    }

    try {
      const now = new Date().toISOString();
      await this.database.prepare(
        `INSERT INTO contacts (tenant_id, whatsapp_user_id, display_phone, updated_at)
         VALUES (?1, ?2, ?2, ?3)
         ON CONFLICT (tenant_id, whatsapp_user_id)
         DO UPDATE SET display_phone = excluded.display_phone, updated_at = excluded.updated_at`,
      )
        .bind(tenant.tenantId, message.to, now)
        .run();

      const contact = await this.database.prepare(
        `SELECT id FROM contacts
         WHERE tenant_id = ?1 AND whatsapp_user_id = ?2
         LIMIT 1`,
      )
        .bind(tenant.tenantId, message.to)
        .first<{ id: number }>();

      if (!contact) {
        this.log("whatsapp_database_write_failed", {
          reason: "contact_not_found_after_upsert",
        });
        return { duplicate: false, conversationId: null, contactId: null };
      }

      const conversationId = `${tenant.tenantId}:${message.to}`;
      await this.database.prepare(
        `INSERT INTO conversations (
           id, tenant_id, contact_id, last_message_at, updated_at
         )
         VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT (id)
         DO UPDATE SET last_message_at = excluded.last_message_at,
                       updated_at = excluded.updated_at`,
      )
        .bind(conversationId, tenant.tenantId, contact.id, now)
        .run();

      const insertResult = await this.database.prepare(
        `INSERT OR IGNORE INTO messages (
           tenant_id,
           conversation_id,
           meta_message_id,
           direction,
           message_type,
           content,
           status,
           created_at
         )
         VALUES (?1, ?2, ?3, 'inbound', ?4, ?5, 'received', ?6)`,
      )
        .bind(
          tenant.tenantId,
          conversationId,
          message.id,
          message.inputType,
          message.text || this.placeholderFor(message.inputType),
          now,
        )
        .run();

      return {
        duplicate: insertResult.meta.changes === 0,
        conversationId,
        contactId: contact.id,
      };
    } catch {
      this.log("whatsapp_database_write_failed", {
        reason: "inbound_message_persistence_error",
      });
      return { duplicate: false, conversationId: null, contactId: null };
    }
  }

  async updateInboundContent(
    message: IncomingMessage,
    tenant: TenantContext,
    content: string,
  ): Promise<void> {
    if (
      !this.database
      || !message.id
      || (message.inputType !== "audio" && message.inputType !== "image")
    ) return;

    try {
      await this.database.prepare(
        `UPDATE messages
         SET content = ?1
         WHERE tenant_id = ?2
           AND meta_message_id = ?3
           AND direction = 'inbound'`,
      )
        .bind(content, tenant.tenantId, message.id)
        .run();
    } catch {
      this.log("whatsapp_database_write_failed", {
        reason: "inbound_media_content_persistence_error",
      });
    }
  }

  async loadHistory(
    tenant: TenantContext,
    whatsappUserId: string,
  ): Promise<ConversationHistoryMessage[]> {
    if (!this.database) return [];

    try {
      const rows = await this.database.prepare(
        `SELECT direction, content, created_at
         FROM messages
         WHERE tenant_id = ?1
           AND conversation_id = ?2
         ORDER BY id DESC
         LIMIT ?3`,
      )
        .bind(
          tenant.tenantId,
          `${tenant.tenantId}:${whatsappUserId}`,
          this.maxMemoryMessages,
        )
        .all<{ direction: string; content: string; created_at: string }>();

      return (rows.results ?? [])
        .reverse()
        .map((row): ConversationHistoryMessage => ({
          role: row.direction === "inbound" ? "user" : "assistant",
          content: row.content.slice(0, this.maxMemoryMessageLength),
          createdAt: row.created_at,
        }));
    } catch {
      this.log("whatsapp_conversation_history_failed", {
        reason: "database_error",
      });
      return [];
    }
  }

  async persistOutbound(
    tenant: TenantContext,
    conversationId: string | null,
    replyText: string,
    result: SendResult,
    messageType = "text",
  ): Promise<void> {
    if (!this.database || !conversationId) return;

    try {
      await this.database.prepare(
        `INSERT INTO messages (
           tenant_id,
           conversation_id,
           meta_message_id,
           direction,
           message_type,
           content,
           status
         )
         VALUES (?1, ?2, ?3, 'outbound', ?4, ?5, ?6)`,
      )
        .bind(
          tenant.tenantId,
          conversationId,
          result.metaMessageId,
          messageType,
          replyText,
          result.status,
        )
        .run();
    } catch {
      this.log("whatsapp_database_write_failed", {
        reason: "outbound_message_persistence_error",
      });
    }
  }

  async resolveContactRole(
    tenant: TenantContext,
    contactId: number | null,
  ): Promise<string | null> {
    if (!this.database || contactId === null) return null;

    try {
      const row = await this.database.prepare(
        `SELECT active_role_key
         FROM contacts
         WHERE id = ?1 AND tenant_id = ?2
         LIMIT 1`,
      )
        .bind(contactId, tenant.tenantId)
        .first<ContactRoleRow>();
      return row?.active_role_key?.trim() || null;
    } catch {
      this.log("whatsapp_contact_role_lookup_failed", {
        reason: "database_error",
      });
      return null;
    }
  }

  private placeholderFor(inputType: IncomingMessage["inputType"]): string {
    if (inputType === "audio") return AUDIO_PLACEHOLDER;
    if (inputType === "image") return IMAGE_PLACEHOLDER;
    if (inputType === "document") return DOCUMENT_PLACEHOLDER;
    return "";
  }
}
