import type { Pool } from "pg";
import type {
  BridgeRequestClaim,
  BridgeRequestIdentity,
  BridgeRequestStore,
} from "./request-store";

type StoredBridgeRequest = {
  request_hash: string;
  status: "processing" | "completed" | "failed";
  response_text: string | null;
};

export class PgBridgeRequestStore implements BridgeRequestStore {
  constructor(private readonly pool: Pool) {}

  async claim(identity: BridgeRequestIdentity): Promise<BridgeRequestClaim> {
    const inserted = await this.pool.query<{ request_id: string }>(
      `INSERT INTO whatsapp.bridge_requests
         (request_id, tenant_id, role_key, request_hash, status)
       VALUES ($1, $2, $3, $4, 'processing')
       ON CONFLICT (request_id) DO NOTHING
       RETURNING request_id`,
      [
        identity.requestId,
        identity.tenantId,
        identity.roleKey,
        identity.requestHash,
      ],
    );
    if (inserted.rowCount === 1) return { status: "claimed" };

    const existing = await this.pool.query<StoredBridgeRequest>(
      `SELECT request_hash, status, response_text
       FROM whatsapp.bridge_requests
       WHERE request_id = $1`,
      [identity.requestId],
    );
    const row = existing.rows[0];
    if (!row || row.request_hash !== identity.requestHash) {
      return { status: "conflict" };
    }
    if (row.status === "completed" && row.response_text) {
      return { status: "completed", replyText: row.response_text };
    }
    if (row.status === "processing") return { status: "in_progress" };

    const reclaimed = await this.pool.query<{ request_id: string }>(
      `UPDATE whatsapp.bridge_requests
       SET status = 'processing', response_text = NULL, error_code = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE request_id = $1 AND request_hash = $2 AND status = 'failed'
       RETURNING request_id`,
      [identity.requestId, identity.requestHash],
    );
    return reclaimed.rowCount === 1
      ? { status: "claimed" }
      : { status: "in_progress" };
  }

  async complete(
    identity: BridgeRequestIdentity,
    replyText: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE whatsapp.bridge_requests
       SET status = 'completed', response_text = $3, error_code = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE request_id = $1 AND request_hash = $2`,
      [identity.requestId, identity.requestHash, replyText],
    );
  }

  async fail(
    identity: BridgeRequestIdentity,
    errorCode: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE whatsapp.bridge_requests
       SET status = 'failed', response_text = NULL, error_code = $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE request_id = $1 AND request_hash = $2`,
      [identity.requestId, identity.requestHash, errorCode],
    );
  }
}
