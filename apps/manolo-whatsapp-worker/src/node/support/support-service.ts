import { randomUUID } from "node:crypto";
import type {
  CustomerContext,
  EventKind,
  SupportBridgeRequest,
  SupportBridgeResponse,
  Ticket,
  TicketKind,
} from "../../support/bridge-contracts";
import type { BridgeRequestIdentity, BridgeRequestStore } from "../bridge/request-store";
import type { RoleLog } from "../../roles/contracts";

type Rows = { rows: Array<Record<string, unknown>> };
type Db = { query(sql: string, values?: readonly unknown[]): Promise<unknown> };
type QueryClient = { query(sql: string, values?: readonly unknown[]): Promise<Rows>; release(destroy?: boolean): void };
export type SupportPool = { connect(): Promise<unknown>; query(sql: string, values?: readonly unknown[]): Promise<unknown> };

export type SupportServiceResult =
  | { status: "completed"; response: SupportBridgeResponse }
  | { status: "conflict" | "in_progress" };

/** Sales Cat's side of a quote a customer asks for (ADR-0017, point 4). */
export interface CustomerQuoter {
  quoteForCustomer(companyId: string, customer: { name: string; phone: string }, items: Array<{ product: string; quantity: number }>):
    Promise<{ number: number; totalCents: number; validUntil: string; lines: Array<{ name: string; quantity: number }> }>;
}
export interface QuotePdfReader {
  byNumber(companyId: string, number: number): Promise<{ filename: string; bytes: Uint8Array } | null>;
}

export type SupportStats = { customers: number; answered: number; quoted: number; escalated: number; ratedYes: number; ratedNo: number; open: number };
export type SupportSnapshot = {
  phoneNumberId: string | null;
  faqs: Array<{ id: string; question: string; answer: string }>;
  open: Ticket[];
  recent: Ticket[];
  today: SupportStats;
};

class SupportError extends Error {
  constructor(readonly code: string, readonly details?: unknown) {
    super(code);
  }
}

const WRITES = new Set(["open_ticket", "customer_quote", "answer_ticket", "mark_relayed", "close_ticket", "summaries"]);
const LIMA_OFFSET_MS = 5 * 60 * 60 * 1000;
const num = (value: unknown) => Number(value ?? 0);
const optional = (value: unknown) => (value === null || value === undefined ? null : String(value));
const day = (value: unknown) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "").slice(0, 10));
const limaDate = (instant: Date) => new Date(instant.getTime() - LIMA_OFFSET_MS).toISOString().slice(0, 10);
const limaDayStart = (instant: Date) => new Date(Date.parse(`${limaDate(instant)}T00:00:00Z`) + LIMA_OFFSET_MS);
export const ticketCode = (number: number) => `#${number}`;

const ENABLED = `settings.enabled AND (settings.active_until IS NULL OR settings.active_until > CURRENT_TIMESTAMP)`;

/**
 * Support Cat's data (ADR-0017). The customer side is reached by the company's WhatsApp number
 * and speaks for the platform; tickets are answered by the owner (point 7). Writes are
 * idempotent per request id; every decision is in the audit log.
 */
