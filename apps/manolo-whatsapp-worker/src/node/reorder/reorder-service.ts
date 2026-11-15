import { randomUUID } from "node:crypto";
import type {
  Notice,
  OrderLine,
  OrderStatus,
  OrderSummary,
  ReorderBridgeRequest,
  ReorderBridgeResponse,
  ReorderQueryType,
  ReorderSettings,
  SupplierReply,
  SupplyType,
} from "../../reorder/bridge-contracts";
import type { BridgeRequestIdentity, BridgeRequestStore } from "../bridge/request-store";
import type { RoleLog } from "../../roles/contracts";

type Rows = { rows: Array<Record<string, unknown>> };
type Db = { query(sql: string, values?: readonly unknown[]): Promise<unknown> };
type QueryClient = { query(sql: string, values?: readonly unknown[]): Promise<Rows>; release(destroy?: boolean): void };
export type ReorderPool = { connect(): Promise<unknown>; query(sql: string, values?: readonly unknown[]): Promise<unknown> };

export type ReorderServiceResult =
  | { status: "completed"; response: ReorderBridgeResponse }
  | { status: "conflict" | "in_progress" };

/** What FacturaYa needs to draw a purchase order (`POST /api/internal/purchase-orders/pdf`). */
export type PurchaseOrderPdfInput = {
  company: { name: string; legal_name: string | null; ruc: string | null; address: string | null };
  number: number;
  issue_date: string;
  deliver_by: string | null;
  supplier: { name: string; ruc: string | null };
  lines: Array<{ description: string; quantity: number; unit_price_cents: number | null }>;
  notes: string | null;
};
export interface PurchaseOrderPdfRenderer {
  render(order: PurchaseOrderPdfInput): Promise<Uint8Array>;
}

const MAX_PDF_BYTES = 2 * 1024 * 1024;

