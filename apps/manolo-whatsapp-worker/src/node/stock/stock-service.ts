import { randomUUID } from "node:crypto";
import type {
  ItemKind,
  MoveKind,
  MovePeriod,
  QueryType,
  StockAlert,
  StockBridgeRequest,
  StockBridgeResponse,
  StockItem,
  StockLineInput,
} from "../../stock/bridge-contracts";
import type { BridgeRequestIdentity, BridgeRequestStore } from "../bridge/request-store";
import type { RoleLog } from "../../roles/contracts";

type Rows = { rows: Array<Record<string, unknown>> };
type Db = { query(sql: string, values?: readonly unknown[]): Promise<unknown> };
type QueryClient = { query(sql: string, values?: readonly unknown[]): Promise<Rows>; release(destroy?: boolean): void };
export type StockPool = { connect(): Promise<unknown>; query(sql: string, values?: readonly unknown[]): Promise<unknown> };

export type StockServiceResult =
  | { status: "completed"; response: StockBridgeResponse }
  | { status: "conflict" | "in_progress" };

/** Reads what a company issued in FacturaYa, with the products of each document. */
export interface IssuedDocumentReader {
  /** Null when the company has no FacturaYa or it cannot answer now. */
  read(tenantId: string, since: string): Promise<IssuedDocument[] | null>;
}
export type IssuedDocument = {
  id: string;
  kind: "invoice" | "credit_note";
  number: string;
  status: string;
  items: Array<{ description: string; quantity: number }>;
};

const WRITES = new Set(["move", "set_min", "settings", "link_alias"]);
const LIMA_OFFSET_MS = 5 * 3_600_000;
const DAY_MS = 86_400_000;
const SLOW_DAYS = 30;

class StockError extends Error {
  constructor(readonly code: string, readonly details?: unknown) {
    super(code);
  }
}

const num = (value: unknown) => Number(value ?? 0);
const qty = (value: number) => Math.round(value * 1000) / 1000;

/** Lima calendar boundaries of a period, as UTC instants. */
export function stockPeriod(period: MovePeriod, now: Date): { from: Date; to: Date } {
  const lima = new Date(now.getTime() - LIMA_OFFSET_MS);
  const day = Date.UTC(lima.getUTCFullYear(), lima.getUTCMonth(), lima.getUTCDate()) + LIMA_OFFSET_MS;
  switch (period) {
    case "today":
      return { from: new Date(day), to: new Date(day + DAY_MS) };
    case "yesterday":
      return { from: new Date(day - DAY_MS), to: new Date(day) };
    case "week": {
      const sinceMonday = (lima.getUTCDay() + 6) % 7;
      return { from: new Date(day - sinceMonday * DAY_MS), to: new Date(day + DAY_MS) };
    }
    case "month":
      return { from: new Date(Date.UTC(lima.getUTCFullYear(), lima.getUTCMonth(), 1) + LIMA_OFFSET_MS), to: new Date(day + DAY_MS) };
    case "last_month":
      return {
        from: new Date(Date.UTC(lima.getUTCFullYear(), lima.getUTCMonth() - 1, 1) + LIMA_OFFSET_MS),
        to: new Date(Date.UTC(lima.getUTCFullYear(), lima.getUTCMonth(), 1) + LIMA_OFFSET_MS),
      };
  }
}

/**
 * Stock Cat's data (ADR-0014). The contact must be an active member of a company with Stock
 * Cat on; costs, inventory value and rules belong to the company's owner. Writes are
 * idempotent per request id. Every change is a row in `stock.moves`.
 */
