import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  SalesBridgeRequest,
  SalesBridgeResponse,
  SalesCustomerInput,
  SalesLineInput,
  SummaryPeriod,
} from "../../sales/bridge-contracts";
import type { BridgeRequestIdentity, BridgeRequestStore } from "../bridge/request-store";
import type { RoleLog } from "../../roles/contracts";
import { loadBrandKit } from "../portal/brand-service";

type Rows = { rows: Array<Record<string, unknown>> };
type QueryClient = { query(sql: string, values?: readonly unknown[]): Promise<Rows>; release(destroy?: boolean): void };
export type SalesPool = { connect(): Promise<unknown>; query(sql: string, values?: readonly unknown[]): Promise<unknown> };

export type SalesServiceResult =
  | { status: "completed"; response: SalesBridgeResponse }
  | { status: "conflict" | "in_progress" };

const WRITES = new Set(["upsert_product", "create_quote", "create_sale", "cancel_sale", "link_invoice"]);
const LIMA_OFFSET_MS = 5 * 3_600_000;
const DAY_MS = 86_400_000;

class SalesError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** Lima calendar boundaries as UTC instants. */
export function periodRange(period: SummaryPeriod, now: Date): { from: Date; to: Date } {
  const lima = new Date(now.getTime() - LIMA_OFFSET_MS);
  const y = lima.getUTCFullYear();
  const m = lima.getUTCMonth();
  const today = Date.UTC(y, m, lima.getUTCDate()) + LIMA_OFFSET_MS;
  switch (period) {
    case "today":
      return { from: new Date(today), to: new Date(today + DAY_MS) };
    case "yesterday":
      return { from: new Date(today - DAY_MS), to: new Date(today) };
    case "week": {
      const sinceMonday = (lima.getUTCDay() + 6) % 7;
      const monday = today - sinceMonday * DAY_MS;
      return { from: new Date(monday), to: new Date(monday + 7 * DAY_MS) };
    }
    case "month":
      return { from: new Date(Date.UTC(y, m, 1) + LIMA_OFFSET_MS), to: new Date(Date.UTC(y, m + 1, 1) + LIMA_OFFSET_MS) };
    case "last_month":
      return { from: new Date(Date.UTC(y, m - 1, 1) + LIMA_OFFSET_MS), to: new Date(Date.UTC(y, m, 1) + LIMA_OFFSET_MS) };
  }
}

const limaDate = (instant: Date) => new Date(instant.getTime() - LIMA_OFFSET_MS).toISOString().slice(0, 10);
const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

/**
 * Sales Cat's data (ADR-0011): customers and products in `commerce`, quotes and sales in
 * `sales`. A contact may act for a company only when it is an active member of it and the
 * company has Sales Cat enabled. Writes are idempotent per request id.
 */
export class SalesService {
  constructor(
    private readonly pool: SalesPool,
    private readonly requestStore: BridgeRequestStore,
    private readonly log: RoleLog,
    private readonly now: () => Date = () => new Date(),
    private readonly newToken: () => string = () => randomBytes(16).toString("base64url"),
  ) {}

  async process(request: SalesBridgeRequest, requestId: string, requestHash: string): Promise<SalesServiceResult> {
    if (!WRITES.has(request.operation)) {
      return { status: "completed", response: await this.safely(request, requestId) };
    }
    const identity: BridgeRequestIdentity = {
      requestId,
      tenantId: request.company_id ?? request.channel_tenant_id,
      roleKey: `sales:${request.operation}`,
      requestHash,
    };
    const claim = await this.requestStore.claim(identity);
    if (claim.status === "conflict" || claim.status === "in_progress") return { status: claim.status };
    if (claim.status === "completed") {
      try {
        return { status: "completed", response: { ...(JSON.parse(claim.replyText) as SalesBridgeResponse), replayed: true } };
      } catch {
        await this.requestStore.fail(identity, "stored_response_invalid");
        return { status: "in_progress" };
      }
    }
    const response = await this.safely(request, requestId);
    if (response.ok || response.error?.code !== "internal_error") {
      await this.requestStore.complete(identity, JSON.stringify(response));
    } else {
      await this.requestStore.fail(identity, "sales_internal_error");
    }
    return { status: "completed", response };
  }