export class SupportService {
  constructor(
    private readonly pool: SupportPool,
    private readonly requestStore: BridgeRequestStore,
    private readonly log: RoleLog,
    private readonly quoter: CustomerQuoter | null = null,
    private readonly quotePdfs: QuotePdfReader | null = null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async process(request: SupportBridgeRequest, requestId: string, requestHash: string): Promise<SupportServiceResult> {
    if (!WRITES.has(request.operation)) {
      return { status: "completed", response: await this.safely(request, requestId) };
    }
    const identity: BridgeRequestIdentity = {
      requestId,
      tenantId: request.company_id ?? request.channel_tenant_id,
      roleKey: `support:${request.operation}`,
      requestHash,
    };
    const claim = await this.requestStore.claim(identity);
    if (claim.status === "conflict" || claim.status === "in_progress") return { status: claim.status };
    if (claim.status === "completed") {
      try {
        return { status: "completed", response: { ...(JSON.parse(claim.replyText) as SupportBridgeResponse), replayed: true } };
      } catch {
        await this.requestStore.fail(identity, "stored_response_invalid");
        return { status: "in_progress" };
      }
    }
    const response = await this.safely(request, requestId);
    if (response.ok || response.error?.code !== "internal_error") {
      await this.requestStore.complete(identity, JSON.stringify(response));
    } else {
      await this.requestStore.fail(identity, "support_internal_error");
    }
    return { status: "completed", response };
  }

  private async safely(request: SupportBridgeRequest, requestId: string): Promise<SupportBridgeResponse> {
    try {
      return { request_id: requestId, ok: true, data: await this.execute(request) };
    } catch (error) {
      const known = error instanceof SupportError ? error
        : error instanceof Error && "code" in error && typeof (error as { code: unknown }).code === "string"
          && ["unknown_products", "not_enabled"].includes((error as { code: string }).code)
          ? new SupportError((error as { code: string }).code, (error as { details?: unknown }).details) : null;
      if (known) return { request_id: requestId, ok: false, error: { code: known.code, ...(known.details ? { details: known.details } : {}) } };
      this.log("vps_support_operation_failed", { operation: request.operation, reason: error instanceof Error ? error.name : "unknown" });
      return { request_id: requestId, ok: false, error: { code: "internal_error" } };
    }
  }

  private async query(sql: string, values: readonly unknown[], db: Db = this.pool): Promise<Rows> {
    return await db.query(sql, values) as Rows;
  }

  async enabled(companyId: string, db: Db = this.pool): Promise<{ name: string } | null> {
    const { rows } = await this.query(
      `SELECT tenant.name FROM support.settings AS settings
         JOIN whatsapp.tenants AS tenant ON tenant.id = settings.tenant_id AND tenant.status = 'active'
        WHERE settings.tenant_id = $1 AND ${ENABLED}`,
      [companyId], db);
    return rows.length ? { name: String(rows[0].name) } : null;
  }

  private async ownerPhones(companyId: string): Promise<string[]> {
    const { rows } = await this.query(
      `SELECT DISTINCT link.wa_phone FROM whatsapp.portal_company_members AS member
         JOIN whatsapp.portal_whatsapp_links AS link ON link.portal_user_id = member.portal_user_id
        WHERE member.tenant_id = $1 AND member.role = 'owner'`,
      [companyId]);
    return rows.map((row) => String(row.wa_phone)).filter((phone) => /^[0-9]{8,15}$/.test(phone));
  }

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
      [companyId, contactId]);
    return !rows[0]?.claimed || Boolean(rows[0]?.owner);
  }

  private async companies(request: SupportBridgeRequest): Promise<Array<{ id: string; name: string }>> {
    const contact = await this.query("SELECT 1 FROM whatsapp.contacts WHERE id = $1 AND tenant_id = $2",
      [request.contact_id, request.channel_tenant_id]);
    if (!contact.rows.length) throw new SupportError("forbidden");
    const { rows } = await this.query(
      `SELECT tenant.id, tenant.name
         FROM whatsapp.tenant_members AS member
         JOIN whatsapp.tenants AS tenant ON tenant.id = member.tenant_id AND tenant.status = 'active'
         JOIN support.settings AS settings ON settings.tenant_id = tenant.id AND ${ENABLED}
        WHERE member.contact_id = $1 AND member.status = 'active'
        ORDER BY tenant.name`,
      [request.contact_id]);
    return rows.map((row) => ({ id: String(row.id), name: String(row.name) }));
  }

  private async execute(request: SupportBridgeRequest): Promise<unknown> {
    const payload = request.payload ?? {};
    if (request.contact_id === undefined) return this.executeSystem(request, payload);
    const companies = await this.companies(request);
    if (request.operation === "companies") return { companies };
    const companyId = request.company_id!;
    const company = companies.find((candidate) => candidate.id === companyId);
    if (!company) throw new SupportError("forbidden");
    const contactId = request.contact_id;
    const owner = await this.isOwner(companyId, contactId);
    switch (request.operation) {
      case "pending":
        return { owner, companyName: company.name, open: await this.tickets(this.pool, companyId, "ticket.status = 'open'", []) };
      case "answer_ticket": {
        if (!owner) throw new SupportError("owner_only");
        return this.transaction(async (client) => {
          const ticket = await this.lockTicket(client, companyId, String(payload.ticketId));
          if (ticket.status === "closed") throw new SupportError("closed");
          await client.query(
            `UPDATE support.tickets SET status = 'answered', answer = $2, answered_by_contact_id = $3, answered_at = $4, updated_at = $4
              WHERE id = $1`,
            [ticket.id, String(payload.answer).trim(), contactId, this.now()]);
          await this.audit(client, companyId, contactId, "answer_ticket", { ticketId: ticket.id });
          return { ticket: await this.ticket(client, companyId, String(ticket.id)), companyName: company.name };
        });
      }
      case "mark_relayed":
        if (!owner) throw new SupportError("owner_only");
        await this.query("UPDATE support.tickets SET relayed = $3, updated_at = $4 WHERE id = $1 AND tenant_id = $2",
          [payload.ticketId, companyId, payload.relayed === true, this.now()]);
        return { ticket: await this.ticket(this.pool, companyId, String(payload.ticketId)) };
      case "close_ticket":
        if (!owner) throw new SupportError("owner_only");
        await this.query("UPDATE support.tickets SET status = 'closed', updated_at = $3 WHERE id = $1 AND tenant_id = $2",
          [payload.ticketId, companyId, this.now()]);
        await this.audit(this.pool, companyId, contactId, "close_ticket", { ticketId: payload.ticketId });
        return { ticket: await this.ticket(this.pool, companyId, String(payload.ticketId)) };
      default:
        throw new SupportError("forbidden");
    }
  }

  private async executeSystem(request: SupportBridgeRequest, payload: Record<string, unknown>): Promise<unknown> {
    if (request.operation === "customer_context") return this.customerContext(String(payload.phoneNumberId), String(payload.phone));
    if (request.operation === "summaries") return { summaries: await this.summaries() };
    const companyId = request.company_id!;
    const company = await this.enabled(companyId);
    if (!company) throw new SupportError("forbidden");
    switch (request.operation) {
      case "customer_event":
        await this.query(
          `INSERT INTO support.events (tenant_id, customer_phone, kind, source_ref, created_at) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (tenant_id, source_ref) WHERE source_ref IS NOT NULL DO NOTHING`,
          [companyId, payload.phone, payload.kind as EventKind, (payload.sourceRef as string | undefined) ?? null, this.now()]);
        return { recorded: true };
      case "open_ticket":
        return this.openTicket(companyId, company.name, payload);
      case "customer_quote": {
        if (!this.quoter) throw new SupportError("unavailable");
        const phone = String(payload.phone);
        const known = await this.customer(this.pool, companyId, phone);
        const name = (payload.customerName as string | undefined)?.trim() || known?.name || `Cliente +${phone}`;
        const quote = await this.quoter.quoteForCustomer(companyId, { name, phone }, payload.items as Array<{ product: string; quantity: number }>);
        await this.query(
          `INSERT INTO support.events (tenant_id, customer_phone, kind, source_ref, created_at) VALUES ($1, $2, 'quoted', $3, $4)
           ON CONFLICT (tenant_id, source_ref) WHERE source_ref IS NOT NULL DO NOTHING`,
          [companyId, phone, payload.sourceRef ? `${String(payload.sourceRef)}:quote` : null, this.now()]);
        return { quote, companyName: company.name };
      }
      case "quote_pdf": {
        if (!this.quotePdfs) throw new SupportError("unavailable");
        const pdf = await this.quotePdfs.byNumber(companyId, Number(payload.number));
        if (!pdf) throw new SupportError("not_found");
        return { pdf: { filename: pdf.filename, contentBase64: Buffer.from(pdf.bytes).toString("base64") } };
      }
      case "mark_notified":
        await this.query("UPDATE support.tickets SET notified_at = $3 WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND notified_at IS NULL",
          [companyId, payload.ticketIds, this.now()]);
        return { notified: true };
      default:
        throw new SupportError("forbidden");
    }
  }

  private async customer(db: Db, companyId: string, phone: string): Promise<{ id: string; name: string } | null> {
    const { rows } = await this.query(
      "SELECT id, name FROM commerce.customers WHERE tenant_id = $1 AND phone = $2 ORDER BY updated_at DESC LIMIT 1",
      [companyId, phone], db);
    return rows[0] ? { id: String(rows[0].id), name: String(rows[0].name) } : null;
  }

  /**
   * Who is writing to the company's number (ADR-0017, points 1–4): a team member of any
   * company, or someone linked to the portal, is not a customer; everyone else is, with
   * what the cat may say: FAQs, the catalog and their own quotes and sales.
   */
  private async customerContext(phoneNumberId: string, phone: string): Promise<CustomerContext> {
    const { rows } = await this.query(
      `SELECT settings.tenant_id, tenant.name FROM support.settings AS settings
         JOIN whatsapp.tenants AS tenant ON tenant.id = settings.tenant_id AND tenant.status = 'active'
        WHERE settings.phone_number_id = $1 AND ${ENABLED}`,
      [phoneNumberId]);
    if (!rows.length) return { mode: "off" };
    const companyId = String(rows[0].tenant_id);
    const team = await this.query(
      `SELECT EXISTS (SELECT 1 FROM whatsapp.contacts AS contact
                        JOIN whatsapp.tenant_members AS member ON member.contact_id = contact.id AND member.status = 'active'
                       WHERE contact.whatsapp_user_id = $1)
           OR EXISTS (SELECT 1 FROM whatsapp.portal_whatsapp_links WHERE wa_phone = $1) AS team`,
      [phone]);
    if (team.rows[0]?.team) return { mode: "off" };
    const customer = await this.customer(this.pool, companyId, phone);
    const [faqs, catalog, quotes, sales, open] = await Promise.all([
      this.query("SELECT question, answer FROM support.faqs WHERE tenant_id = $1 ORDER BY position, created_at LIMIT 60", [companyId]),
      this.query(
        `SELECT product.name, product.unit_price_cents FROM commerce.products AS product
           JOIN sales.settings AS settings ON settings.tenant_id = product.tenant_id AND ${ENABLED}
          WHERE product.tenant_id = $1 AND product.active ORDER BY product.updated_at DESC LIMIT 80`, [companyId]),
      customer ? this.query(
        `SELECT number, total_cents, valid_until, created_at FROM sales.quotes
          WHERE tenant_id = $1 AND customer_id = $2 AND status <> 'cancelled' ORDER BY created_at DESC LIMIT 5`, [companyId, customer.id])
        : Promise.resolve({ rows: [] } as Rows),
      customer ? this.query(
        `SELECT number, total_cents, balance_cents, status, payment_method, sold_at FROM sales.sales
          WHERE tenant_id = $1 AND customer_id = $2 ORDER BY sold_at DESC LIMIT 5`, [companyId, customer.id])
        : Promise.resolve({ rows: [] } as Rows),
      this.query(
        `SELECT number, kind, question FROM support.tickets WHERE tenant_id = $1 AND customer_phone = $2 AND status = 'open'
          ORDER BY created_at DESC LIMIT 5`, [companyId, phone]),
    ]);
    return {
      mode: "customer",
      companyId,
      companyName: String(rows[0].name),
      customer: { name: customer?.name ?? null },
      faqs: faqs.rows.map((row) => ({ question: String(row.question), answer: String(row.answer) })),
      catalog: catalog.rows.map((row) => ({ name: String(row.name), unitPriceCents: num(row.unit_price_cents) })),
      quotes: quotes.rows.map((row) => ({ number: num(row.number), totalCents: num(row.total_cents), validUntil: day(row.valid_until),
        createdOn: limaDate(new Date(row.created_at as string)) })),
      sales: sales.rows.map((row) => ({ number: num(row.number), totalCents: num(row.total_cents), balanceCents: num(row.balance_cents),
        status: String(row.status), paymentMethod: String(row.payment_method), soldOn: limaDate(new Date(row.sold_at as string)) })),
      openTickets: open.rows.map((row) => ({ number: num(row.number), kind: String(row.kind) as TicketKind, question: String(row.question) })),
    };
  }

  private async openTicket(companyId: string, companyName: string, payload: Record<string, unknown>) {
    return this.transaction(async (client) => {
      const numbered = await client.query(
        "UPDATE support.settings SET last_ticket_number = last_ticket_number + 1 WHERE tenant_id = $1 RETURNING last_ticket_number", [companyId]);
      const phone = String(payload.phone);
      const customer = await this.customer(client, companyId, phone);
      const kind = payload.kind as TicketKind;
      const id = randomUUID();
      await client.query(
        `INSERT INTO support.tickets (id, tenant_id, number, customer_id, customer_phone, customer_name, kind, priority, question, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
        [id, companyId, num(numbered.rows[0].last_ticket_number), customer?.id ?? null, phone,
          (payload.customerName as string | undefined)?.trim() || customer?.name || null, kind,
          kind === "complaint" || kind === "unhappy" ? "high" : "normal", String(payload.question).trim(), this.now()]);
      await client.query(
        `INSERT INTO support.events (tenant_id, customer_phone, kind, source_ref, created_at) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, source_ref) WHERE source_ref IS NOT NULL DO NOTHING`,
        [companyId, phone, kind === "unhappy" ? "rated_no" : "escalated", payload.sourceRef ? `${String(payload.sourceRef)}:ticket` : null, this.now()]);
      await this.audit(client, companyId, null, "open_ticket", { ticketId: id, kind });
      return { ticket: await this.ticket(client, companyId, id), companyName, ownerPhones: await this.ownerPhones(companyId) };
    });
  }

  private async lockTicket(client: QueryClient, companyId: string, ticketId: string) {
    const { rows } = await client.query("SELECT * FROM support.tickets WHERE id = $1 AND tenant_id = $2 FOR UPDATE", [ticketId, companyId]);
    if (!rows[0]) throw new SupportError("not_found");
    return rows[0];
  }

  private async tickets(db: Db, companyId: string, where: string, values: readonly unknown[], limit = 50): Promise<Ticket[]> {
    const { rows } = await this.query(
      `SELECT * FROM support.tickets AS ticket WHERE ticket.tenant_id = $1 AND ${where}
        ORDER BY (ticket.priority = 'high') DESC, ticket.created_at DESC LIMIT ${limit}`,
      [companyId, ...values], db);
    return rows.map((row) => ({
      id: String(row.id),
      number: num(row.number),
      kind: String(row.kind) as TicketKind,
      priority: row.priority === "high" ? "high" : "normal",
      status: String(row.status) as Ticket["status"],
      customerName: optional(row.customer_name),
      customerPhone: String(row.customer_phone),
      question: String(row.question),
      answer: optional(row.answer),
      relayed: Boolean(row.relayed),
      createdAt: new Date(row.created_at as string).toISOString(),
    }));
  }

  private async ticket(db: Db, companyId: string, ticketId: string): Promise<Ticket> {
    const [ticket] = await this.tickets(db, companyId, "ticket.id = $2", [ticketId]);
    if (!ticket) throw new SupportError("not_found");
    return ticket;
  }

  async stats(companyId: string, since: Date): Promise<SupportStats> {
    const { rows } = await this.query(
      `SELECT count(DISTINCT customer_phone)::int AS customers,
              count(*) FILTER (WHERE kind = 'answered')::int AS answered,
              count(*) FILTER (WHERE kind = 'quoted')::int AS quoted,
              count(*) FILTER (WHERE kind = 'escalated')::int AS escalated,
              count(*) FILTER (WHERE kind = 'rated_yes')::int AS rated_yes,
              count(*) FILTER (WHERE kind = 'rated_no')::int AS rated_no,
              (SELECT count(*) FROM support.tickets WHERE tenant_id = $1 AND status = 'open')::int AS open
         FROM support.events WHERE tenant_id = $1 AND created_at >= $2`,
      [companyId, since]);
    const row = rows[0] ?? {};
    return { customers: num(row.customers), answered: num(row.answered), quoted: num(row.quoted), escalated: num(row.escalated),
      ratedYes: num(row.rated_yes), ratedNo: num(row.rated_no), open: num(row.open) };
  }

  /**
   * The daily summary (ADR-0017, point 15), once per company at its hour in Lima. Claimed in
   * the same statement that marks the day, so a retried cron does not send it twice.
   */
  private async summaries() {
    const now = this.now();
    const today = limaDate(now);
    const hour = new Date(now.getTime() - LIMA_OFFSET_MS).getUTCHours();
    const { rows } = await this.query(
      `UPDATE support.settings AS settings SET last_summary_on = $1::date, updated_at = $3
         FROM whatsapp.tenants AS tenant
        WHERE tenant.id = settings.tenant_id AND tenant.status = 'active' AND ${ENABLED}
          AND settings.summary_hour <= $2 AND (settings.last_summary_on IS NULL OR settings.last_summary_on < $1::date)
        RETURNING settings.tenant_id, settings.phone_number_id, tenant.name`,
      [today, hour, now]);
    const summaries = [];
    for (const row of rows) {
      const companyId = String(row.tenant_id);
      const stats = await this.stats(companyId, limaDayStart(now));
      if (!stats.customers && !stats.open) continue;
      const open = await this.tickets(this.pool, companyId, "ticket.status = 'open'", [], 5);
      const lines = [
        `🛟 *Support Cat · ${String(row.name)}* — resumen de hoy`,
        `${stats.customers} ${stats.customers === 1 ? "cliente escribió" : "clientes escribieron"}; resolví ${stats.answered} ${stats.answered === 1 ? "consulta" : "consultas"} solo${stats.quoted ? ` y mandé ${stats.quoted} ${stats.quoted === 1 ? "cotización" : "cotizaciones"}` : ""}.`,
        stats.escalated ? `Te pasé ${stats.escalated} ${stats.escalated === 1 ? "caso" : "casos"}.` : "",
        stats.ratedYes || stats.ratedNo ? `«¿Te ayudé?»: ${stats.ratedYes} sí, ${stats.ratedNo} no.` : "",
        stats.open ? `Pendientes (${stats.open}): ${open.map((ticket) => `${ticketCode(ticket.number)} ${ticket.customerName ?? `+${ticket.customerPhone}`}`).join(", ")}. Escribe /support para verlos.` : "Nada pendiente.",
      ].filter(Boolean);
      summaries.push({ companyId, ownerPhones: await this.ownerPhones(companyId), phoneNumberId: optional(row.phone_number_id), text: lines.join("\n") });
    }
    if (summaries.length) this.log("vps_support_summaries", { companies: summaries.length });
    return summaries;
  }

  /** The portal's page (ADR-0017, Fases). */
  async snapshot(companyId: string): Promise<SupportSnapshot> {
    const [settings, faqs, open, recent, today] = await Promise.all([
      this.query("SELECT phone_number_id FROM support.settings WHERE tenant_id = $1", [companyId]),
      this.query("SELECT id, question, answer FROM support.faqs WHERE tenant_id = $1 ORDER BY position, created_at", [companyId]),
      this.tickets(this.pool, companyId, "ticket.status = 'open'", []),
      this.tickets(this.pool, companyId, "ticket.status <> 'open'", [], 20),
      this.stats(companyId, limaDayStart(this.now())),
    ]);
    return {
      phoneNumberId: optional(settings.rows[0]?.phone_number_id),
      faqs: faqs.rows.map((row) => ({ id: String(row.id), question: String(row.question), answer: String(row.answer) })),
      open, recent, today,
    };
  }

  /** Owner-only, from the portal: add or edit one question, or delete it (answer null). */
  async saveFaq(companyId: string, portalUserId: string, faq: { id?: string; question?: string; answer?: string; remove?: boolean }) {
    return this.transaction(async (client) => {
      if (faq.remove) {
        await client.query("DELETE FROM support.faqs WHERE id = $1 AND tenant_id = $2", [faq.id, companyId]);
      } else if (faq.id) {
        const { rows } = await client.query(
          "UPDATE support.faqs SET question = $3, answer = $4, updated_at = $5 WHERE id = $1 AND tenant_id = $2 RETURNING id",
          [faq.id, companyId, faq.question!.trim(), faq.answer!.trim(), this.now()]);
        if (!rows.length) throw new SupportError("not_found");
      } else {
        const count = await client.query("SELECT count(*)::int AS n FROM support.faqs WHERE tenant_id = $1", [companyId]);
        if (num(count.rows[0].n) >= 60) throw new SupportError("too_many");
        await client.query(
          "INSERT INTO support.faqs (id, tenant_id, question, answer, position, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6)",
          [randomUUID(), companyId, faq.question!.trim(), faq.answer!.trim(), num(count.rows[0].n), this.now()]);
      }
      await client.query(
        "INSERT INTO support.audit_log (tenant_id, portal_user_id, action, details) VALUES ($1, $2, 'faq', $3)",
        [companyId, portalUserId, JSON.stringify({ id: faq.id ?? null, remove: Boolean(faq.remove) })]);
    });
  }

  async weekly(companyId: string, since: Date): Promise<SupportStats | null> {
    if (!await this.enabled(companyId)) return null;
    return this.stats(companyId, since);
  }

  private async audit(db: Db, companyId: string, contactId: number | null, action: string, details: Record<string, unknown>) {
    await this.query("INSERT INTO support.audit_log (tenant_id, contact_id, action, details) VALUES ($1, $2, $3, $4)",
      [companyId, contactId, action, JSON.stringify(details)], db);
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
      destroy = !(error instanceof SupportError) && !(error instanceof Error && "code" in error);
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release(destroy);
    }
  }
}

export { SupportError };
