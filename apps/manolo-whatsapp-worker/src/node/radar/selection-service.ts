import { createHash } from "node:crypto";
import type {
  RadarCandidate,
  RadarChange,
  RadarSelectionState,
  RadarSyncRequest,
  RadarSyncResponse,
} from "../../radar/sync-contracts";

type QueryResult<T> = { rows: T[] };
type DbClient = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>>;
  release(destroy?: boolean): void;
};
export type RadarSelectionPool = { connect(): Promise<unknown> };

type AuthorizedContact = { contact_id: number };
type SavedRequest = { request_hash: string; response: RadarSyncResponse };
type CandidateRow = { candidate: RadarCandidate };
type ChangeRow = {
  seq: string | number;
  ocid: string;
  state: RadarSelectionState;
  changed_at: Date | string;
  candidate: RadarCandidate;
};
type MetaRow = { payload_hash: string; seq: string | number };
type CursorRow = { last_seq: string | number };

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function changeFrom(row: ChangeRow): RadarChange {
  return {
    seq: Number(row.seq),
    ocid: row.ocid,
    state: row.state,
    changedAt: new Date(row.changed_at).toISOString(),
    candidate: row.candidate,
  };
}

const base = (request: RadarSyncRequest, status: RadarSyncResponse["status"]): RadarSyncResponse => ({
  version: 1,
  requestId: request.requestId,
  status,
});

export class PgRadarSelectionService {
  constructor(private readonly pool: RadarSelectionPool) {}