  private async safely(request: SalesBridgeRequest, requestId: string): Promise<SalesBridgeResponse> {
    try {
      return { request_id: requestId, ok: true, data: await this.execute(request) };
    } catch (error) {
      if (error instanceof SalesError) return { request_id: requestId, ok: false, error: { code: error.code } };
      this.log("vps_sales_operation_failed", { operation: request.operation, reason: error instanceof Error ? error.name : "unknown" });
      return { request_id: requestId, ok: false, error: { code: "internal_error" } };
    }
  }

  private async query(sql: string, values: readonly unknown[]): Promise<Rows> {
    return await this.pool.query(sql, values) as Rows;
  }

  /** The contact must belong to the channel it writes from. */
  private async assertContact(request: SalesBridgeRequest) {
    const { rows } = await this.query(
      "SELECT 1 FROM whatsapp.contacts WHERE id = $1 AND tenant_id = $2",
      [request.contact_id, request.channel_tenant_id],
    );
    if (!rows.length) throw new SalesError("forbidden");
  }

  private async companies(contactId: number): Promise<Array<{ id: string; name: string }>> {
    const { rows } = await this.query(
      `SELECT tenant.id, tenant.name
         FROM whatsapp.tenant_members AS member
         JOIN whatsapp.tenants AS tenant ON tenant.id = member.tenant_id AND tenant.status = 'active'
         JOIN sales.settings AS settings ON settings.tenant_id = tenant.id AND settings.enabled
        WHERE member.contact_id = $1 AND member.status = 'active'
        ORDER BY tenant.name`,
      [contactId],
    );
    return rows.map((row) => ({ id: String(row.id), name: String(row.name) }));
  }

  private async execute(request: SalesBridgeRequest): Promise<unknown> {
    await this.assertContact(request);
    const companies = await this.companies(request.contact_id);
    if (request.operation === "companies") return { companies };
    const companyId = request.company_id!;
    if (!companies.some((company) => company.id === companyId)) throw new SalesError("forbidden");
    const payload = request.payload ?? {};
    const contactId = request.contact_id;

    switch (request.operation) {
      case "catalog": {
        const { rows } = await this.query(
          `SELECT name, unit_price_cents FROM commerce.products
            WHERE tenant_id = $1 AND active ORDER BY updated_at DESC LIMIT 80`,
          [companyId],
        );
        return { products: rows.map((row) => ({ name: String(row.name), unitPriceCents: Number(row.unit_price_cents) })) };
      }
      case "upsert_product": {
        const { rows } = await this.query(
          `INSERT INTO commerce.products (id, tenant_id, name, unit_price_cents, created_by_contact_id)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (tenant_id, lower(name))
           DO UPDATE SET unit_price_cents = EXCLUDED.unit_price_cents, active = TRUE, updated_at = CURRENT_TIMESTAMP
           RETURNING id, name, unit_price_cents, (xmax = 0) AS inserted`,
          [randomUUID(), companyId, String(payload.name).trim(), payload.unitPriceCents, contactId],
        );
        const row = rows[0];
        await this.audit(this.pool, companyId, "product", String(row.id), row.inserted ? "created" : "updated", contactId,
          { unitPriceCents: Number(row.unit_price_cents) });
        return { product: { name: String(row.name), unitPriceCents: Number(row.unit_price_cents), created: Boolean(row.inserted) } };
      }
      case "create_quote":
      case "create_sale":
        return this.transaction<unknown>((client) => request.operation === "create_quote"
          ? this.createQuote(client, companyId, contactId, payload)
          : this.createSale(client, companyId, contactId, payload));
      case "cancel_sale": {
        const { rows } = await this.query(
          `UPDATE sales.sales SET status = 'cancelled', cancelled_at = $3, balance_cents = 0, updated_at = $3
            WHERE tenant_id = $1 AND number = $2 AND status = 'confirmed'
            RETURNING id, total_cents`,
          [companyId, payload.number, this.now()],
        );
        if (!rows.length) throw new SalesError("not_found");
        await this.audit(this.pool, companyId, "sale", String(rows[0].id), "cancelled", contactId,
          { reason: payload.reason ?? null, totalCents: Number(rows[0].total_cents) });
        return { cancelled: { number: payload.number } };
      }
      case "link_invoice": {
        const { rows } = await this.query(
          `UPDATE sales.sales SET invoice_number = $3, updated_at = $4
            WHERE tenant_id = $1 AND number = $2 AND status = 'confirmed' RETURNING id`,
          [companyId, payload.number, String(payload.invoiceNumber), this.now()],
        );
        if (!rows.length) throw new SalesError("not_found");
        await this.audit(this.pool, companyId, "sale", String(rows[0].id), "invoiced", contactId, { invoiceNumber: payload.invoiceNumber });
        return { linked: true };
      }
      case "summary":
        return this.summary(companyId, payload.period as SummaryPeriod);
    }
  }