export class StockService {
  constructor(
    private readonly pool: StockPool,
    private readonly requestStore: BridgeRequestStore,
    private readonly log: RoleLog,
    private readonly documents: IssuedDocumentReader | null = null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async process(request: StockBridgeRequest, requestId: string, requestHash: string): Promise<StockServiceResult> {
    if (!WRITES.has(request.operation)) {
      return { status: "completed", response: await this.safely(request, requestId) };
    }
    const identity: BridgeRequestIdentity = {
      requestId,
      tenantId: request.company_id ?? request.channel_tenant_id,
      roleKey: `stock:${request.operation}`,
      requestHash,
    };
    const claim = await this.requestStore.claim(identity);
    if (claim.status === "conflict" || claim.status === "in_progress") return { status: claim.status };
    if (claim.status === "completed") {
      try {
        return { status: "completed", response: { ...(JSON.parse(claim.replyText) as StockBridgeResponse), replayed: true } };
      } catch {
        await this.requestStore.fail(identity, "stored_response_invalid");
        return { status: "in_progress" };
      }
    }
    const response = await this.safely(request, requestId);
    if (response.ok || response.error?.code !== "internal_error") {
      await this.requestStore.complete(identity, JSON.stringify(response));
    } else {
      await this.requestStore.fail(identity, "stock_internal_error");
    }
    return { status: "completed", response };
  }

  private async safely(request: StockBridgeRequest, requestId: string): Promise<StockBridgeResponse> {
    try {
      return { request_id: requestId, ok: true, data: await this.execute(request) };
    } catch (error) {
      if (error instanceof StockError) {
        return { request_id: requestId, ok: false, error: { code: error.code, ...(error.details ? { details: error.details } : {}) } };
      }
      this.log("vps_stock_operation_failed", { operation: request.operation, reason: error instanceof Error ? error.name : "unknown" });
      return { request_id: requestId, ok: false, error: { code: "internal_error" } };
    }
  }

  private async query(sql: string, values: readonly unknown[], db: Db = this.pool): Promise<Rows> {
    return await db.query(sql, values) as Rows;
  }

  /** Companies of the contact with Stock Cat on (courtesy, or a subscription still paid). */
  private async companies(request: StockBridgeRequest): Promise<Array<{ id: string; name: string }>> {
    const contact = await this.query("SELECT 1 FROM whatsapp.contacts WHERE id = $1 AND tenant_id = $2",
      [request.contact_id, request.channel_tenant_id]);
    if (!contact.rows.length) throw new StockError("forbidden");
    const { rows } = await this.query(
      `SELECT tenant.id, tenant.name
         FROM whatsapp.tenant_members AS member
         JOIN whatsapp.tenants AS tenant ON tenant.id = member.tenant_id AND tenant.status = 'active'
         JOIN stock.settings AS settings ON settings.tenant_id = tenant.id AND settings.enabled
              AND (settings.active_until IS NULL OR settings.active_until > CURRENT_TIMESTAMP)
        WHERE member.contact_id = $1 AND member.status = 'active'
        ORDER BY tenant.name`,
      [request.contact_id],
    );
    return rows.map((row) => ({ id: String(row.id), name: String(row.name) }));
  }

  /**
   * The owner is the WhatsApp number linked to the company's owner account in the portal.
   * A company nobody has claimed in the portal yet has no owner: everyone acts as one.
   */
  private async isOwner(companyId: string, contactId: number): Promise<boolean> {
    const { rows } = await this.query(
      `SELECT EXISTS (
                SELECT 1 FROM whatsapp.portal_company_members AS member
                 WHERE member.tenant_id = $1 AND member.role = 'owner') AS claimed,
              EXISTS (
                SELECT 1 FROM whatsapp.portal_company_members AS member
                  JOIN whatsapp.portal_whatsapp_links AS link ON link.portal_user_id = member.portal_user_id
                  JOIN whatsapp.contacts AS contact ON contact.whatsapp_user_id = link.wa_phone
                 WHERE member.tenant_id = $1 AND member.role = 'owner' AND contact.id = $2) AS owner`,
      [companyId, contactId],
    );
    return !rows[0]?.claimed || Boolean(rows[0]?.owner);
  }

  private async execute(request: StockBridgeRequest): Promise<unknown> {
    const companies = await this.companies(request);
    if (request.operation === "companies") return { companies };
    const companyId = request.company_id!;
    if (!companies.some((company) => company.id === companyId)) throw new StockError("forbidden");
    const payload = request.payload ?? {};
    const contactId = request.contact_id;
    const owner = await this.isOwner(companyId, contactId);

    switch (request.operation) {
      case "items":
        return { items: await this.items(companyId, owner), owner, settings: await this.settings(companyId) };
      case "move":
        return this.transaction((client) => this.move(client, companyId, contactId, payload.kind as MoveKind,
          payload.lines as StockLineInput[], (payload.note as string | null | undefined) ?? null));
      case "set_min": {
        if (!owner) throw new StockError("owner_only");
        const { rows } = await this.query(
          `UPDATE stock.items SET min_qty = $3, below_min_alerted = FALSE, updated_at = CURRENT_TIMESTAMP
            WHERE id = (SELECT item_id FROM stock.aliases WHERE tenant_id = $1 AND alias = lower($2)
                        UNION ALL SELECT id FROM stock.items WHERE tenant_id = $1 AND lower(name) = lower($2) LIMIT 1)
            RETURNING name, on_hand, min_qty`,
          [companyId, String(payload.name).trim(), payload.minQty],
        );
        if (!rows.length) throw new StockError("not_found", { name: payload.name });
        const alerts = await this.collectAlerts(this.pool, companyId);
        return { item: { name: String(rows[0].name), onHand: num(rows[0].on_hand), minQty: rows[0].min_qty === null ? null : num(rows[0].min_qty) }, alerts };
      }
      case "settings": {
        if (!owner) throw new StockError("owner_only");
        await this.query("UPDATE stock.settings SET allow_negative = $2, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = $1",
          [companyId, payload.allowNegative]);
        return { settings: await this.settings(companyId) };
      }
      case "query":
        return this.answer(companyId, owner, payload.type as QueryType, payload);
      case "sync_documents":
        return this.syncDocuments(companyId);
      case "link_alias":
        return this.transaction((client) => this.linkAlias(client, companyId, contactId, String(payload.description), String(payload.name)));
    }
  }

  private async settings(companyId: string) {
    const { rows } = await this.query("SELECT allow_negative FROM stock.settings WHERE tenant_id = $1", [companyId]);
    return { allowNegative: rows[0]?.allow_negative !== false };
  }

  private async items(companyId: string, owner: boolean): Promise<StockItem[]> {
    const { rows } = await this.query(
      `SELECT name, kind, on_hand, min_qty, avg_cost_cents, needs_count FROM stock.items
        WHERE tenant_id = $1 AND active ORDER BY (min_qty IS NOT NULL AND on_hand <= min_qty) DESC, lower(name) LIMIT 500`,
      [companyId],
    );
    return rows.map((row) => this.item(row, owner));
  }

  private item(row: Record<string, unknown>, owner: boolean): StockItem {
    const minQty = row.min_qty === null || row.min_qty === undefined ? null : num(row.min_qty);
    const onHand = num(row.on_hand);
    return {
      name: String(row.name),
      kind: row.kind === "supply" ? "supply" : "product",
      onHand,
      minQty,
      low: minQty !== null && onHand <= minQty,
      needsCount: Boolean(row.needs_count),
      ...(owner ? { avgCostCents: row.avg_cost_cents === null || row.avg_cost_cents === undefined ? null : Math.round(num(row.avg_cost_cents)) } : {}),
    };
  }

  /** The item by name or alias, case-insensitive; created when allowed. */
  private async resolve(db: Db, companyId: string, name: string, create: { kind: ItemKind; contactId: number } | null) {
    const clean = name.trim().replace(/\s+/g, " ");
    const found = await this.query(
      `SELECT item.* FROM stock.items AS item
        WHERE item.tenant_id = $1 AND (lower(item.name) = lower($2)
              OR item.id = (SELECT item_id FROM stock.aliases WHERE tenant_id = $1 AND alias = lower($2)))
        LIMIT 1 FOR UPDATE`,
      [companyId, clean], db,
    );
    if (found.rows[0]) return found.rows[0];
    if (!create) return null;
    const inserted = await this.query(
      `INSERT INTO stock.items (id, tenant_id, kind, name, created_by_contact_id) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, lower(name)) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [randomUUID(), companyId, create.kind, clean, create.contactId], db,
    );
    return inserted.rows[0];
  }

  /** One move on one item: updates the balance and the weighted average cost. */
  private async apply(db: Db, companyId: string, item: Record<string, unknown>, kind: string, delta: number,
    unitCostCents: number | null, contactId: number | null, documentNumber: string | null, note: string | null) {
    const before = num(item.on_hand);
    const after = qty(before + delta);
    let avg = item.avg_cost_cents === null || item.avg_cost_cents === undefined ? null : num(item.avg_cost_cents);
    if (delta > 0 && unitCostCents !== null && unitCostCents !== undefined && (kind === "in")) {
      const base = Math.max(before, 0);
      avg = avg === null || base === 0 ? unitCostCents : (base * avg + delta * unitCostCents) / (base + delta);
    }
    const outward = delta < 0;
    await this.query(
      `UPDATE stock.items SET on_hand = $2, avg_cost_cents = $3, updated_at = CURRENT_TIMESTAMP,
              last_out_at = CASE WHEN $4 THEN CURRENT_TIMESTAMP ELSE last_out_at END,
              needs_count = CASE WHEN $5 = 'count' THEN FALSE ELSE needs_count END
        WHERE id = $1`,
      [item.id, after, avg, outward, kind], db,
    );
    await this.query(
      `INSERT INTO stock.moves (id, tenant_id, item_id, kind, delta, balance_after, unit_cost_cents, document_number, note, contact_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [randomUUID(), companyId, item.id, kind, qty(delta), after, kind === "in" ? unitCostCents ?? null : null, documentNumber, note, contactId], db,
    );
    item.on_hand = after;
    item.avg_cost_cents = avg;
    return after;
  }

  private async move(client: QueryClient, companyId: string, contactId: number, kind: MoveKind, lines: StockLineInput[], note: string | null) {
    const { allowNegative } = await this.settingsIn(client, companyId);
    const results: Array<{ name: string; onHand: number; delta: number }> = [];
    for (const line of lines) {
      const item = await this.resolve(client, companyId, line.name, kind === "out" ? null : { kind: line.kind ?? "product", contactId });
      if (!item) throw new StockError("not_found", { name: line.name });
      const current = num(item.on_hand);
      const delta = kind === "in" ? line.quantity : kind === "out" ? -line.quantity : qty(line.quantity - current);
      if (kind === "out" && !allowNegative && current - line.quantity < 0) {
        throw new StockError("insufficient", { name: String(item.name), onHand: current });
      }
      const after = await this.apply(client, companyId, item, kind, delta, line.unitCostCents ?? null, contactId, null, note);
      results.push({ name: String(item.name), onHand: after, delta: qty(delta) });
    }
    const alerts = await this.collectAlerts(client, companyId);
    this.log("vps_stock_moved", { kind, lines: lines.length });
    return { moved: results, alerts };
  }

  private async settingsIn(db: Db, companyId: string) {
    const { rows } = await this.query("SELECT allow_negative FROM stock.settings WHERE tenant_id = $1", [companyId], db);
    return { allowNegative: rows[0]?.allow_negative !== false };
  }

  /**
   * Items now at or below their minimum that were not reported yet; marks them as reported.
   * Items back above the minimum are re-armed so the next drop alerts again.
   */
  private async collectAlerts(db: Db, companyId: string): Promise<StockAlert[]> {
    await this.query(
      `UPDATE stock.items SET below_min_alerted = FALSE
        WHERE tenant_id = $1 AND below_min_alerted AND (min_qty IS NULL OR on_hand > min_qty)`,
      [companyId], db,
    );
    const { rows } = await this.query(
      `UPDATE stock.items SET below_min_alerted = TRUE
        WHERE tenant_id = $1 AND active AND min_qty IS NOT NULL AND on_hand <= min_qty AND NOT below_min_alerted
        RETURNING name, on_hand, min_qty, needs_count`,
      [companyId], db,
    );
    return rows.map((row) => ({ name: String(row.name), onHand: num(row.on_hand), minQty: num(row.min_qty), needsCount: Boolean(row.needs_count) }));
  }

  private async answer(companyId: string, owner: boolean, type: QueryType, payload: Record<string, unknown>) {
    switch (type) {
      case "item": {
        const { rows } = await this.query(
          `SELECT DISTINCT item.name, item.kind, item.on_hand, item.min_qty, item.avg_cost_cents, item.needs_count
             FROM stock.items AS item LEFT JOIN stock.aliases AS alias ON alias.item_id = item.id
            WHERE item.tenant_id = $1 AND item.active AND (item.name ILIKE $2 OR alias.alias ILIKE $2)
            ORDER BY item.name LIMIT 10`,
          [companyId, `%${String(payload.name).trim().replace(/[%_\\]/g, (char) => `\\${char}`)}%`],
        );
        return { items: rows.map((row) => this.item(row, owner)) };
      }
      case "low":
        return { items: (await this.items(companyId, owner)).filter((item) => item.low || item.needsCount) };
      case "slow": {
        const { rows } = await this.query(
          `SELECT name, kind, on_hand, min_qty, avg_cost_cents, needs_count FROM stock.items
            WHERE tenant_id = $1 AND active AND on_hand > 0
              AND (last_out_at IS NULL OR last_out_at < CURRENT_TIMESTAMP - make_interval(days => $2))
            ORDER BY last_out_at NULLS FIRST, name LIMIT 20`,
          [companyId, SLOW_DAYS],
        );
        return { days: SLOW_DAYS, items: rows.map((row) => this.item(row, owner)) };
      }
      case "value": {
        if (!owner) throw new StockError("owner_only");
        const { rows } = await this.query(
          `SELECT COALESCE(sum(on_hand * avg_cost_cents) FILTER (WHERE on_hand > 0 AND avg_cost_cents IS NOT NULL), 0) AS value,
                  count(*) FILTER (WHERE on_hand > 0 AND avg_cost_cents IS NULL) AS without_cost,
                  count(*) FILTER (WHERE on_hand > 0) AS with_stock
             FROM stock.items WHERE tenant_id = $1 AND active`,
          [companyId],
        );
        return { valueCents: Math.round(num(rows[0]?.value)), withoutCost: num(rows[0]?.without_cost), withStock: num(rows[0]?.with_stock) };
      }
      case "moves": {
        const period = payload.period as MovePeriod;
        const { from, to } = stockPeriod(period, this.now());
        const { rows } = await this.query(
          `SELECT item.name,
                  COALESCE(sum(move.delta) FILTER (WHERE move.delta > 0 AND move.kind IN ('in', 'document_in')), 0) AS entered,
                  COALESCE(-sum(move.delta) FILTER (WHERE move.delta < 0 AND move.kind IN ('out', 'document_out')), 0) AS left,
                  COALESCE(sum(move.delta) FILTER (WHERE move.kind = 'count'), 0) AS counted
             FROM stock.moves AS move JOIN stock.items AS item ON item.id = move.item_id
            WHERE move.tenant_id = $1 AND move.created_at >= $2 AND move.created_at < $3
            GROUP BY item.name ORDER BY item.name LIMIT 30`,
          [companyId, from, to],
        );
        return {
          period,
          items: rows.map((row) => ({ name: String(row.name), entered: num(row.entered), left: num(row.left), countDifference: num(row.counted) })),
        };
      }
    }
  }

  /**
   * Accepted documents not processed yet: invoices and receipts take stock out, credit notes
   * put it back. Each document is claimed in the same transaction that moves the stock, so
   * a document never moves it twice. Lines without a matching item are kept to ask once.
   */
  async syncDocuments(companyId: string): Promise<{ processed: number; alerts: StockAlert[]; unmatched: string[]; available: boolean }> {
    if (!this.documents) return { processed: 0, alerts: [], unmatched: [], available: false };
    const since = await this.query("SELECT to_char(documents_since, 'YYYY-MM-DD') AS since FROM stock.settings WHERE tenant_id = $1", [companyId]);
    if (!since.rows.length) return { processed: 0, alerts: [], unmatched: [], available: false };
    const documents = await this.documents.read(companyId, String(since.rows[0].since));
    if (!documents) return { processed: 0, alerts: [], unmatched: [], available: false };
    const done = await this.query("SELECT document_id FROM stock.documents WHERE tenant_id = $1", [companyId]);
    const seen = new Set(done.rows.map((row) => String(row.document_id)));
    let processed = 0;
    // Oldest first, so balances follow the order of sale.
    for (const document of documents.filter((doc) => doc.status === "accepted" && !seen.has(doc.id)).reverse()) {
      const applied = await this.transaction(async (client) => {
        const unmatched: Array<{ description: string; quantity: number }> = [];
        const claimed = await client.query(
          `INSERT INTO stock.documents (tenant_id, document_id, number, kind) VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING RETURNING document_id`,
          [companyId, document.id, document.number, document.kind],
        );
        if (!claimed.rows.length) return false;
        const { allowNegative } = await this.settingsIn(client, companyId);
        for (const line of document.items) {
          const item = await this.resolve(client, companyId, line.description, null);
          if (!item || !(line.quantity > 0)) {
            if (line.quantity > 0) unmatched.push({ description: line.description.slice(0, 300), quantity: line.quantity });
            continue;
          }
          const delta = document.kind === "credit_note" ? line.quantity : -line.quantity;
          const after = await this.apply(client, companyId, item, document.kind === "credit_note" ? "document_in" : "document_out",
            delta, null, null, document.number, null);
          // The sale already happened: with «no negatives» the item is flagged for a count.
          if (after < 0 && !allowNegative) {
            await client.query("UPDATE stock.items SET needs_count = TRUE WHERE id = $1", [item.id]);
          }
        }
        if (unmatched.length) {
          await client.query("UPDATE stock.documents SET unmatched = $3::jsonb WHERE tenant_id = $1 AND document_id = $2",
            [companyId, document.id, JSON.stringify(unmatched)]);
        }
        return true;
      });
      if (applied) processed++;
    }
    const alerts = await this.collectAlerts(this.pool, companyId);
    const unmatched = await this.query(
      `SELECT DISTINCT line->>'description' AS description FROM stock.documents, jsonb_array_elements(unmatched) AS line
        WHERE tenant_id = $1 ORDER BY 1 LIMIT 20`,
      [companyId],
    );
    if (processed) this.log("vps_stock_documents_synced", { processed });
    return { processed, alerts, unmatched: unmatched.rows.map((row) => String(row.description)), available: true };
  }

  /** «Polo blanco M» in invoices is our «Polo blanco talla M»: remembers it and applies the pending lines. */
  private async linkAlias(client: QueryClient, companyId: string, contactId: number, description: string, name: string) {
    const item = await this.resolve(client, companyId, name, { kind: "product", contactId });
    if (!item) throw new StockError("not_found", { name });
    const alias = description.trim().replace(/\s+/g, " ").toLowerCase();
    await client.query(
      `INSERT INTO stock.aliases (tenant_id, alias, item_id) VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, alias) DO UPDATE SET item_id = EXCLUDED.item_id`,
      [companyId, alias, item.id],
    );
    const pending = await client.query(
      `SELECT document_id, number, kind, unmatched FROM stock.documents
        WHERE tenant_id = $1 AND EXISTS (SELECT 1 FROM jsonb_array_elements(unmatched) AS line WHERE lower(line->>'description') = $2)
        FOR UPDATE`,
      [companyId, alias],
    );
    let applied = 0;
    for (const document of pending.rows) {
      const lines = document.unmatched as Array<{ description: string; quantity: number }>;
      const rest = lines.filter((line) => line.description.trim().replace(/\s+/g, " ").toLowerCase() !== alias);
      for (const line of lines.filter((candidate) => !rest.includes(candidate))) {
        await this.apply(client, companyId, item, document.kind === "credit_note" ? "document_in" : "document_out",
          document.kind === "credit_note" ? line.quantity : -line.quantity, null, contactId, String(document.number), null);
        applied++;
      }
      await client.query("UPDATE stock.documents SET unmatched = $3::jsonb WHERE tenant_id = $1 AND document_id = $2",
        [companyId, document.document_id, JSON.stringify(rest)]);
    }
    const alerts = await this.collectAlerts(client, companyId);
    return { item: { name: String(item.name), onHand: num(item.on_hand) }, applied, alerts };
  }

  private async transaction<T>(work: (client: QueryClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect() as QueryClient;
    let destroy = false;
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      destroy = !(error instanceof StockError);
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release(destroy);
    }
  }
}

type DocumentWire = { id?: unknown; kind?: unknown; number?: unknown; status?: unknown; items?: Array<{ description?: unknown; quantity?: unknown }> };

/** FacturaYa's `GET /api/issued-documents?with_items=1` with the company's own token. */
export class FacturayaIssuedDocumentReader implements IssuedDocumentReader {
  constructor(
    private readonly pool: Db,
    private readonly cipher: { decrypt(encrypted: string): string },
    private readonly baseUrl: string,
    private readonly log: RoleLog,
    // Wrapped: a stored `fetch` called as a method can lose its binding.
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async read(tenantId: string, since: string): Promise<IssuedDocument[] | null> {
    const { rows } = await this.pool.query(
      `SELECT encrypted_token FROM whatsapp.tenant_integrations
        WHERE tenant_id = $1 AND provider = 'facturaya' AND status = 'active' LIMIT 1`,
      [tenantId],
    ) as Rows;
    if (!rows.length) return null;
    let token: string;
    try {
      token = this.cipher.decrypt(String(rows[0].encrypted_token));
    } catch {
      this.log("vps_stock_token_unreadable");
      return null;
    }
    const documents: IssuedDocument[] = [];
    for (let page = 1; page <= 20; page++) {
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.baseUrl}/api/issued-documents?with_items=1&from=${since}&page=${page}`, {
          signal: AbortSignal.timeout(15_000),
          headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
        });
      } catch {
        this.log("vps_stock_facturaya_unreachable");
        return null;
      }
      if (!response.ok) {
        this.log("vps_stock_facturaya_error", { status: response.status });
        return null;
      }
      const body = await response.json() as { data?: DocumentWire[]; meta?: { total?: number } };
      for (const wire of body.data ?? []) {
        if (typeof wire.id !== "string" || (wire.kind !== "invoice" && wire.kind !== "credit_note")) continue;
        documents.push({
          id: wire.id,
          kind: wire.kind,
          number: String(wire.number ?? ""),
          status: String(wire.status ?? ""),
          items: (wire.items ?? []).map((item) => ({ description: String(item.description ?? "").trim(), quantity: Number(item.quantity ?? 0) }))
            .filter((item) => item.description),
        });
      }
      if (!body.data?.length || documents.length >= Number(body.meta?.total ?? 0)) return documents;
    }
    return documents;
  }
}