/** FacturaYa draws the PDF with the documents' single layout (ADR-0013); it stores nothing. */
export class FacturayaPurchaseOrderPdfRenderer implements PurchaseOrderPdfRenderer {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async render(order: PurchaseOrderPdfInput): Promise<Uint8Array> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/internal/purchase-orders/pdf`, {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: { Accept: "application/pdf", "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
      body: JSON.stringify(order),
    });
    if (!response.ok) throw new ReorderError("unavailable");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length < 100 || bytes.length > MAX_PDF_BYTES || new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
      throw new ReorderError("unavailable");
    }
    return bytes;
  }
}

/** An entry that arrived through Stock Cat (ADR-0016, point 12). */
export type ReceivedEntry = { itemId: string; name: string; quantity: number; unitCostCents: number | null };
export type Reception = { number: number; kind: "purchase" | "production"; supplier: string | null; complete: boolean; missing: Array<{ item: string; quantity: number }> };

export type ReorderSnapshot = {
  settings: ReorderSettings;
  proposals: OrderSummary[];
  open: OrderSummary[];
  notices: Notice[];
  needsMax: string[];
  needsSupplier: string[];
  monthSpentCents: number;
  suppliers: Array<{ name: string; phone: string | null; ruc: string | null; items: string[] }>;
  month: Array<{ supplier: string; orders: number; totalCents: number }>;
};

class ReorderError extends Error {
  constructor(readonly code: string, readonly details?: unknown) {
    super(code);
  }
}

const WRITES = new Set(["set_rule", "set_supplier", "approve", "mark_sent", "discard", "change_line", "settings", "notices_delivered", "supplier_reply"]);
const OPEN_STATUSES = ["proposed", "sent", "confirmed", "partial", "in_production"];
const RECEIVING_STATUSES = ["sent", "confirmed", "partial", "in_production"];
const LIMA_OFFSET_MS = 5 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** Suppliers are written to between 8:00 and 20:00 of Lima (ADR-0016, Fases). */
const SUPPLIER_HOURS = { start: 8, end: 20 };

const num = (value: unknown) => Number(value ?? 0);
const nullableNum = (value: unknown) => (value === null || value === undefined ? null : Number(value));
const optional = (value: unknown) => (value === null || value === undefined ? null : String(value));
const day = (value: unknown) => (value === null || value === undefined ? null
  : value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10));
const qty = (value: number) => Math.round(value * 1000) / 1000;
export const orderCode = (number: number) => `OC-${String(number).padStart(6, "0")}`;
export const soles = (cents: number) => `S/ ${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shortDate = (value: string) => `${value.slice(8, 10)}/${value.slice(5, 7)}`;
const limaHour = (now: Date) => new Date(now.getTime() - LIMA_OFFSET_MS).getUTCHours();
const limaMonthStart = (now: Date) => {
  const lima = new Date(now.getTime() - LIMA_OFFSET_MS);
  return new Date(Date.UTC(lima.getUTCFullYear(), lima.getUTCMonth(), 1) + LIMA_OFFSET_MS);
};

const ITEM_SQL = `SELECT item.* FROM stock.items AS item
  WHERE item.tenant_id = $1 AND item.active AND (lower(item.name) = lower($2)
        OR item.id = (SELECT item_id FROM stock.aliases WHERE tenant_id = $1 AND alias = lower($2)))
  LIMIT 1`;

/**
 * Reorder Cat's data (ADR-0016). Members see the orders and add suppliers; only the owner
 * approves, changes rules and budget (point 6). The supplier side and the cron speak for
 * the platform. Writes are idempotent per request id; every decision is in the audit log.
 */
export class ReorderService {
  constructor(
    private readonly pool: ReorderPool,
    private readonly requestStore: BridgeRequestStore,
    private readonly log: RoleLog,
    private readonly renderer: PurchaseOrderPdfRenderer | null = null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async process(request: ReorderBridgeRequest, requestId: string, requestHash: string): Promise<ReorderServiceResult> {
    if (!WRITES.has(request.operation)) {
      return { status: "completed", response: await this.safely(request, requestId) };
    }
    const identity: BridgeRequestIdentity = {
      requestId,
      tenantId: request.company_id ?? request.channel_tenant_id,
      roleKey: `reorder:${request.operation}`,
      requestHash,
    };
    const claim = await this.requestStore.claim(identity);
    if (claim.status === "conflict" || claim.status === "in_progress") return { status: claim.status };
    if (claim.status === "completed") {
      try {
        return { status: "completed", response: { ...(JSON.parse(claim.replyText) as ReorderBridgeResponse), replayed: true } };
      } catch {
        await this.requestStore.fail(identity, "stored_response_invalid");
        return { status: "in_progress" };
      }
    }
    const response = await this.safely(request, requestId);
    if (response.ok || response.error?.code !== "internal_error") {
      await this.requestStore.complete(identity, JSON.stringify(response));
    } else {
      await this.requestStore.fail(identity, "reorder_internal_error");
    }
    return { status: "completed", response };
  }

  private async safely(request: ReorderBridgeRequest, requestId: string): Promise<ReorderBridgeResponse> {
    try {
      return { request_id: requestId, ok: true, data: await this.execute(request) };
    } catch (error) {
      if (error instanceof ReorderError) {
        return { request_id: requestId, ok: false, error: { code: error.code, ...(error.details ? { details: error.details } : {}) } };
      }
      this.log("vps_reorder_operation_failed", { operation: request.operation, reason: error instanceof Error ? error.name : "unknown" });
      return { request_id: requestId, ok: false, error: { code: "internal_error" } };
    }
  }

  private async query(sql: string, values: readonly unknown[], db: Db = this.pool): Promise<Rows> {
    return await db.query(sql, values) as Rows;
  }

  /** Companies of the contact with Reorder Cat on (courtesy, or a subscription still paid). */
  private async companies(request: ReorderBridgeRequest): Promise<Array<{ id: string; name: string }>> {
    const contact = await this.query("SELECT 1 FROM whatsapp.contacts WHERE id = $1 AND tenant_id = $2",
      [request.contact_id, request.channel_tenant_id]);
    if (!contact.rows.length) throw new ReorderError("forbidden");
    const { rows } = await this.query(
      `SELECT tenant.id, tenant.name
         FROM whatsapp.tenant_members AS member
         JOIN whatsapp.tenants AS tenant ON tenant.id = member.tenant_id AND tenant.status = 'active'
         JOIN purchasing.settings AS settings ON settings.tenant_id = tenant.id AND settings.enabled
              AND (settings.active_until IS NULL OR settings.active_until > CURRENT_TIMESTAMP)
        WHERE member.contact_id = $1 AND member.status = 'active'
        ORDER BY tenant.name`,
      [request.contact_id],
    );
    return rows.map((row) => ({ id: String(row.id), name: String(row.name) }));
  }

  /** Reorder Cat on for the company, whoever asks (supplier side, cron, Stock Cat's entries). */
  async enabled(companyId: string, db: Db = this.pool): Promise<{ name: string } | null> {
    const { rows } = await this.query(
      `SELECT tenant.name FROM purchasing.settings AS settings
         JOIN whatsapp.tenants AS tenant ON tenant.id = settings.tenant_id AND tenant.status = 'active'
        WHERE settings.tenant_id = $1 AND settings.enabled AND (settings.active_until IS NULL OR settings.active_until > CURRENT_TIMESTAMP)`,
      [companyId], db,
    );
    return rows.length ? { name: String(rows[0].name) } : null;
  }

  /** Same rule as the other cats: the WhatsApp linked to the portal owner; unclaimed companies have none. */
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

  /** Where to tell the owner something: the WhatsApp linked to the owner's portal account. */
  private async ownerPhones(companyId: string, db: Db = this.pool): Promise<string[]> {
    const { rows } = await this.query(
      `SELECT DISTINCT link.wa_phone FROM whatsapp.portal_company_members AS member
         JOIN whatsapp.portal_whatsapp_links AS link ON link.portal_user_id = member.portal_user_id
        WHERE member.tenant_id = $1 AND member.role = 'owner'`,
      [companyId], db,
    );
    return rows.map((row) => String(row.wa_phone)).filter((phone) => /^[0-9]{8,15}$/.test(phone));
  }

  private async execute(request: ReorderBridgeRequest): Promise<unknown> {
    const payload = request.payload ?? {};
    if (request.contact_id === undefined) return this.executeSystem(request, payload);
    const companies = await this.companies(request);
    if (request.operation === "companies") return { companies };
    if (request.operation === "supplier_match" || request.operation === "followups") throw new ReorderError("forbidden");
    const companyId = request.company_id!;
    const company = companies.find((candidate) => candidate.id === companyId);
    if (!company) throw new ReorderError("forbidden");
    const contactId = request.contact_id;
    const owner = await this.isOwner(companyId, contactId);
    const requireOwner = () => {
      if (!owner) throw new ReorderError("owner_only");
    };
    const actor = { contactId, portalUserId: null };

    switch (request.operation) {
      case "overview":
      case "propose": {
        const proposed = await this.transaction((client) => this.propose(client, companyId));
        return { owner, companyName: company.name, created: proposed.created, ...await this.snapshot(companyId) };
      }
      case "set_rule":
        requireOwner();
        return this.transaction((client) => this.setRule(client, companyId, actor, payload));
      case "set_supplier":
        return this.transaction((client) => this.setSupplier(client, companyId, actor, payload));
      case "approve":
        requireOwner();
        return this.transaction((client) => this.approve(client, companyId, company.name, actor, String(payload.orderId), payload.force === true));
      case "mark_sent":
        requireOwner();
        return this.transaction((client) => this.markSent(client, companyId, actor, String(payload.orderId), payload.sent === true,
          request.channel_tenant_id, String(payload.phoneNumberId)));
      case "discard":
        requireOwner();
        return this.transaction(async (client) => {
          const order = await this.lockOrder(client, companyId, String(payload.orderId));
          if (order.status !== "proposed") throw new ReorderError("not_proposed", { status: order.status });
          await client.query("UPDATE purchasing.orders SET status = 'cancelled', closed_at = $2, updated_at = $2 WHERE id = $1", [order.id, this.now()]);
          await this.audit(client, companyId, actor, "discard", { orderId: order.id });
          return { order: await this.order(client, companyId, String(order.id)) };
        });
      case "change_line":
        requireOwner();
        return this.transaction((client) => this.changeLine(client, companyId, actor, String(payload.orderId), String(payload.item), Number(payload.quantity)));
      case "settings":
        requireOwner();
        return { settings: await this.changeSettings(companyId, actor, payload.change as Partial<ReorderSettings>) };
      case "query":
        return this.answer(companyId, payload.type as ReorderQueryType);
      case "order_pdf":
        return this.orderPdf(companyId, String(payload.orderId));
      case "notices_delivered":
        return this.noticesDelivered(companyId, payload.ids as string[]);
      case "supplier_reply":
        throw new ReorderError("forbidden");
    }
  }

  /** The supplier side and the cron: no contact, the platform itself speaks. */
  private async executeSystem(request: ReorderBridgeRequest, payload: Record<string, unknown>): Promise<unknown> {
    switch (request.operation) {
      case "supplier_match":
        return { matches: await this.supplierMatch(String(payload.phone)) };
      case "followups":
        return this.followups();
      default: {
        const companyId = request.company_id!;
        if (!await this.enabled(companyId)) throw new ReorderError("forbidden");
        if (request.operation === "supplier_reply") {
          return this.transaction((client) => this.supplierReply(client, companyId, String(payload.orderId), String(payload.phone),
            payload.reply as SupplierReply));
        }
        if (request.operation === "order_pdf") return this.orderPdf(companyId, String(payload.orderId));
        if (request.operation === "notices_delivered") return this.noticesDelivered(companyId, payload.ids as string[]);
        throw new ReorderError("forbidden");
      }
    }
  }

  async settings(companyId: string, db: Db = this.pool): Promise<ReorderSettings> {
    const { rows } = await this.query(
      "SELECT monthly_budget_cents, followup_hours, escalate_hours FROM purchasing.settings WHERE tenant_id = $1", [companyId], db);
    const row = rows[0] ?? {};
    return { monthlyBudgetCents: nullableNum(row.monthly_budget_cents), followupHours: num(row.followup_hours ?? 24), escalateHours: num(row.escalate_hours ?? 48) };
  }

  async changeSettings(companyId: string, actor: { contactId: number | null; portalUserId: string | null }, change: Partial<ReorderSettings>): Promise<ReorderSettings> {
    return this.transaction(async (client) => {
      const next = { ...await this.settings(companyId, client), ...change };
      if (next.escalateHours <= next.followupHours) throw new ReorderError("invalid_settings");
      await client.query(
        `UPDATE purchasing.settings SET monthly_budget_cents = $2, followup_hours = $3, escalate_hours = $4, updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = $1`,
        [companyId, next.monthlyBudgetCents, next.followupHours, next.escalateHours]);
      await this.audit(client, companyId, actor, "settings", change);
      return next;
    });
  }

  /**
   * Items at or below their minimum without an open order become proposals (points 1, 4, 5
   * and 14): one purchase order per supplier, one production order per own product. Items
   * without a maximum, or bought without a supplier's WhatsApp, are listed to ask for.
   */
  private async propose(client: QueryClient, companyId: string) {
    // One proposer at a time per company: numbering and "no open order" stay consistent.
    const locked = await client.query("SELECT tenant_id FROM purchasing.settings WHERE tenant_id = $1 FOR UPDATE", [companyId]);
    if (!locked.rows.length) throw new ReorderError("forbidden");
    const { rows } = await client.query(
      `SELECT item.id, item.name, item.on_hand, item.avg_cost_cents,
              COALESCE(rule.supply_type, 'purchase') AS supply_type, rule.max_qty, rule.last_unit_cost_cents,
              supplier.id AS supplier_id, supplier.phone AS supplier_phone
         FROM stock.items AS item
         LEFT JOIN purchasing.item_rules AS rule ON rule.item_id = item.id
         LEFT JOIN purchasing.suppliers AS supplier ON supplier.id = rule.supplier_id AND supplier.active
        WHERE item.tenant_id = $1 AND item.active AND item.min_qty IS NOT NULL AND item.on_hand <= item.min_qty
          AND NOT EXISTS (
                SELECT 1 FROM purchasing.order_lines AS line JOIN purchasing.orders AS orders ON orders.id = line.order_id
                 WHERE line.item_id = item.id AND orders.status = ANY($2::text[]))
        ORDER BY lower(item.name)`,
      [companyId, OPEN_STATUSES],
    );
    const needsMax: string[] = [];
    const needsSupplier: string[] = [];
    const groups = new Map<string, Array<{ itemId: string; name: string; quantity: number; unitCents: number | null }>>();
    for (const row of rows) {
      if (row.max_qty === null || row.max_qty === undefined) {
        needsMax.push(String(row.name));
        continue;
      }
      const quantity = Math.ceil(num(row.max_qty) - num(row.on_hand));
      if (quantity <= 0) continue;
      const unitCents = row.last_unit_cost_cents !== null && row.last_unit_cost_cents !== undefined ? num(row.last_unit_cost_cents)
        : row.avg_cost_cents !== null && row.avg_cost_cents !== undefined ? Math.round(num(row.avg_cost_cents)) : null;
      const line = { itemId: String(row.id), name: String(row.name), quantity, unitCents };
      if (row.supply_type === "manufacture") {
        groups.set(`production:${row.id}`, [line]);
      } else if (!row.supplier_id || !row.supplier_phone) {
        needsSupplier.push(String(row.name));
      } else {
        const key = `purchase:${row.supplier_id}`;
        groups.set(key, [...(groups.get(key) ?? []), line]);
      }
    }
    const created: string[] = [];
    for (const [key, lines] of groups) {
      const [kind, ref] = key.split(":");
      const numbered = await client.query(
        "UPDATE purchasing.settings SET last_order_number = last_order_number + 1 WHERE tenant_id = $1 RETURNING last_order_number", [companyId]);
      const id = randomUUID();
      const priced = lines.filter((line) => line.unitCents !== null);
      const estimated = priced.length ? priced.reduce((sum, line) => sum + Math.round(line.quantity * line.unitCents!), 0) : null;
      await client.query(
        `INSERT INTO purchasing.orders (id, tenant_id, number, kind, supplier_id, status, estimated_cents, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'proposed', $6, $7, $7)`,
        [id, companyId, num(numbered.rows[0].last_order_number), kind, kind === "purchase" ? ref : null, estimated, this.now()]);
      for (const [index, line] of lines.entries()) {
        await client.query(
          `INSERT INTO purchasing.order_lines (id, order_id, item_id, description, quantity, unit_price_cents, position)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [randomUUID(), id, line.itemId, line.name, line.quantity, line.unitCents, index + 1]);
      }
      created.push(id);
    }
    if (created.length) this.log("vps_reorder_proposed", { orders: created.length });
    return { created: await Promise.all(created.map((id) => this.order(client, companyId, id))), needsMax, needsSupplier };
  }

  private async setRule(client: QueryClient, companyId: string, actor: { contactId: number | null; portalUserId: string | null }, payload: Record<string, unknown>) {
    const item = (await client.query(ITEM_SQL, [companyId, String(payload.item).trim()])).rows[0];
    if (!item) throw new ReorderError("item_not_found", { item: payload.item });
    let supplierId: string | null | undefined;
    if (typeof payload.supplier === "string") supplierId = (await this.upsertSupplier(client, companyId, { name: payload.supplier })).id;
    await client.query(
      `INSERT INTO purchasing.item_rules (item_id, tenant_id, supply_type, max_qty, supplier_id)
       VALUES ($1, $2, COALESCE($3, 'purchase'), $4, $5)
       ON CONFLICT (item_id) DO UPDATE SET
         supply_type = COALESCE($3, purchasing.item_rules.supply_type),
         max_qty = CASE WHEN $6 THEN $4 ELSE purchasing.item_rules.max_qty END,
         supplier_id = CASE WHEN $7 THEN $5 ELSE purchasing.item_rules.supplier_id END,
         updated_at = CURRENT_TIMESTAMP`,
      [item.id, companyId, (payload.supplyType as SupplyType | undefined) ?? null, (payload.maxQty as number | null | undefined) ?? null,
        supplierId ?? null, payload.maxQty !== undefined, supplierId !== undefined]);
    await this.audit(client, companyId, actor, "set_rule", { item: String(item.name), maxQty: payload.maxQty, supplyType: payload.supplyType, supplier: payload.supplier });
    return { rule: await this.rule(client, String(item.id)) };
  }

  private async rule(db: Db, itemId: string) {
    const { rows } = await this.query(
      `SELECT item.name, item.on_hand, item.min_qty, rule.supply_type, rule.max_qty, supplier.name AS supplier, supplier.phone AS supplier_phone
         FROM stock.items AS item
         LEFT JOIN purchasing.item_rules AS rule ON rule.item_id = item.id
         LEFT JOIN purchasing.suppliers AS supplier ON supplier.id = rule.supplier_id
        WHERE item.id = $1`, [itemId], db);
    const row = rows[0];
    return {
      item: String(row.name),
      onHand: num(row.on_hand),
      minQty: nullableNum(row.min_qty),
      supplyType: (row.supply_type === "manufacture" ? "manufacture" : "purchase") as SupplyType,
      maxQty: nullableNum(row.max_qty),
      supplier: optional(row.supplier),
      supplierPhone: optional(row.supplier_phone),
    };
  }

  /** By RUC, then by name; fills what was missing and never erases a known phone or RUC. */
  private async upsertSupplier(db: Db, companyId: string, supplier: { name: string; phone?: string | null; ruc?: string | null }) {
    const name = supplier.name.trim().replace(/\s+/g, " ");
    const found = await this.query(
      `SELECT id, name FROM purchasing.suppliers
        WHERE tenant_id = $1 AND (($3::text IS NOT NULL AND ruc = $3) OR lower(name) = lower($2))
        ORDER BY (ruc = $3) DESC NULLS LAST LIMIT 1 FOR UPDATE`,
      [companyId, name, supplier.ruc ?? null], db);
    if (found.rows[0]) {
      await this.query(
        `UPDATE purchasing.suppliers SET phone = COALESCE($2, phone), ruc = COALESCE(ruc, $3), active = TRUE, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [found.rows[0].id, supplier.phone ?? null, supplier.ruc ?? null], db);
      return { id: String(found.rows[0].id), name: String(found.rows[0].name) };
    }
    const id = randomUUID();
    await this.query(
      "INSERT INTO purchasing.suppliers (id, tenant_id, name, ruc, phone) VALUES ($1, $2, $3, $4, $5)",
      [id, companyId, name, supplier.ruc ?? null, supplier.phone ?? null], db);
    return { id, name };
  }

  private async setSupplier(client: QueryClient, companyId: string, actor: { contactId: number | null; portalUserId: string | null }, payload: Record<string, unknown>) {
    const supplier = await this.upsertSupplier(client, companyId, {
      name: String(payload.name), phone: (payload.phone as string | undefined) ?? null, ruc: (payload.ruc as string | undefined) ?? null,
    });
    const linked: string[] = [];
    const notFound: string[] = [];
    for (const name of (payload.items as string[] | undefined) ?? []) {
      const item = (await client.query(ITEM_SQL, [companyId, name.trim()])).rows[0];
      if (!item) {
        notFound.push(name);
        continue;
      }
      await client.query(
        `INSERT INTO purchasing.item_rules (item_id, tenant_id, supplier_id) VALUES ($1, $2, $3)
         ON CONFLICT (item_id) DO UPDATE SET supplier_id = $3, updated_at = CURRENT_TIMESTAMP`,
        [item.id, companyId, supplier.id]);
      linked.push(String(item.name));
    }
    await this.audit(client, companyId, actor, "set_supplier", { supplierId: supplier.id, phone: payload.phone !== undefined, linked: linked.length });
    const { rows } = await client.query("SELECT name, phone, ruc FROM purchasing.suppliers WHERE id = $1", [supplier.id]);
    return { supplier: { name: String(rows[0].name), phone: optional(rows[0].phone), ruc: optional(rows[0].ruc) }, linked, notFound };
  }

  private async lockOrder(client: QueryClient, companyId: string, orderId: string) {
    const { rows } = await client.query("SELECT * FROM purchasing.orders WHERE id = $1 AND tenant_id = $2 FOR UPDATE", [orderId, companyId]);
    if (!rows[0]) throw new ReorderError("not_found");
    return rows[0];
  }

  /** What was approved this month in Lima: the supplier's confirmed total, or the estimate. */
  private async monthSpent(db: Db, companyId: string, exceptOrderId: string | null = null): Promise<number> {
    const { rows } = await this.query(
      `SELECT COALESCE(sum(COALESCE(confirmed_cents, estimated_cents, 0)), 0) AS spent FROM purchasing.orders
        WHERE tenant_id = $1 AND kind = 'purchase' AND approved_at >= $2 AND status NOT IN ('cancelled', 'declined')
          AND ($3::uuid IS NULL OR id <> $3)`,
      [companyId, limaMonthStart(this.now()), exceptOrderId], db);
    return num(rows[0]?.spent);
  }

  private async approve(client: QueryClient, companyId: string, companyName: string, actor: { contactId: number | null; portalUserId: string | null },
    orderId: string, force: boolean) {
    const order = await this.lockOrder(client, companyId, orderId);
    if (order.status !== "proposed") throw new ReorderError("not_proposed", { status: order.status });
    if (!order.approved_at) {
      if (order.kind === "purchase") {
        const { monthlyBudgetCents } = await this.settings(companyId, client);
        const spent = await this.monthSpent(client, companyId, orderId);
        const cents = num(order.estimated_cents);
        if (monthlyBudgetCents !== null && spent + cents > monthlyBudgetCents && !force) {
          throw new ReorderError("over_budget", { spentCents: spent, budgetCents: monthlyBudgetCents, orderCents: cents });
        }
      }
      await client.query(
        `UPDATE purchasing.orders SET approved_at = $2, approved_by_contact_id = $3, updated_at = $2,
                status = CASE WHEN kind = 'production' THEN 'in_production' ELSE status END
          WHERE id = $1`,
        [orderId, this.now(), actor.contactId]);
      await this.audit(client, companyId, actor, "approve", { orderId, force });
    }
    const summary = await this.order(client, companyId, orderId);
    if (summary.kind === "purchase" && !summary.supplier?.phone) throw new ReorderError("no_phone", { supplier: summary.supplier?.name });
    return { order: summary, companyName };
  }

  private async markSent(client: QueryClient, companyId: string, actor: { contactId: number | null; portalUserId: string | null }, orderId: string,
    sent: boolean, channelTenantId: string, phoneNumberId: string) {
    const order = await this.lockOrder(client, companyId, orderId);
    if (order.kind !== "purchase" || !order.approved_at) throw new ReorderError("not_approved");
    if (sent && order.status === "proposed") {
      await client.query(
        `UPDATE purchasing.orders SET status = 'sent', sent_at = $2, channel_tenant_id = $3, phone_number_id = $4, updated_at = $2 WHERE id = $1`,
        [orderId, this.now(), channelTenantId, phoneNumberId]);
    }
    await this.audit(client, companyId, actor, sent ? "sent" : "send_failed", { orderId });
    return { order: await this.order(client, companyId, orderId) };
  }

  private async changeLine(client: QueryClient, companyId: string, actor: { contactId: number | null; portalUserId: string | null },
    orderId: string, item: string, quantity: number) {
    const order = await this.lockOrder(client, companyId, orderId);
    if (order.status !== "proposed" || order.approved_at) throw new ReorderError("not_proposed", { status: order.status });
    const { rows } = await client.query(
      `SELECT id FROM purchasing.order_lines WHERE order_id = $1 AND lower(description) LIKE lower($2) ORDER BY position LIMIT 2`,
      [orderId, `%${item.trim().replace(/[%_\\]/g, (char) => `\\${char}`)}%`]);
    if (rows.length !== 1) throw new ReorderError("line_not_found", { item });
    if (quantity === 0) await client.query("DELETE FROM purchasing.order_lines WHERE id = $1", [rows[0].id]);
    else await client.query("UPDATE purchasing.order_lines SET quantity = $2 WHERE id = $1", [rows[0].id, qty(quantity)]);
    const left = await client.query(
      `SELECT count(*) AS lines, sum(round(quantity * unit_price_cents)) FILTER (WHERE unit_price_cents IS NOT NULL) AS estimated
         FROM purchasing.order_lines WHERE order_id = $1`, [orderId]);
    if (num(left.rows[0].lines) === 0) {
      await client.query("UPDATE purchasing.orders SET status = 'cancelled', closed_at = $2, updated_at = $2 WHERE id = $1", [orderId, this.now()]);
    } else {
      await client.query("UPDATE purchasing.orders SET estimated_cents = $2, updated_at = $3 WHERE id = $1",
        [orderId, left.rows[0].estimated === null ? null : num(left.rows[0].estimated), this.now()]);
    }
    await this.audit(client, companyId, actor, "change_line", { orderId, item, quantity });
    return { order: await this.order(client, companyId, orderId) };
  }

  private async orders(db: Db, companyId: string, where: string, values: readonly unknown[]): Promise<OrderSummary[]> {
    const { rows } = await this.query(
      `SELECT orders.*, supplier.name AS supplier_name, supplier.phone AS supplier_phone, supplier.ruc AS supplier_ruc
         FROM purchasing.orders AS orders
         LEFT JOIN purchasing.suppliers AS supplier ON supplier.id = orders.supplier_id
        WHERE orders.tenant_id = $1 AND ${where}
        ORDER BY orders.number DESC LIMIT 100`,
      [companyId, ...values], db);
    if (!rows.length) return [];
    const lines = await this.query(
      `SELECT order_id, description, quantity, received_qty, unit_price_cents FROM purchasing.order_lines
        WHERE order_id = ANY($1::uuid[]) ORDER BY position`,
      [rows.map((row) => row.id)], db);
    const byOrder = new Map<string, OrderLine[]>();
    for (const line of lines.rows) {
      const key = String(line.order_id);
      byOrder.set(key, [...(byOrder.get(key) ?? []), {
        item: String(line.description), quantity: num(line.quantity), receivedQty: num(line.received_qty), unitPriceCents: nullableNum(line.unit_price_cents),
      }]);
    }
    return rows.map((row) => ({
      id: String(row.id),
      number: num(row.number),
      kind: row.kind === "production" ? "production" : "purchase",
      status: String(row.status) as OrderStatus,
      supplier: row.supplier_name ? { name: String(row.supplier_name), phone: optional(row.supplier_phone), ruc: optional(row.supplier_ruc) } : null,
      lines: byOrder.get(String(row.id)) ?? [],
      estimatedCents: nullableNum(row.estimated_cents),
      confirmedCents: nullableNum(row.confirmed_cents),
      deliverBy: day(row.deliver_by),
      sentAt: row.sent_at ? new Date(row.sent_at as string).toISOString() : null,
      approved: Boolean(row.approved_at),
      escalated: Boolean(row.escalated_at),
      supplierNote: optional(row.supplier_note),
    }));
  }

  private async order(db: Db, companyId: string, orderId: string): Promise<OrderSummary> {
    const [order] = await this.orders(db, companyId, "orders.id = $2", [orderId]);
    if (!order) throw new ReorderError("not_found");
    return order;
  }

  /** Everything the chat and the portal show (ADR-0016, points 16 and 18). */
  async snapshot(companyId: string): Promise<ReorderSnapshot> {
    const [settings, proposals, open, notices, pending, monthSpentCents, suppliers, month] = await Promise.all([
      this.settings(companyId),
      this.orders(this.pool, companyId, "orders.status = 'proposed'", []),
      this.orders(this.pool, companyId, "orders.status = ANY($2::text[])", [RECEIVING_STATUSES]),
      this.query(
        `SELECT id, kind, body, created_at FROM purchasing.notices WHERE tenant_id = $1 AND delivered_at IS NULL
          ORDER BY created_at DESC LIMIT 20`, [companyId]),
      this.query(
        `SELECT item.name, rule.max_qty, rule.supply_type, supplier.id AS supplier_id, supplier.phone
           FROM stock.items AS item
           LEFT JOIN purchasing.item_rules AS rule ON rule.item_id = item.id
           LEFT JOIN purchasing.suppliers AS supplier ON supplier.id = rule.supplier_id AND supplier.active
          WHERE item.tenant_id = $1 AND item.active AND item.min_qty IS NOT NULL AND item.on_hand <= item.min_qty
          ORDER BY lower(item.name) LIMIT 100`, [companyId]),
      this.monthSpent(this.pool, companyId),
      this.query(
        `SELECT supplier.name, supplier.phone, supplier.ruc,
                COALESCE(array_agg(item.name ORDER BY item.name) FILTER (WHERE item.name IS NOT NULL), '{}') AS items
           FROM purchasing.suppliers AS supplier
           LEFT JOIN purchasing.item_rules AS rule ON rule.supplier_id = supplier.id
           LEFT JOIN stock.items AS item ON item.id = rule.item_id AND item.active
          WHERE supplier.tenant_id = $1 AND supplier.active
          GROUP BY supplier.id ORDER BY lower(supplier.name) LIMIT 100`, [companyId]),
      this.monthBySupplier(companyId),
    ]);
    return {
      settings,
      proposals,
      open,
      notices: notices.rows.map((row) => ({
        id: String(row.id), kind: String(row.kind) as Notice["kind"], body: String(row.body), createdAt: new Date(row.created_at as string).toISOString(),
      })),
      needsMax: pending.rows.filter((row) => row.max_qty === null || row.max_qty === undefined).map((row) => String(row.name)),
      needsSupplier: pending.rows.filter((row) => row.max_qty !== null && row.max_qty !== undefined && row.supply_type !== "manufacture"
        && (!row.supplier_id || !row.phone)).map((row) => String(row.name)),
      monthSpentCents,
      suppliers: suppliers.rows.map((row) => ({ name: String(row.name), phone: optional(row.phone), ruc: optional(row.ruc), items: (row.items as string[]) ?? [] })),
      month,
    };
  }

  private async monthBySupplier(companyId: string) {
    const { rows } = await this.query(
      `SELECT supplier.name, count(*) AS orders, COALESCE(sum(COALESCE(orders.confirmed_cents, orders.estimated_cents, 0)), 0) AS total
         FROM purchasing.orders AS orders JOIN purchasing.suppliers AS supplier ON supplier.id = orders.supplier_id
        WHERE orders.tenant_id = $1 AND orders.kind = 'purchase' AND orders.approved_at >= $2 AND orders.status NOT IN ('cancelled', 'declined')
        GROUP BY supplier.name ORDER BY total DESC LIMIT 20`,
      [companyId, limaMonthStart(this.now())]);
    return rows.map((row) => ({ supplier: String(row.name), orders: num(row.orders), totalCents: num(row.total) }));
  }

  private async answer(companyId: string, type: ReorderQueryType) {
    if (type === "pending") return { pending: await this.orders(this.pool, companyId, "orders.status = ANY($2::text[])", [RECEIVING_STATUSES]) };
    const month = await this.monthBySupplier(companyId);
    const { monthlyBudgetCents } = await this.settings(companyId);
    return { month, totalCents: month.reduce((sum, row) => sum + row.totalCents, 0), budgetCents: monthlyBudgetCents };
  }

  private async orderPdf(companyId: string, orderId: string) {
    if (!this.renderer) throw new ReorderError("unavailable");
    const order = await this.order(this.pool, companyId, orderId);
    if (order.kind !== "purchase" || !order.supplier) throw new ReorderError("not_found");
    const { rows } = await this.query("SELECT name, legal_name, ruc, address FROM whatsapp.tenants WHERE id = $1", [companyId]);
    const company = rows[0];
    const bytes = await this.renderer.render({
      company: { name: String(company.name), legal_name: optional(company.legal_name), ruc: optional(company.ruc), address: optional(company.address) },
      number: order.number,
      issue_date: new Date(this.now().getTime() - LIMA_OFFSET_MS).toISOString().slice(0, 10),
      deliver_by: order.deliverBy,
      supplier: { name: order.supplier.name, ruc: order.supplier.ruc },
      lines: order.lines.map((line) => ({ description: line.item, quantity: line.quantity, unit_price_cents: line.unitPriceCents })),
      notes: null,
    });
    return { pdf: { filename: `Orden-de-compra-${String(order.number).padStart(6, "0")}.pdf`, contentBase64: Buffer.from(bytes).toString("base64") } };
  }

  private async noticesDelivered(companyId: string, ids: string[]) {
    const { rows } = await this.query(
      "UPDATE purchasing.notices SET delivered_at = $3 WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND delivered_at IS NULL RETURNING id",
      [companyId, ids, this.now()]);
    return { delivered: rows.length };
  }

  /** Orders waiting on this WhatsApp, newest first, across companies (ADR-0016, consequences). */
  private async supplierMatch(phone: string) {
    const { rows } = await this.query(
      `SELECT orders.id, orders.tenant_id, orders.number, orders.status, orders.pdf_sent_to_supplier, orders.replied_at,
              supplier.name AS supplier_name, tenant.name AS company_name
         FROM purchasing.orders AS orders
         JOIN purchasing.suppliers AS supplier ON supplier.id = orders.supplier_id AND supplier.phone = $1
         JOIN purchasing.settings AS settings ON settings.tenant_id = orders.tenant_id AND settings.enabled
              AND (settings.active_until IS NULL OR settings.active_until > CURRENT_TIMESTAMP)
         JOIN whatsapp.tenants AS tenant ON tenant.id = orders.tenant_id AND tenant.status = 'active'
        WHERE orders.status IN ('sent', 'confirmed', 'partial') AND orders.sent_at > $2
        ORDER BY orders.sent_at DESC LIMIT 3`,
      [phone, new Date(this.now().getTime() - 30 * 24 * HOUR_MS)]);
    const matches = [];
    for (const row of rows) {
      const order = await this.order(this.pool, String(row.tenant_id), String(row.id));
      matches.push({
        companyId: String(row.tenant_id), companyName: String(row.company_name), supplierName: String(row.supplier_name),
        order, pdfSent: Boolean(row.pdf_sent_to_supplier), replied: Boolean(row.replied_at),
      });
    }
    return matches;
  }

  private async notice(db: Db, companyId: string, orderId: string | null, kind: Notice["kind"], body: string) {
    const id = randomUUID();
    await this.query("INSERT INTO purchasing.notices (id, tenant_id, order_id, kind, body, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [id, companyId, orderId, kind, body.slice(0, 1500), this.now()], db);
    return { id, body: body.slice(0, 1500) };
  }

  /**
   * The supplier answered (ADR-0016, points 9 and 21): accepted confirms the order with its
   * date and prices; declined closes it and goes to the owner; anything else is passed on.
   * Answering stops the follow-ups. The PDF goes to the supplier the first time they write.
   */
  private async supplierReply(client: QueryClient, companyId: string, orderId: string, phone: string, reply: SupplierReply) {
    const order = await this.lockOrder(client, companyId, orderId);
    const supplier = await client.query("SELECT name, phone FROM purchasing.suppliers WHERE id = $1", [order.supplier_id]);
    if (!supplier.rows[0] || supplier.rows[0].phone !== phone) throw new ReorderError("forbidden");
    if (!["sent", "confirmed", "partial"].includes(String(order.status))) throw new ReorderError("not_open", { status: order.status });
    const supplierName = String(supplier.rows[0].name);
    const now = this.now();
    for (const price of reply.unitPrices ?? []) {
      const line = await client.query(
        `UPDATE purchasing.order_lines SET unit_price_cents = $3
          WHERE id = (SELECT id FROM purchasing.order_lines WHERE order_id = $1 AND lower(description) LIKE lower($2) ORDER BY position LIMIT 1)
          RETURNING item_id`,
        [orderId, `%${price.item.trim().replace(/[%_\\]/g, (char) => `\\${char}`)}%`, price.unitPriceCents]);
      if (line.rows[0]) {
        await client.query("UPDATE purchasing.item_rules SET last_unit_cost_cents = $2, updated_at = CURRENT_TIMESTAMP WHERE item_id = $1",
          [line.rows[0].item_id, price.unitPriceCents]);
      }
    }
    const declined = reply.outcome === "declined";
    const confirmed = reply.outcome === "accepted";
    await client.query(
      `UPDATE purchasing.orders SET
         replied_at = COALESCE(replied_at, $2), updated_at = $2,
         supplier_note = COALESCE($3, supplier_note),
         deliver_by = COALESCE($4::date, deliver_by),
         confirmed_cents = COALESCE($5, confirmed_cents),
         status = CASE WHEN $6 THEN 'declined' WHEN $7 AND status = 'sent' THEN 'confirmed' ELSE status END,
         closed_at = CASE WHEN $6 THEN $2 ELSE closed_at END,
         escalated_at = CASE WHEN $6 THEN COALESCE(escalated_at, $2) ELSE escalated_at END,
         pdf_sent_to_supplier = TRUE
       WHERE id = $1`,
      [orderId, now, reply.note ?? null, reply.deliverBy ?? null, reply.totalCents ?? null, declined, confirmed]);
    const code = orderCode(num(order.number));
    const said = reply.note ? ` Dice: «${reply.note}».` : "";
    const body = confirmed
      ? `${supplierName} confirmó el pedido ${code}${reply.deliverBy ? `, con entrega el ${shortDate(reply.deliverBy)}` : ""}`
        + `${reply.totalCents ? `, por ${soles(reply.totalCents)}` : ""}.${said}`
      : declined
      ? `${supplierName} no puede atender el pedido ${code}.${said} Conviene que le escribas tú o elijas otro proveedor.`
      : `${supplierName} respondió sobre el pedido ${code}:${reply.note ? ` «${reply.note}».` : " revisa su mensaje."}`;
    const notice = await this.notice(client, companyId, orderId, confirmed ? "supplier_reply" : declined ? "declined" : "supplier_reply", body);
    await this.audit(client, companyId, { contactId: null, portalUserId: null }, "supplier_reply", { orderId, outcome: reply.outcome });
    const company = await client.query("SELECT name FROM whatsapp.tenants WHERE id = $1", [companyId]);
    return {
      order: await this.order(client, companyId, orderId),
      companyName: String(company.rows[0]?.name ?? ""),
      notice,
      ownerPhones: await this.ownerPhones(companyId, client),
      sendPdf: !order.pdf_sent_to_supplier,
      phoneNumberId: optional(order.phone_number_id),
    };
  }

  /**
   * The cron's work (ADR-0016, point 10): orders without an answer get one reminder after
   * `followup_hours` and go to the owner after `escalate_hours`. Each is claimed in the same
   * statement that marks it, so a retried cron never repeats one. Only 8:00–20:00 of Lima.
   */
  private async followups() {
    const now = this.now();
    const hour = limaHour(now);
    if (hour < SUPPLIER_HOURS.start || hour >= SUPPLIER_HOURS.end) return { reminders: [], escalations: [] };
    const escalated = await this.query(
      `UPDATE purchasing.orders AS orders SET escalated_at = $1::timestamptz, updated_at = $1::timestamptz
         FROM purchasing.settings AS settings
        WHERE settings.tenant_id = orders.tenant_id AND settings.enabled
          AND (settings.active_until IS NULL OR settings.active_until > CURRENT_TIMESTAMP)
          AND orders.status = 'sent' AND orders.replied_at IS NULL AND orders.escalated_at IS NULL
          AND orders.sent_at <= $1::timestamptz - make_interval(hours => settings.escalate_hours)
        RETURNING orders.id, orders.tenant_id, orders.number, orders.supplier_id, orders.phone_number_id`,
      [now]);
    const escalations = [];
    for (const row of escalated.rows) {
      const supplier = await this.query("SELECT name, phone FROM purchasing.suppliers WHERE id = $1", [row.supplier_id]);
      const companyId = String(row.tenant_id);
      const notice = await this.notice(this.pool, companyId, String(row.id), "escalated",
        `${String(supplier.rows[0]?.name ?? "El proveedor")} no respondió el pedido ${orderCode(num(row.number))}, ni después de recordárselo. `
        + `Conviene que lo llames tú${supplier.rows[0]?.phone ? ` (+${String(supplier.rows[0].phone)})` : ""} o elijas otro proveedor.`);
      const company = await this.query("SELECT name FROM whatsapp.tenants WHERE id = $1", [companyId]);
      escalations.push({ companyId, companyName: String(company.rows[0]?.name ?? ""), orderId: String(row.id), notice,
        ownerPhones: await this.ownerPhones(companyId), phoneNumberId: optional(row.phone_number_id) });
    }
    const reminded = await this.query(
      `UPDATE purchasing.orders AS orders SET reminders_sent = orders.reminders_sent + 1, last_reminder_at = $1::timestamptz, updated_at = $1::timestamptz
         FROM purchasing.settings AS settings
        WHERE settings.tenant_id = orders.tenant_id AND settings.enabled
          AND (settings.active_until IS NULL OR settings.active_until > CURRENT_TIMESTAMP)
          AND orders.status = 'sent' AND orders.replied_at IS NULL AND orders.escalated_at IS NULL AND orders.reminders_sent = 0
          AND orders.sent_at <= $1::timestamptz - make_interval(hours => settings.followup_hours)
        RETURNING orders.id, orders.tenant_id, orders.phone_number_id`,
      [now]);
    const reminders = [];
    for (const row of reminded.rows) {
      const companyId = String(row.tenant_id);
      const company = await this.query("SELECT name FROM whatsapp.tenants WHERE id = $1", [companyId]);
      reminders.push({ companyId, companyName: String(company.rows[0]?.name ?? ""), order: await this.order(this.pool, companyId, String(row.id)),
        phoneNumberId: optional(row.phone_number_id) });
    }
    if (escalations.length || reminders.length) this.log("vps_reorder_followups", { reminders: reminders.length, escalations: escalations.length });
    return { reminders, escalations };
  }

  /**
   * Stock Cat's entries close orders (ADR-0016, points 3, 12 and 14), inside Stock Cat's own
   * transaction: what arrived is applied to the oldest open order of each item; a purchase
   * becomes partial or received, a production order done. The supplier on the invoice photo
   * is remembered for items that had none, with its unit cost.
   */
  async receive(db: Db, companyId: string, entries: ReceivedEntry[], supplier: { name: string; ruc?: string | null } | null): Promise<Reception[]> {
    if (!entries.length || !await this.enabled(companyId, db)) return [];
    if (supplier) {
      const saved = await this.upsertSupplier(db, companyId, supplier);
      for (const entry of entries) {
        await this.query(
          `INSERT INTO purchasing.item_rules (item_id, tenant_id, supplier_id, last_unit_cost_cents) VALUES ($1, $2, $3, $4)
           ON CONFLICT (item_id) DO UPDATE SET
             supplier_id = COALESCE(purchasing.item_rules.supplier_id, $3),
             last_unit_cost_cents = CASE WHEN purchasing.item_rules.supplier_id IS NULL OR purchasing.item_rules.supplier_id = $3
                                         THEN COALESCE($4, purchasing.item_rules.last_unit_cost_cents)
                                         ELSE purchasing.item_rules.last_unit_cost_cents END,
             updated_at = CURRENT_TIMESTAMP`,
          [entry.itemId, companyId, saved.id, entry.unitCostCents === null ? null : Math.round(entry.unitCostCents)], db);
      }
    }
    const touched = new Set<string>();
    for (const entry of entries) {
      let left = entry.quantity;
      const { rows } = await this.query(
        `SELECT line.id, line.order_id, line.quantity, line.received_qty FROM purchasing.order_lines AS line
           JOIN purchasing.orders AS orders ON orders.id = line.order_id
          WHERE orders.tenant_id = $1 AND line.item_id = $2 AND orders.status = ANY($3::text[]) AND line.received_qty < line.quantity
          ORDER BY orders.created_at, line.position FOR UPDATE OF line`,
        [companyId, entry.itemId, RECEIVING_STATUSES], db);
      for (const line of rows) {
        if (left <= 0) break;
        const take = Math.min(left, num(line.quantity) - num(line.received_qty));
        await this.query("UPDATE purchasing.order_lines SET received_qty = received_qty + $2 WHERE id = $1", [line.id, qty(take)], db);
        left = qty(left - take);
        touched.add(String(line.order_id));
      }
    }
    const receptions: Reception[] = [];
    for (const orderId of touched) {
      const order = await this.order(db, companyId, orderId);
      const missing = order.lines.filter((line) => line.receivedQty < line.quantity).map((line) => ({ item: line.item, quantity: qty(line.quantity - line.receivedQty) }));
      const complete = missing.length === 0;
      const status = complete ? (order.kind === "production" ? "done" : "received") : (order.kind === "production" ? "in_production" : "partial");
      await this.query(
        `UPDATE purchasing.orders SET status = $2, closed_at = CASE WHEN $3 THEN $4 ELSE closed_at END, updated_at = $4 WHERE id = $1`,
        [orderId, status, complete, this.now()], db);
      receptions.push({ number: order.number, kind: order.kind, supplier: order.supplier?.name ?? null, complete, missing });
    }
    return receptions;
  }

  /** The weekly line in the portal's Inicio. */
  async weekly(companyId: string): Promise<{ toApprove: number; waiting: number; escalated: number; monthSpentCents: number } | null> {
    if (!await this.enabled(companyId)) return null;
    const { rows } = await this.query(
      `SELECT count(*) FILTER (WHERE status = 'proposed') AS to_approve,
              count(*) FILTER (WHERE status = ANY($2::text[])) AS waiting,
              count(*) FILTER (WHERE escalated_at > $3) AS escalated
         FROM purchasing.orders WHERE tenant_id = $1`,
      [companyId, RECEIVING_STATUSES, new Date(this.now().getTime() - 7 * 24 * HOUR_MS)]);
    return {
      toApprove: num(rows[0]?.to_approve), waiting: num(rows[0]?.waiting), escalated: num(rows[0]?.escalated),
      monthSpentCents: await this.monthSpent(this.pool, companyId),
    };
  }

  private async audit(db: Db, companyId: string, actor: { contactId: number | null; portalUserId: string | null }, action: string, details: Record<string, unknown>) {
    await this.query(
      "INSERT INTO purchasing.audit_log (tenant_id, contact_id, portal_user_id, action, details) VALUES ($1, $2, $3, $4, $5)",
      [companyId, actor.contactId, actor.portalUserId, action, JSON.stringify(details)], db);
  }

  async transaction<T>(work: (client: QueryClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect() as QueryClient;
    let destroy = false;
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      destroy = !(error instanceof ReorderError);
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release(destroy);
    }
  }
}

export { ReorderError };