  private async customer(client: QueryClient, companyId: string, contactId: number, input: SalesCustomerInput) {
    if (!input) return { id: null as string | null, name: "Cliente varios" };
    const name = input.name.trim().slice(0, 200);
    const sql = input.docNumber
      ? `INSERT INTO commerce.customers (id, tenant_id, doc_type, doc_number, name, created_by_contact_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tenant_id, doc_type, doc_number) WHERE doc_number IS NOT NULL
         DO UPDATE SET name = EXCLUDED.name, updated_at = CURRENT_TIMESTAMP RETURNING id`
      : `INSERT INTO commerce.customers (id, tenant_id, doc_type, doc_number, name, created_by_contact_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tenant_id, lower(name)) WHERE doc_number IS NULL
         DO UPDATE SET updated_at = CURRENT_TIMESTAMP RETURNING id`;
    const { rows } = await client.query(sql, [randomUUID(), companyId, input.docNumber ? input.docType : "0", input.docNumber, name, contactId]);
    return { id: String(rows[0].id), name };
  }

  /** Lines resolve to products by name; unknown products are created on the fly (ADR-0011, point 6). */
  private async lines(client: QueryClient, companyId: string, contactId: number, lines: SalesLineInput[]) {
    const resolved = [];
    for (const line of lines) {
      const description = line.description.trim().slice(0, 300);
      await client.query(
        `INSERT INTO commerce.products (id, tenant_id, name, unit_price_cents, created_by_contact_id)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (tenant_id, lower(name)) DO NOTHING`,
        [randomUUID(), companyId, description.slice(0, 200), line.unitPriceCents, contactId],
      );
      const product = await client.query(
        "SELECT id FROM commerce.products WHERE tenant_id = $1 AND lower(name) = lower($2)",
        [companyId, description.slice(0, 200)],
      );
      resolved.push({
        description,
        productId: product.rows[0] ? String(product.rows[0].id) : null,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        lineTotalCents: Math.round(line.quantity * line.unitPriceCents),
      });
    }
    return resolved;
  }

  private async nextNumber(client: QueryClient, companyId: string, kind: "quote" | "sale"): Promise<number> {
    const { rows } = await client.query(
      `INSERT INTO sales.sequences (tenant_id, kind, next_number) VALUES ($1, $2, 2)
       ON CONFLICT (tenant_id, kind) DO UPDATE SET next_number = sales.sequences.next_number + 1
       RETURNING next_number - 1 AS number`,
      [companyId, kind],
    );
    return Number(rows[0].number);
  }

  private totals(lines: Array<{ lineTotalCents: number }>, discountCents: unknown) {
    const subtotal = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
    const discount = Math.min(subtotal, Number(discountCents ?? 0));
    return { subtotal, discount, total: subtotal - discount };
  }