  async execute(request: RadarSyncRequest, requestHash: string): Promise<RadarSyncResponse> {
    const client = await this.pool.connect() as unknown as DbClient;
    let destroy = false;
    try {
      await client.query("BEGIN");
      const authorized = await client.query<AuthorizedContact>(
        `SELECT contact.id AS contact_id
         FROM whatsapp.tenants AS tenant
         INNER JOIN whatsapp.whatsapp_numbers AS number
           ON number.tenant_id = tenant.id AND number.phone_number_id = $2 AND number.active = TRUE
         INNER JOIN whatsapp.contacts AS contact
           ON contact.tenant_id = tenant.id AND contact.whatsapp_user_id = $3
         INNER JOIN whatsapp.bot_configs AS config ON config.tenant_id = tenant.id
         LEFT JOIN whatsapp.role_catalog AS contact_role
           ON contact_role.role_key = NULLIF(BTRIM(contact.active_role_key), '') AND contact_role.active = TRUE
         LEFT JOIN whatsapp.role_catalog AS tenant_role
           ON tenant_role.role_key = NULLIF(BTRIM(config.role_key), '') AND tenant_role.active = TRUE
         WHERE tenant.id = $1 AND tenant.status = 'active'
           AND COALESCE(contact_role.role_key, tenant_role.role_key) = 'radar'
         LIMIT 1`,
        [request.tenantId, request.phoneNumberId, request.whatsappUserId],
      );
      const contact = authorized.rows[0];
      if (!contact) {
        await client.query("COMMIT");
        return base(request, "forbidden");
      }

      const scopeKey = JSON.stringify([request.tenantId, request.phoneNumberId, contact.contact_id]);
      // Hash lock serializes every mutation and sequence allocation for this account.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [scopeKey]);
      await client.query(
        `INSERT INTO whatsapp.radar_selection_counters(tenant_id, phone_number_id, contact_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [request.tenantId, request.phoneNumberId, contact.contact_id],
      );
      await client.query(
        `INSERT INTO whatsapp.radar_sync_installations(
           installation_id, tenant_id, phone_number_id, contact_id, whatsapp_user_id
         ) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (installation_id) DO NOTHING`,
        [request.installationId, request.tenantId, request.phoneNumberId, contact.contact_id, request.whatsappUserId],
      );
      const installation = await client.query(
        `SELECT 1 FROM whatsapp.radar_sync_installations
         WHERE installation_id = $1 AND tenant_id = $2 AND phone_number_id = $3
           AND contact_id = $4 AND whatsapp_user_id = $5`,
        [request.installationId, request.tenantId, request.phoneNumberId, contact.contact_id, request.whatsappUserId],
      );
      if (installation.rows.length === 0) {
        await client.query("COMMIT");
        return base(request, "forbidden");
      }

      const previous = await client.query<SavedRequest>(
        `SELECT request_hash, response FROM whatsapp.radar_sync_requests
         WHERE tenant_id = $1 AND phone_number_id = $2 AND contact_id = $3 AND request_id = $4`,
        [request.tenantId, request.phoneNumberId, contact.contact_id, request.requestId],
      );
      if (previous.rows[0]) {
        const response = previous.rows[0].request_hash === requestHash
          ? previous.rows[0].response
          : base(request, "conflict");
        await client.query("COMMIT");
        return response;
      }

      let response: RadarSyncResponse;
      if (request.operation === "publish_candidates") {
        for (const candidate of request.candidates ?? []) {
          await client.query(
            `INSERT INTO whatsapp.radar_candidate_snapshots(
               tenant_id, phone_number_id, contact_id, ocid, candidate, published_at
             ) VALUES ($1, $2, $3, $4, $5::jsonb, CURRENT_TIMESTAMP)
             ON CONFLICT (tenant_id, phone_number_id, contact_id, ocid)
             DO UPDATE SET candidate = CASE
               WHEN whatsapp.radar_candidate_snapshots.candidate ? 'evidence'
                 AND (NOT (EXCLUDED.candidate ? 'evidence')
                   OR (whatsapp.radar_candidate_snapshots.candidate->'evidence'->>'observedAt')::timestamptz
                     > (EXCLUDED.candidate->'evidence'->>'observedAt')::timestamptz)
                 THEN jsonb_set(EXCLUDED.candidate, '{evidence}',
                   whatsapp.radar_candidate_snapshots.candidate->'evidence')
               ELSE EXCLUDED.candidate
             END,
             published_at = GREATEST(whatsapp.radar_candidate_snapshots.published_at, EXCLUDED.published_at)`,
            [request.tenantId, request.phoneNumberId, contact.contact_id, candidate.alert.ocid, JSON.stringify(candidate)],
          );
        }
        response = { ...base(request, "ok"), published: request.candidates?.length ?? 0 };
      } else if (request.operation === "select_candidate") {
        response = await this.select(client, request, contact.contact_id);
      } else if (request.operation === "pull_changes") {
        const rows = await client.query<ChangeRow>(
          `SELECT seq, ocid, state, changed_at, candidate
           FROM whatsapp.radar_selection_changes
           WHERE tenant_id = $1 AND phone_number_id = $2 AND contact_id = $3 AND seq > $4
           ORDER BY seq ASC LIMIT $5`,
          [request.tenantId, request.phoneNumberId, contact.contact_id, request.after, request.limit],
        );
        const changes = rows.rows.map(changeFrom);
        const issued = changes.length ? changes[changes.length - 1].seq : request.after!;
        const current = await client.query<CursorRow>(
          `SELECT delivered_cursor AS last_seq FROM whatsapp.radar_sync_installations
           WHERE installation_id = $1 FOR UPDATE`,
          [request.installationId],
        );
        const delivered = Number(current.rows[0]?.last_seq ?? 0);
        const latestResult = await client.query<CursorRow>(
          `SELECT last_seq FROM whatsapp.radar_selection_counters
           WHERE tenant_id = $1 AND phone_number_id = $2 AND contact_id = $3`,
          [request.tenantId, request.phoneNumberId, contact.contact_id],
        );
        const latest = Number(latestResult.rows[0]?.last_seq ?? 0);
        if (request.after! > delivered || request.after! > latest) {
          response = base(request, "conflict");
        } else {
          await client.query(
          `UPDATE whatsapp.radar_sync_installations
           SET delivered_cursor = GREATEST(delivered_cursor, $2), updated_at = CURRENT_TIMESTAMP
           WHERE installation_id = $1`,
            [request.installationId, changes.length ? issued : delivered],
          );
          response = { ...base(request, "ok"), changes, cursor: issued };
        }
      } else {
        const cursor = await client.query<CursorRow>(
          `SELECT delivered_cursor AS last_seq FROM whatsapp.radar_sync_installations
           WHERE installation_id = $1 FOR UPDATE`,
          [request.installationId],
        );
        const delivered = Number(cursor.rows[0]?.last_seq ?? 0);
        if (request.cursor! > delivered) {
          response = base(request, "conflict");
        } else {
          const result = await client.query<CursorRow>(
            `UPDATE whatsapp.radar_sync_installations
             SET acked_cursor = GREATEST(acked_cursor, $2), updated_at = CURRENT_TIMESTAMP
             WHERE installation_id = $1 RETURNING acked_cursor AS last_seq`,
            [request.installationId, request.cursor],
          );
          response = { ...base(request, "ok"), ackedCursor: Number(result.rows[0]?.last_seq ?? 0) };
        }
      }

      await client.query(
        `INSERT INTO whatsapp.radar_sync_requests(
           tenant_id, phone_number_id, contact_id, request_id, request_hash, response
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [request.tenantId, request.phoneNumberId, contact.contact_id, request.requestId, requestHash, JSON.stringify(response)],
      );
      await client.query("COMMIT");
      return response;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { destroy = true; }
      throw error;
    } finally {
      client.release(destroy);
    }
  }

  private async select(
    client: DbClient,
    request: RadarSyncRequest,
    contactId: number,
  ): Promise<RadarSyncResponse> {
    const snapshot = await client.query<CandidateRow>(
      `SELECT candidate FROM whatsapp.radar_candidate_snapshots
       WHERE tenant_id = $1 AND phone_number_id = $2 AND contact_id = $3 AND ocid = $4`,
      [request.tenantId, request.phoneNumberId, contactId, request.ocid],
    );
    if (!snapshot.rows[0]) return base(request, "conflict");
    const state = request.state!;
    const payloadHash = hash(JSON.stringify({ ocid: request.ocid, state }));
    const priorMeta = await client.query<MetaRow>(
      `SELECT payload_hash, seq FROM whatsapp.radar_meta_selections
       WHERE tenant_id = $1 AND phone_number_id = $2 AND contact_id = $3 AND meta_message_id = $4`,
      [request.tenantId, request.phoneNumberId, contactId, request.metaMessageId],
    );
    if (priorMeta.rows[0]) {
      if (priorMeta.rows[0].payload_hash !== payloadHash) return base(request, "conflict");
      const existing = await client.query<ChangeRow>(
        `SELECT seq, ocid, state, changed_at, candidate FROM whatsapp.radar_selection_changes
         WHERE tenant_id = $1 AND phone_number_id = $2 AND contact_id = $3 AND seq = $4`,
        [request.tenantId, request.phoneNumberId, contactId, priorMeta.rows[0].seq],
      );
      if (!existing.rows[0]) return base(request, "conflict");
      const selection = changeFrom(existing.rows[0]);
      return { ...base(request, "ok"), selection };
    }

    const counter = await client.query<CursorRow>(
      `UPDATE whatsapp.radar_selection_counters SET last_seq = last_seq + 1
       WHERE tenant_id = $1 AND phone_number_id = $2 AND contact_id = $3
       RETURNING last_seq`,
      [request.tenantId, request.phoneNumberId, contactId],
    );
    const seq = Number(counter.rows[0]?.last_seq);
    const inserted = await client.query<ChangeRow>(
      `INSERT INTO whatsapp.radar_selection_changes(
         tenant_id, phone_number_id, contact_id, seq, ocid, state, candidate
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING seq, ocid, state, changed_at, candidate`,
      [request.tenantId, request.phoneNumberId, contactId, seq, request.ocid, state, JSON.stringify(snapshot.rows[0].candidate)],
    );
    await client.query(
      `INSERT INTO whatsapp.radar_meta_selections(
         tenant_id, phone_number_id, contact_id, meta_message_id, payload_hash, seq
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [request.tenantId, request.phoneNumberId, contactId, request.metaMessageId, payloadHash, seq],
    );
    await client.query(
      `INSERT INTO whatsapp.radar_current_selections(
         tenant_id, phone_number_id, contact_id, ocid, state, seq, changed_at
       ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
       ON CONFLICT (tenant_id, phone_number_id, contact_id, ocid)
       DO UPDATE SET state = EXCLUDED.state, seq = EXCLUDED.seq, changed_at = EXCLUDED.changed_at`,
      [request.tenantId, request.phoneNumberId, contactId, request.ocid, state, seq],
    );
    return { ...base(request, "ok"), selection: changeFrom(inserted.rows[0]) };
  }
}
