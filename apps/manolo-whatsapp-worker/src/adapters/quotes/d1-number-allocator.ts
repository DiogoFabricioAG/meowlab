import type {
  QuoteNumberAllocator,
  QuoteSequenceScope,
} from "../../quotes/numbering";

type QuoteScopeRow = {
  id: string;
  tenant_id: string;
  name: string;
};

export class D1QuoteNumberAllocator implements QuoteNumberAllocator {
  constructor(
    private readonly database: D1Database | null | undefined,
    private readonly log: (
      event: string,
      details?: Record<string, unknown>,
    ) => void,
  ) {}

  async getOrCreateScope(
    tenantId: string,
    contactId: number,
  ): Promise<QuoteSequenceScope | null> {
    if (!this.database) {
      return null;
    }

    const defaultScopeId = `${tenantId}:contact:${contactId}`;
    try {
      const existing = await this.database
        .prepare(
          `SELECT qs.id, qs.tenant_id, qs.name
           FROM quote_sequence_scopes qs
           INNER JOIN quote_sequence_members qsm ON qsm.scope_id = qs.id
           WHERE qsm.tenant_id = ?1 AND qsm.contact_id = ?2
           LIMIT 1`,
        )
        .bind(tenantId, contactId)
        .first<QuoteScopeRow>();

      if (existing) {
        return this.toScope(existing);
      }

      const historical = await this.database
        .prepare(
          `SELECT COALESCE(MAX(CAST(quote_number AS INTEGER)), 99) AS max_number
           FROM quote_drafts
           WHERE tenant_id = ?1
             AND contact_id = ?2
             AND quote_number IS NOT NULL`,
        )
        .bind(tenantId, contactId)
        .first<{ max_number: number }>();
      const nextNumber = Math.max(Number(historical?.max_number ?? 99) + 1, 100);

      await this.database
        .prepare(
          `INSERT OR IGNORE INTO quote_sequence_scopes (
             id, tenant_id, name, next_number
           ) VALUES (?1, ?2, ?3, ?4)`,
        )
        .bind(defaultScopeId, tenantId, `Contacto ${contactId}`, nextNumber)
        .run();

      await this.database
        .prepare(
          `INSERT OR IGNORE INTO quote_sequence_members (
             scope_id, tenant_id, contact_id
           ) VALUES (?1, ?2, ?3)`,
        )
        .bind(defaultScopeId, tenantId, contactId)
        .run();

      const created = await this.database
        .prepare(
          `SELECT id, tenant_id, name
           FROM quote_sequence_scopes
           WHERE id = ?1 AND tenant_id = ?2
           LIMIT 1`,
        )
        .bind(defaultScopeId, tenantId)
        .first<QuoteScopeRow>();

      return created ? this.toScope(created) : null;
    } catch {
      this.log("whatsapp_quote_numbering_failed", {
        reason: "scope_lookup_error",
      });
      return null;
    }
  }

  async allocate(scopeId: string): Promise<string | null> {
    if (!this.database) {
      return null;
    }

    try {
      const row = await this.database
        .prepare(
          `UPDATE quote_sequence_scopes
           SET next_number = next_number + 1,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?1
           RETURNING next_number - 1 AS allocated_number`,
        )
        .bind(scopeId)
        .first<{ allocated_number: number }>();

      return typeof row?.allocated_number === "number"
        ? row.allocated_number.toString().padStart(8, "0")
        : null;
    } catch {
      this.log("whatsapp_quote_numbering_failed", {
        reason: "number_allocation_error",
      });
      return null;
    }
  }

  private toScope(row: QuoteScopeRow): QuoteSequenceScope {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      name: row.name,
    };
  }
}