  private async insertLines(client: QueryClient, owner: "quote_id" | "sale_id", ownerId: string, lines: Awaited<ReturnType<SalesService["lines"]>>) {
    for (const [index, line] of lines.entries()) {
      await client.query(
        `INSERT INTO sales.lines (id, ${owner}, position, product_id, description, quantity, unit_price_cents, line_total_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [randomUUID(), ownerId, index + 1, line.productId, line.description, line.quantity, line.unitPriceCents, line.lineTotalCents],
      );
    }
  }

  private async createQuote(client: QueryClient, companyId: string, contactId: number, payload: Record<string, unknown>) {
    const customer = await this.customer(client, companyId, contactId, payload.customer as SalesCustomerInput);
    const lines = await this.lines(client, companyId, contactId, payload.lines as SalesLineInput[]);
    const totals = this.totals(lines, payload.discountCents);
    const number = await this.nextNumber(client, companyId, "quote");
    // The brand kit (ADR-0012) wins over Sales Cat's own default, and its terms are copied in.
    const settings = await client.query(
      `SELECT COALESCE(kit.quote_valid_days, settings.quote_valid_days) AS quote_valid_days,
              kit.quote_payment_terms, kit.quote_delivery_terms
         FROM (SELECT $1::text AS tenant_id) AS wanted
         LEFT JOIN sales.settings AS settings ON settings.tenant_id = wanted.tenant_id
         LEFT JOIN commerce.brand_kits AS kit ON kit.tenant_id = wanted.tenant_id`,
      [companyId],
    );
    const validDays = Number(settings.rows[0]?.quote_valid_days ?? 7);
    const validUntil = limaDate(new Date(this.now().getTime() + validDays * DAY_MS));
    const token = this.newToken();
    const id = randomUUID();
    await client.query(
      `INSERT INTO sales.quotes (id, tenant_id, number, customer_id, customer_name, subtotal_cents, discount_cents, total_cents,
         notes, valid_until, public_token_hash, created_by_contact_id, created_at, updated_at, payment_terms, delivery_terms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13, $14, $15)`,
      [id, companyId, number, customer.id, customer.name, totals.subtotal, totals.discount, totals.total,
        (payload.notes as string | undefined)?.trim() || null, validUntil, hashToken(token), contactId, this.now(),
        settings.rows[0]?.quote_payment_terms ?? null, settings.rows[0]?.quote_delivery_terms ?? null],
    );
    await this.insertLines(client, "quote_id", id, lines);
    await this.audit(client, companyId, "quote", id, "created", contactId, { number, totalCents: totals.total });
    this.log("vps_sales_quote_created");
    return { quote: { id, number, totalCents: totals.total, validUntil, publicToken: token } };
  }

  private async createSale(client: QueryClient, companyId: string, contactId: number, payload: Record<string, unknown>) {
    const customer = await this.customer(client, companyId, contactId, payload.customer as SalesCustomerInput);
    const lines = await this.lines(client, companyId, contactId, payload.lines as SalesLineInput[]);
    const totals = this.totals(lines, payload.discountCents);
    const number = await this.nextNumber(client, companyId, "sale");
    const credit = payload.paymentMethod === "credito";
    const soldAt = this.now();
    const id = randomUUID();
    await client.query(
      `INSERT INTO sales.sales (id, tenant_id, number, customer_id, customer_name, payment_method, subtotal_cents, discount_cents,
         total_cents, balance_cents, notes, sold_at, seller_contact_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $12, $12)`,
      [id, companyId, number, customer.id, customer.name, payload.paymentMethod, totals.subtotal, totals.discount, totals.total,
        credit ? totals.total : 0, (payload.notes as string | undefined)?.trim() || null, soldAt, contactId],
    );
    await this.insertLines(client, "sale_id", id, lines);
    await this.audit(client, companyId, "sale", id, "created", contactId, { number, totalCents: totals.total });
    this.log("vps_sales_sale_created");
    return { sale: { id, number, totalCents: totals.total, balanceCents: credit ? totals.total : 0, soldAt: soldAt.toISOString() } };
  }

  private async summary(companyId: string, period: SummaryPeriod) {
    const { from, to } = periodRange(period, this.now());
    const values = [companyId, from, to];
    const [salesRow, quotesRow, products, customers] = await Promise.all([
      this.query(
        `SELECT count(*)::int AS n, COALESCE(sum(total_cents), 0)::bigint AS total, COALESCE(sum(balance_cents), 0)::bigint AS credit
           FROM sales.sales WHERE tenant_id = $1 AND status = 'confirmed' AND sold_at >= $2 AND sold_at < $3`, values),
      this.query(
        `SELECT count(*)::int AS n, COALESCE(sum(total_cents), 0)::bigint AS total
           FROM sales.quotes WHERE tenant_id = $1 AND status <> 'cancelled' AND created_at >= $2 AND created_at < $3`, values),
      this.query(
        `SELECT line.description, sum(line.quantity)::float AS quantity, sum(line.line_total_cents)::bigint AS total
           FROM sales.lines AS line JOIN sales.sales AS sale ON sale.id = line.sale_id
          WHERE sale.tenant_id = $1 AND sale.status = 'confirmed' AND sale.sold_at >= $2 AND sale.sold_at < $3
          GROUP BY line.description ORDER BY total DESC LIMIT 3`, values),
      this.query(
        `SELECT customer_name AS name, count(*)::int AS n, sum(total_cents)::bigint AS total
           FROM sales.sales
          WHERE tenant_id = $1 AND status = 'confirmed' AND sold_at >= $2 AND sold_at < $3 AND customer_id IS NOT NULL
          GROUP BY customer_name ORDER BY total DESC LIMIT 3`, values),
    ]);
    return {
      summary: {
        period,
        from: limaDate(from),
        to: limaDate(new Date(to.getTime() - 1)),
        salesCount: Number(salesRow.rows[0]?.n ?? 0),
        totalCents: Number(salesRow.rows[0]?.total ?? 0),
        creditCents: Number(salesRow.rows[0]?.credit ?? 0),
        quotesCount: Number(quotesRow.rows[0]?.n ?? 0),
        quotedCents: Number(quotesRow.rows[0]?.total ?? 0),
        topProducts: products.rows.map((row) => ({ description: String(row.description), quantity: Number(row.quantity), totalCents: Number(row.total) })),
        topCustomers: customers.rows.map((row) => ({ name: String(row.name), salesCount: Number(row.n), totalCents: Number(row.total) })),
      },
    };
  }

  private async audit(db: { query(sql: string, values?: readonly unknown[]): Promise<unknown> }, companyId: string, entity: string,
    entityId: string, action: string, contactId: number, details: Record<string, unknown>) {
    await db.query(
      `INSERT INTO sales.audit_log (tenant_id, entity, entity_id, action, contact_id, details) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [companyId, entity, entityId, action, contactId, JSON.stringify(details)],
    );
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
      destroy = !(error instanceof SalesError);
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release(destroy);
    }
  }
}

