import type {
  PlatformInboundSyncRequest,
  PlatformOutboundSyncRequest,
  PlatformSyncResponse,
} from "../../bridge/contracts";

type QueryResult<T> = { rows: T[] };

type PlatformDbClient = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>>;
  release(destroy?: boolean): void;
};

export type PlatformSyncPool = {
  connect(): Promise<PlatformDbClient>;
};

export class PlatformSyncConflictError extends Error {
  constructor() {
    super("platform_sync_idempotency_conflict");
    this.name = "PlatformSyncConflictError";
  }
}

type IdempotencyRow = {
  request_hash: string;
  status: "processing" | "completed" | "failed";
};

type ContactRow = { id: number };

const IDEMPOTENCY_RETENTION_HOURS = 48;

export class PlatformSyncService {
  constructor(private readonly pool: PlatformSyncPool) {}

  async syncInbound(
    request: PlatformInboundSyncRequest,
    requestHash: string,
  ): Promise<PlatformSyncResponse> {
    return this.syncMessage(request, requestHash, "inbound");
  }

  async syncOutbound(
    request: PlatformOutboundSyncRequest,
    requestHash: string,
  ): Promise<PlatformSyncResponse> {
    return this.syncMessage(request, requestHash, "outbound");
  }

  private async syncMessage(
    request: PlatformInboundSyncRequest | PlatformOutboundSyncRequest,
    requestHash: string,
    direction: "inbound" | "outbound",
  ): Promise<PlatformSyncResponse> {
    const client = await this.pool.connect();
    let destroyClient = false;

    try {
      await client.query("BEGIN");
      const existing = await client.query<IdempotencyRow>(
        `SELECT request_hash, status
         FROM whatsapp.idempotency_keys
         WHERE tenant_id = $1 AND scope = $2 AND key = $3
         FOR UPDATE`,
        [request.tenantId, `message-${direction}`, request.requestId],
      );
      const previous = existing.rows[0];
      if (previous) {
        if (previous.request_hash !== requestHash) {
          throw new PlatformSyncConflictError();
        }
        await client.query("COMMIT");
        return this.response(request.requestId, true);
      }

      await client.query(
        `INSERT INTO whatsapp.idempotency_keys (
           tenant_id, scope, key, request_hash, status, expires_at
         ) VALUES ($1, $2, $3, $4, 'processing',
           CURRENT_TIMESTAMP + ($5 * INTERVAL '1 hour'))`,
        [
          request.tenantId,
          `message-${direction}`,
          request.requestId,
          requestHash,
          IDEMPOTENCY_RETENTION_HOURS,
        ],
      );

      await this.assertTenant(client, request);
      const contactId = await this.upsertContact(client, request);
      const conversationId = await this.upsertConversation(
        client,
        request,
        contactId,
      );
      const metaMessageId = request.message.metaMessageId
        ?? `manolo:${direction}:${request.requestId}`;

      await client.query(
        `INSERT INTO whatsapp.messages (
           tenant_id,
           conversation_id,
           meta_message_id,
           direction,
           message_type,
           content,
           status,
           created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (tenant_id, meta_message_id) DO NOTHING`,
        [
          request.tenantId,
          conversationId,
          metaMessageId,
          direction,
          request.message.messageType,
          request.message.content,
          request.message.status || (direction === "inbound" ? "received" : "sent"),
          request.message.createdAt,
        ],
      );

      await client.query(
        `UPDATE whatsapp.conversations
         SET last_message_at = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND tenant_id = $3`,
        [request.message.createdAt, conversationId, request.tenantId],
      );
      await client.query(
        `UPDATE whatsapp.idempotency_keys
         SET status = 'completed', updated_at = CURRENT_TIMESTAMP
         WHERE tenant_id = $1 AND scope = $2 AND key = $3`,
        [request.tenantId, `message-${direction}`, request.requestId],
      );
      await client.query("COMMIT");
      return this.response(request.requestId, false);
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        destroyClient = true;
      }
      throw error;
    } finally {
      client.release(destroyClient);
    }
  }

  private async assertTenant(
    client: PlatformDbClient,
    request: PlatformInboundSyncRequest | PlatformOutboundSyncRequest,
  ): Promise<void> {
    const result = await client.query(
      `SELECT 1
       FROM whatsapp.tenants AS tenant
       INNER JOIN whatsapp.whatsapp_numbers AS number
         ON number.tenant_id = tenant.id
       WHERE tenant.id = $1
         AND number.phone_number_id = $2
         AND tenant.status = 'active'
         AND number.active = TRUE
       LIMIT 1`,
      [request.tenantId, request.phoneNumberId],
    );
    if (result.rows.length === 0) {
      throw new Error("platform_sync_tenant_not_found");
    }
  }

  private async upsertContact(
    client: PlatformDbClient,
    request: PlatformInboundSyncRequest | PlatformOutboundSyncRequest,
  ): Promise<number> {
    if (request.contactId !== null) {
      await client.query(
        `INSERT INTO whatsapp.contacts (
           id, tenant_id, whatsapp_user_id, display_phone, phone_e164, updated_at
         ) VALUES (
           $1, $2, $3, $3,
           CASE WHEN $3 ~ '^[1-9][0-9]{7,14}$' THEN '+' || $3 ELSE NULL END,
           CURRENT_TIMESTAMP
         )
         ON CONFLICT (id) DO NOTHING`,
        [request.contactId, request.tenantId, request.whatsappUserId],
      );
    }

    const result = await client.query<ContactRow>(
      `INSERT INTO whatsapp.contacts (
         tenant_id, whatsapp_user_id, display_phone, phone_e164, last_seen_at, updated_at
       ) VALUES (
         $1, $2, $2,
         CASE WHEN $2 ~ '^[1-9][0-9]{7,14}$' THEN '+' || $2 ELSE NULL END,
         $3, CURRENT_TIMESTAMP
       )
       ON CONFLICT (tenant_id, whatsapp_user_id)
       DO UPDATE SET display_phone = EXCLUDED.display_phone,
                     phone_e164 = EXCLUDED.phone_e164,
                     last_seen_at = EXCLUDED.last_seen_at,
                     updated_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [request.tenantId, request.whatsappUserId, request.message.createdAt],
    );
    const contact = result.rows[0];
    if (!contact) throw new Error("platform_sync_contact_not_found");
    return contact.id;
  }

  private async upsertConversation(
    client: PlatformDbClient,
    request: PlatformInboundSyncRequest | PlatformOutboundSyncRequest,
    contactId: number,
  ): Promise<string> {
    const id = request.conversationId?.trim()
      || `${request.tenantId}:${request.whatsappUserId}`;
    await client.query(
      `INSERT INTO whatsapp.conversations (
         id, tenant_id, contact_id, last_message_at, updated_at
       ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (id)
       DO UPDATE SET last_message_at = EXCLUDED.last_message_at,
                     updated_at = CURRENT_TIMESTAMP`,
      [id, request.tenantId, contactId, request.message.createdAt],
    );
    return id;
  }

  private response(requestId: string, duplicate: boolean): PlatformSyncResponse {
    return {
      version: 1,
      requestId,
      accepted: true,
      duplicate,
    };
  }
}