/** Public quote view for the portal (`/cotizacion/<code>`): only the hash is stored. */
export class PublicQuoteService {
  constructor(private readonly pool: SalesPool) {}

  /** The issuing company's logo, reachable only through a valid quote link. */
  async logo(token: string) {
    if (!/^[A-Za-z0-9_-]{22}$/.test(token)) return null;
    const { rows } = await this.pool.query(
      `SELECT logo.mime_type, logo.content, logo.sha256
         FROM sales.quotes AS quote JOIN commerce.brand_logos AS logo ON logo.tenant_id = quote.tenant_id
        WHERE quote.public_token_hash = $1 AND quote.status <> 'cancelled'`,
      [hashToken(token)],
    ) as Rows;
    const logo = rows[0];
    if (!logo) return null;
    return { mimeType: String(logo.mime_type), contentBase64: Buffer.from(logo.content as Uint8Array).toString("base64"),
      version: String(logo.sha256).slice(0, 16) };
  }

  async view(token: string) {
    if (!/^[A-Za-z0-9_-]{22}$/.test(token)) return null;
    const { rows } = await this.pool.query(
      `SELECT quote.*, tenant.name AS company_name, tenant.legal_name, tenant.ruc, tenant.address
         FROM sales.quotes AS quote JOIN whatsapp.tenants AS tenant ON tenant.id = quote.tenant_id
        WHERE quote.public_token_hash = $1 AND quote.status <> 'cancelled'`,
      [hashToken(token)],
    ) as Rows;
    const quote = rows[0];
    if (!quote) return null;
    const lines = await this.pool.query(
      `SELECT description, quantity::float AS quantity, unit_price_cents, line_total_cents
         FROM sales.lines WHERE quote_id = $1 ORDER BY position`,
      [quote.id],
    ) as Rows;
    return {
      company: { name: String(quote.company_name), legalName: (quote.legal_name as string | null) ?? null,
        ruc: (quote.ruc as string | null) ?? null, address: (quote.address as string | null) ?? null },
      number: Number(quote.number),
      issuedAt: new Date(quote.created_at as string | Date).toISOString(),
      validUntil: new Date(quote.valid_until as string | Date).toISOString().slice(0, 10),
      customerName: (quote.customer_name as string | null) ?? "Cliente varios",
      subtotalCents: Number(quote.subtotal_cents),
      discountCents: Number(quote.discount_cents),
      totalCents: Number(quote.total_cents),
      notes: (quote.notes as string | null) ?? null,
      paymentTerms: (quote.payment_terms as string | null) ?? null,
      deliveryTerms: (quote.delivery_terms as string | null) ?? null,
      // Logo, color, contact and payment methods are the company's current ones.
      brand: await loadBrandKit(this.pool, String(quote.tenant_id)),
      lines: lines.rows.map((line) => ({
        description: String(line.description),
        quantity: Number(line.quantity),
        unitPriceCents: Number(line.unit_price_cents),
        totalCents: Number(line.line_total_cents),
      })),
    };
  }
}
