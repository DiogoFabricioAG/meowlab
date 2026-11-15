import { randomUUID } from "node:crypto";
import type {
  CollectionsBridgeRequest,
  CollectionsBridgeResponse,
  CollectionsQueryType,
  CollectionsSettings,
  DebtSummary,
  PaidPeriod,
  PaymentMethod,
  PendingPayment,
} from "../../collections/bridge-contracts";
import {
  addDays,
  agingBucket,
  daysBetween,
  dueForReminder,
  insideWindow,
  limaDate,
  needsOwner,
  toneFor,
  type AgingBucket,
} from "../../collections/schedule";
import type { BridgeRequestIdentity, BridgeRequestStore } from "../bridge/request-store";
import type { RoleLog } from "../../roles/contracts";

type Rows = { rows: Array<Record<string, unknown>> };
type Db = { query(sql: string, values?: readonly unknown[]): Promise<unknown> };
type QueryClient = { query(sql: string, values?: readonly unknown[]): Promise<Rows>; release(destroy?: boolean): void };
export type CollectionsPool = { connect(): Promise<unknown>; query(sql: string, values?: readonly unknown[]): Promise<unknown> };

export type CollectionsServiceResult =
  | { status: "completed"; response: CollectionsBridgeResponse }
  | { status: "conflict" | "in_progress" };

/** Credit invoices and credit notes a company issued in FacturaYa (ADR-0015, points 2 and 16). */
export interface CreditDocumentReader {
  /** Null when the company has no FacturaYa or it cannot answer now. */
  read(tenantId: string, since: string): Promise<CreditDocument[] | null>;
}
export type CreditDocument =
  | {
    kind: "invoice";
    id: string;
    number: string;
    status: string;
    issueDate: string;
    customer: { docType: string | null; docNumber: string | null; name: string };
    totalCents: number;
    credit: boolean;
    outstandingCents: number | null;
    firstDueDate: string | null;
  }
  | { kind: "credit_note"; id: string; number: string; status: string; relatedNumber: string | null; totalCents: number };

export type Buckets = Record<AgingBucket, number>;
export type CollectionsSnapshot = {
  settings: CollectionsSettings;
  totalCents: number;
  buckets: Buckets;
  debts: Array<DebtSummary & { docNumber: string | null; escalated: boolean; dueForReminder: boolean; source: "sale" | "invoice" | "chat" }>;
  pending: PendingPayment[];
  recent: Array<{ customer: string; amountCents: number; method: string; paidOn: string }>;
};

const WRITES = new Set(["add_debt", "record_payment", "decide_payment", "remind", "set_customer", "settings", "cancel_debt"]);
const SETTINGS_COLUMNS: Record<keyof CollectionsSettings, string> = {
  defaultDueDays: "default_due_days",
  remindBeforeDays: "remind_before_days",
  remindEveryDays: "remind_every_days",
  maxReminders: "max_reminders",
  windowStartHour: "window_start_hour",
  windowEndHour: "window_end_hour",
  skipSundays: "skip_sundays",
  yapePhone: "yape_phone",
  plinPhone: "plin_phone",
  bankText: "bank_text",
  paymentLink: "payment_link",
};

class CollectionsError extends Error {
  constructor(readonly code: string, readonly details?: unknown) {
    super(code);
  }
}

const num = (value: unknown) => Number(value ?? 0);
const day = (value: unknown) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "").slice(0, 10));
const optional = (value: unknown) => (value === null || value === undefined ? null : String(value));
const emptyBuckets = (): Buckets => ({ current: 0, d1_30: 0, d31_60: 0, d61: 0 });

const OPEN_DEBTS_SQL = `
  SELECT debt.id, debt.source, debt.balance_cents, debt.amount_cents, debt.due_on, debt.document_number, debt.description,
         debt.reminders_sent, debt.last_reminder_at, debt.escalated_at, debt.customer_id,
         customer.name AS customer, customer.phone, customer.doc_number,
         COALESCE(rules.do_not_contact, FALSE) AS do_not_contact,
         (SELECT max(payment.paid_on) FROM receivables.payments AS payment
           WHERE payment.debt_id = debt.id AND payment.status = 'confirmed') AS last_payment_on
    FROM receivables.debts AS debt
    JOIN commerce.customers AS customer ON customer.id = debt.customer_id
    LEFT JOIN receivables.customer_rules AS rules ON rules.tenant_id = debt.tenant_id AND rules.customer_id = debt.customer_id
   WHERE debt.tenant_id = $1 AND debt.status = 'open'
   ORDER BY debt.due_on, debt.created_at
   LIMIT 500`;

/**
 * Collections Cat's data (ADR-0015). Any active member of a company with Collections Cat on
 * records debts and payments and confirms captures (with their name in the audit log); the
 * rules belong to the owner. Writes are idempotent per request id; every payment is a row.
 */
export class CollectionsService {
  constructor(
    private readonly pool: CollectionsPool,
    private readonly requestStore: BridgeRequestStore,
    private readonly log: RoleLog,
    private readonly documents: CreditDocumentReader | null = null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async process(request: CollectionsBridgeRequest, requestId: string, requestHash: string): Promise<CollectionsServiceResult> {
    if (!WRITES.has(request.operation)) {
      return { status: "completed", response: await this.safely(request, requestId) };
    }
    const identity: BridgeRequestIdentity = {
      requestId,
      tenantId: request.company_id ?? request.channel_tenant_id,
      roleKey: `collections:${request.operation}`,
      requestHash,
    };
    const claim = await this.requestStore.claim(identity);
    if (claim.status === "conflict" || claim.status === "in_progress") return { status: claim.status };
    if (claim.status === "completed") {
      try {
        return { status: "completed", response: { ...(JSON.parse(claim.replyText) as CollectionsBridgeResponse), replayed: true } };
      } catch {
        await this.requestStore.fail(identity, "stored_response_invalid");
        return { status: "in_progress" };
      }
    }
    const response = await this.safely(request, requestId);
    if (response.ok || response.error?.code !== "internal_error") {
      await this.requestStore.complete(identity, JSON.stringify(response));
    } else {
      await this.requestStore.fail(identity, "collections_internal_error");
    }
    return { status: "completed", response };
  }

  private async safely(request: CollectionsBridgeRequest, requestId: string): Promise<CollectionsBridgeResponse> {
    try {
      return { request_id: requestId, ok: true, data: await this.execute(request) };
    } catch (error) {
      if (error instanceof CollectionsError) {
        return { request_id: requestId, ok: false, error: { code: error.code, ...(error.details ? { details: error.details } : {}) } };
      }
      this.log("vps_collections_operation_failed", { operation: request.operation, reason: error instanceof Error ? error.name : "unknown" });
      return { request_id: requestId, ok: false, error: { code: "internal_error" } };
    }
  }

  private async query(sql: string, values: readonly unknown[], db: Db = this.pool): Promise<Rows> {
    return await db.query(sql, values) as Rows;
  }

  private today() {
    return limaDate(this.now());
  }

  /** Companies of the contact with Collections Cat on (courtesy, or a subscription still paid). */
  private async companies(request: CollectionsBridgeRequest): Promise<Array<{ id: string; name: string }>> {
    const contact = await this.query("SELECT 1 FROM whatsapp.contacts WHERE id = $1 AND tenant_id = $2",
      [request.contact_id, request.channel_tenant_id]);
    if (!contact.rows.length) throw new CollectionsError("forbidden");
    const { rows } = await this.query(
      `SELECT tenant.id, tenant.name
         FROM whatsapp.tenant_members AS member
         JOIN whatsapp.tenants AS tenant ON tenant.id = member.tenant_id AND tenant.status = 'active'
         JOIN receivables.settings AS settings ON settings.tenant_id = tenant.id AND settings.enabled
              AND (settings.active_until IS NULL OR settings.active_until > CURRENT_TIMESTAMP)
        WHERE member.contact_id = $1 AND member.status = 'active'
        ORDER BY tenant.name`,
      [request.contact_id],
    );
    return rows.map((row) => ({ id: String(row.id), name: String(row.name) }));
  }

  /** Same rule as Stock Cat: the WhatsApp linked to the portal owner; unclaimed companies have none. */
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

  private async execute(request: CollectionsBridgeRequest): Promise<unknown> {
    const companies = await this.companies(request);
    if (request.operation === "companies") return { companies };
    const companyId = request.company_id!;
    const company = companies.find((entry) => entry.id === companyId);
    if (!company) throw new CollectionsError("forbidden");
    const payload = request.payload ?? {};
    const contactId = request.contact_id;
    const actor = { contactId, portalUserId: null };

    switch (request.operation) {
      case "overview": {
        const sync = await this.sync(companyId);
        const snapshot = await this.snapshot(companyId);
        return {
          owner: await this.isOwner(companyId, contactId),
          sync,
          settings: snapshot.settings,
          totalCents: snapshot.totalCents,
          buckets: snapshot.buckets,
          openCount: snapshot.debts.length,
          toRemind: snapshot.debts.filter((debt) => debt.dueForReminder).slice(0, 10).map(strip),
          escalated: snapshot.debts.filter((debt) => debt.escalated).slice(0, 10).map(strip),
          pending: snapshot.pending,
          // Names the extractor can match («Juan» → «Juan Pérez»).
          customers: [...new Set(snapshot.debts.map((debt) => debt.customer))].slice(0, 120),
        };
      }
      case "add_debt":
        return this.transaction(async (client) => {
          const settings = await this.settings(companyId, client);
          const customerId = await this.customer(client, companyId, String(payload.customer), {
            docNumber: optional(payload.docNumber), phone: optional(payload.phone), contactId,
          });
          const today = this.today();
          const dueOn = (payload.dueOn as string | undefined) ?? addDays(today, settings.defaultDueDays);
          const id = randomUUID();
          await client.query(
            `INSERT INTO receivables.debts (id, tenant_id, customer_id, source, description, amount_cents, balance_cents, issued_on, due_on, created_by_contact_id)
             VALUES ($1, $2, $3, 'chat', $4, $5, $5, $6, $7, $8)`,
            [id, companyId, customerId, optional(payload.description), payload.amountCents, today, dueOn, contactId],
          );
          await this.audit(client, companyId, actor, "add_debt", { debtId: id, amountCents: payload.amountCents });
          return { debt: await this.debtSummary(client, companyId, id), customerBalanceCents: await this.customerBalance(client, companyId, customerId) };
        });
      case "record_payment":
        return this.transaction((client) => this.recordPayment(client, companyId, actor, payload));
      case "decide_payment":
        return this.transaction((client) => this.decidePayment(client, companyId, actor, String(payload.paymentId), payload.approve === true));
      case "remind":
        return this.transaction((client) => this.remind(client, companyId, company.name, actor, payload));
      case "set_customer":
        return this.transaction(async (client) => {
          const found = await this.findCustomer(client, companyId, String(payload.customer));
          if (!found) throw new CollectionsError("not_found", { customer: payload.customer });
          if (payload.phone !== undefined) {
            await client.query("UPDATE commerce.customers SET phone = $3, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = $1 AND id = $2",
              [companyId, found.id, payload.phone]);
          }
          if (payload.doNotContact !== undefined) {
            await client.query(
              `INSERT INTO receivables.customer_rules (tenant_id, customer_id, do_not_contact, updated_by_contact_id) VALUES ($1, $2, $3, $4)
               ON CONFLICT (tenant_id, customer_id) DO UPDATE SET do_not_contact = EXCLUDED.do_not_contact,
                 updated_by_contact_id = EXCLUDED.updated_by_contact_id, updated_at = CURRENT_TIMESTAMP`,
              [companyId, found.id, payload.doNotContact, contactId],
            );
          }
          await this.audit(client, companyId, actor, "set_customer", { customerId: found.id, phone: payload.phone !== undefined, doNotContact: payload.doNotContact });
          const { rows } = await client.query(
            `SELECT customer.name, customer.phone, COALESCE(rules.do_not_contact, FALSE) AS do_not_contact FROM commerce.customers AS customer
               LEFT JOIN receivables.customer_rules AS rules ON rules.tenant_id = customer.tenant_id AND rules.customer_id = customer.id
              WHERE customer.id = $1`, [found.id]);
          return { customer: { name: String(rows[0].name), phone: optional(rows[0].phone), doNotContact: Boolean(rows[0].do_not_contact) } };
        });
      case "settings": {
        if (!await this.isOwner(companyId, contactId)) throw new CollectionsError("owner_only");
        return { settings: await this.changeSettings(companyId, actor, payload.change as Partial<CollectionsSettings>) };
      }
      case "query":
        return this.answer(companyId, payload.type as CollectionsQueryType, payload.period as PaidPeriod | undefined);
      case "cancel_debt":
        return this.transaction(async (client) => {
          const { rows } = await client.query(
            `UPDATE receivables.debts SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
              WHERE tenant_id = $1 AND id = $2 AND status = 'open' RETURNING id`, [companyId, payload.debtId]);
          if (!rows.length) throw new CollectionsError("not_found");
          await this.audit(client, companyId, actor, "cancel_debt", { debtId: payload.debtId });
          return { cancelled: true };
        });
    }
  }

  async settings(companyId: string, db: Db = this.pool): Promise<CollectionsSettings> {
    const { rows } = await this.query("SELECT * FROM receivables.settings WHERE tenant_id = $1", [companyId], db);
    const row = rows[0] ?? {};
    return {
      defaultDueDays: num(row.default_due_days ?? 30),
      remindBeforeDays: num(row.remind_before_days ?? 2),
      remindEveryDays: num(row.remind_every_days ?? 7),
      maxReminders: num(row.max_reminders ?? 3),
      windowStartHour: num(row.window_start_hour ?? 9),
      windowEndHour: num(row.window_end_hour ?? 19),
      skipSundays: row.skip_sundays !== false,
      yapePhone: optional(row.yape_phone),
      plinPhone: optional(row.plin_phone),
      bankText: optional(row.bank_text),
      paymentLink: optional(row.payment_link),
    };
  }

  /** Owner-only rule changes, from the chat or the portal (ADR-0015, point 8). */
  async changeSettings(companyId: string, actor: { contactId: number | null; portalUserId: string | null }, change: Partial<CollectionsSettings>) {
    const current = await this.settings(companyId);
    const next = { ...current, ...change };
    if (next.windowStartHour >= next.windowEndHour) throw new CollectionsError("invalid_window");
    const keys = Object.keys(change) as Array<keyof CollectionsSettings>;
    const assignments = keys.map((key, index) => `${SETTINGS_COLUMNS[key]} = $${index + 2}`);
    await this.transaction(async (client) => {
      await client.query(`UPDATE receivables.settings SET ${assignments.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = $1`,
        [companyId, ...keys.map((key) => change[key])]);
      await this.audit(client, companyId, actor, "settings", { keys });
    });
    return this.settings(companyId);
  }

  /** Every open debt with what the cat would do with it today, plus captures and recent payments. */
  async snapshot(companyId: string): Promise<CollectionsSnapshot> {
    const settings = await this.settings(companyId);
    const today = this.today();
    const [debts, pending, recent] = await Promise.all([
      this.query(OPEN_DEBTS_SQL, [companyId]),
      this.query(
        `SELECT payment.id, payment.amount_cents, payment.method, payment.operation_number, payment.paid_on, customer.name AS customer
           FROM receivables.payments AS payment
           JOIN receivables.debts AS debt ON debt.id = payment.debt_id
           JOIN commerce.customers AS customer ON customer.id = debt.customer_id
          WHERE payment.tenant_id = $1 AND payment.status = 'pending' ORDER BY payment.created_at LIMIT 20`, [companyId]),
      this.query(
        `SELECT payment.amount_cents, payment.method, payment.paid_on, customer.name AS customer
           FROM receivables.payments AS payment
           JOIN receivables.debts AS debt ON debt.id = payment.debt_id
           JOIN commerce.customers AS customer ON customer.id = debt.customer_id
          WHERE payment.tenant_id = $1 AND payment.status = 'confirmed' ORDER BY payment.paid_on DESC, payment.created_at DESC LIMIT 30`,
        [companyId]),
    ]);
    const buckets = emptyBuckets();
    let totalCents = 0;
    const escalate: string[] = [];
    const list = debts.rows.map((row) => {
      const summary = this.summary(row, today);
      const schedule = { dueOn: summary.dueOn, remindersSent: summary.remindersSent, lastReminderOn: row.last_reminder_at ? limaDate(new Date(String(row.last_reminder_at))) : null };
      const doNotContact = Boolean(row.do_not_contact);
      const escalated = needsOwner({ ...schedule, lastPaymentOn: row.last_payment_on ? day(row.last_payment_on) : null }, settings, today, doNotContact);
      if (escalated && !row.escalated_at) escalate.push(summary.id);
      buckets[agingBucket(summary.daysLate)] += summary.balanceCents;
      totalCents += summary.balanceCents;
      return {
        ...summary,
        docNumber: optional(row.doc_number),
        escalated,
        dueForReminder: !escalated && dueForReminder(schedule, settings, today, doNotContact),
        source: String(row.source) as "sale" | "invoice" | "chat",
      };
    });
    if (escalate.length) {
      await this.query("UPDATE receivables.debts SET escalated_at = CURRENT_TIMESTAMP WHERE tenant_id = $1 AND id = ANY($2::uuid[])",
        [companyId, escalate]);
    }
    return {
      settings,
      totalCents,
      buckets,
      debts: list,
      pending: pending.rows.map((row) => ({
        id: String(row.id), customer: String(row.customer), amountCents: num(row.amount_cents), method: String(row.method) as PaymentMethod,
        operationNumber: optional(row.operation_number), paidOn: day(row.paid_on),
      })),
      recent: recent.rows.map((row) => ({ customer: String(row.customer), amountCents: num(row.amount_cents), method: String(row.method), paidOn: day(row.paid_on) })),
    };
  }

  private summary(row: Record<string, unknown>, today: string): DebtSummary {
    const dueOn = day(row.due_on);
    return {
      id: String(row.id),
      customer: String(row.customer),
      phone: optional(row.phone),
      balanceCents: num(row.balance_cents),
      amountCents: num(row.amount_cents),
      dueOn,
      daysLate: daysBetween(dueOn, today),
      document: optional(row.document_number),
      description: optional(row.description),
      remindersSent: num(row.reminders_sent),
    };
  }

  private async debtSummary(db: Db, companyId: string, debtId: string): Promise<DebtSummary> {
    const { rows } = await this.query(
      `SELECT debt.*, customer.name AS customer, customer.phone FROM receivables.debts AS debt
         JOIN commerce.customers AS customer ON customer.id = debt.customer_id WHERE debt.tenant_id = $1 AND debt.id = $2`,
      [companyId, debtId], db);
    return this.summary(rows[0], this.today());
  }

  private async customerBalance(db: Db, companyId: string, customerId: string): Promise<number> {
    const { rows } = await this.query(
      "SELECT COALESCE(sum(balance_cents), 0) AS total FROM receivables.debts WHERE tenant_id = $1 AND customer_id = $2 AND status = 'open'",
      [companyId, customerId], db);
    return num(rows[0]?.total);
  }

  /** A customer by document number or name, case-insensitive. */
  private async findCustomer(db: Db, companyId: string, name: string): Promise<{ id: string; name: string } | null> {
    const clean = name.trim().replace(/\s+/g, " ");
    const { rows } = await this.query(
      `SELECT id, name FROM commerce.customers WHERE tenant_id = $1 AND (lower(name) = lower($2) OR doc_number = $2)
        ORDER BY (doc_number = $2) DESC NULLS LAST, created_at LIMIT 1`,
      [companyId, clean], db);
    if (rows[0]) return { id: String(rows[0].id), name: String(rows[0].name) };
    // «Juan» finds «Juan Pérez» when only one customer with open debt starts like that.
    const partial = await this.query(
      `SELECT DISTINCT customer.id, customer.name FROM commerce.customers AS customer
         JOIN receivables.debts AS debt ON debt.customer_id = customer.id AND debt.status = 'open'
        WHERE customer.tenant_id = $1 AND lower(customer.name) LIKE lower($2) || '%' LIMIT 2`,
      [companyId, clean.replace(/[%_\\]/g, "")], db);
    return partial.rows.length === 1 ? { id: String(partial.rows[0].id), name: String(partial.rows[0].name) } : null;
  }

  /** Finds or creates the customer, in `commerce.customers` like Sales Cat. */
  private async customer(db: Db, companyId: string, name: string,
    extra: { docNumber: string | null; phone: string | null; contactId: number | null; docType?: string | null }): Promise<string> {
    const clean = name.trim().replace(/\s+/g, " ").slice(0, 200) || "Cliente varios";
    if (extra.docNumber) {
      const docType = extra.docType ?? (extra.docNumber.length === 11 ? "6" : "1");
      const { rows } = await this.query(
        `INSERT INTO commerce.customers (id, tenant_id, doc_type, doc_number, name, phone, created_by_contact_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (tenant_id, doc_type, doc_number) WHERE doc_number IS NOT NULL
           DO UPDATE SET phone = COALESCE(EXCLUDED.phone, commerce.customers.phone), updated_at = CURRENT_TIMESTAMP
         RETURNING id`,
        [randomUUID(), companyId, docType, extra.docNumber, clean, extra.phone, extra.contactId], db);
      return String(rows[0].id);
    }
    const found = await this.findCustomer(db, companyId, clean);
    if (found) {
      if (extra.phone) await this.query("UPDATE commerce.customers SET phone = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1", [found.id, extra.phone], db);
      return found.id;
    }
    const { rows } = await this.query(
      `INSERT INTO commerce.customers (id, tenant_id, doc_type, name, phone, created_by_contact_id) VALUES ($1, $2, '0', $3, $4, $5)
       ON CONFLICT (tenant_id, lower(name)) WHERE doc_number IS NULL DO UPDATE SET updated_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [randomUUID(), companyId, clean, extra.phone, extra.contactId], db);
    return String(rows[0].id);
  }

  /** The customer's open debts, oldest due first, locked; or the one asked for. */
  private async debtsFor(client: QueryClient, companyId: string, payload: Record<string, unknown>) {
    if (payload.debtId) {
      const { rows } = await client.query(
        `SELECT debt.*, customer.name AS customer FROM receivables.debts AS debt JOIN commerce.customers AS customer ON customer.id = debt.customer_id
          WHERE debt.tenant_id = $1 AND debt.id = $2 AND debt.status = 'open' FOR UPDATE OF debt`, [companyId, payload.debtId]);
      if (!rows.length) throw new CollectionsError("not_found");
      const more = await client.query(
        `SELECT debt.*, customer.name AS customer FROM receivables.debts AS debt JOIN commerce.customers AS customer ON customer.id = debt.customer_id
          WHERE debt.tenant_id = $1 AND debt.customer_id = $2 AND debt.status = 'open' AND debt.id <> $3
          ORDER BY debt.due_on, debt.created_at FOR UPDATE OF debt`, [companyId, rows[0].customer_id, payload.debtId]);
      return [...rows, ...more.rows];
    }
    const customer = await this.findCustomer(client, companyId, String(payload.customer));
    if (!customer) throw new CollectionsError("not_found", { customer: payload.customer });
    const { rows } = await client.query(
      `SELECT debt.*, customer.name AS customer FROM receivables.debts AS debt JOIN commerce.customers AS customer ON customer.id = debt.customer_id
        WHERE debt.tenant_id = $1 AND debt.customer_id = $2 AND debt.status = 'open'
        ORDER BY debt.due_on, debt.created_at FOR UPDATE OF debt`, [companyId, customer.id]);
    if (!rows.length) throw new CollectionsError("no_debt", { customer: customer.name });
    return rows;
  }

  /**
   * Applies a confirmed amount to the debts in order (partial payments allowed, point 12).
   * The first row reuses `paymentId` when given; the rest become new confirmed rows.
   */
  private async apply(client: QueryClient, companyId: string, debts: Array<Record<string, unknown>>, amountCents: number,
    payment: { method: PaymentMethod | "nota_credito"; operationNumber: string | null; paidOn: string; contactId: number | null; paymentId?: string; sourceRef?: string }) {
    let left = amountCents;
    const applied: Array<{ debtId: string; amountCents: number; balanceCents: number }> = [];
    for (const debt of debts) {
      if (left <= 0) break;
      const portion = Math.min(left, num(debt.balance_cents));
      if (portion <= 0) continue;
      const balance = num(debt.balance_cents) - portion;
      if (payment.paymentId && !applied.length) {
        await client.query(
          `UPDATE receivables.payments SET status = 'confirmed', amount_cents = $3, debt_id = $4, decided_by_contact_id = $5, decided_at = CURRENT_TIMESTAMP
            WHERE tenant_id = $1 AND id = $2`, [companyId, payment.paymentId, portion, debt.id, payment.contactId]);
      } else {
        await client.query(
          `INSERT INTO receivables.payments (id, tenant_id, debt_id, amount_cents, method, operation_number, paid_on, status, source_ref,
             reported_by_contact_id, decided_by_contact_id, decided_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirmed', $8, $9, $9, CURRENT_TIMESTAMP)`,
          [randomUUID(), companyId, debt.id, portion, payment.method, payment.operationNumber, payment.paidOn,
            applied.length ? null : payment.sourceRef ?? null, payment.contactId]);
      }
      await client.query(
        `UPDATE receivables.debts SET balance_cents = $3::bigint, status = CASE WHEN $3::bigint = 0 THEN 'paid' ELSE status END, updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = $1 AND id = $2`, [companyId, debt.id, balance]);
      // Sales Cat's sale keeps the same balance (ADR-0015, consequences).
      if (debt.source === "sale" && typeof debt.source_ref === "string") {
        await client.query("UPDATE sales.sales SET balance_cents = $3, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = $1 AND id = $2",
          [companyId, debt.source_ref.slice("sale:".length), balance]);
      }
      debt.balance_cents = balance;
      applied.push({ debtId: String(debt.id), amountCents: portion, balanceCents: balance });
      left -= portion;
    }
    return { applied, leftoverCents: left };
  }

  private async recordPayment(client: QueryClient, companyId: string, actor: { contactId: number; portalUserId: null }, payload: Record<string, unknown>) {
    const debts = await this.debtsFor(client, companyId, payload);
    const method = payload.method as PaymentMethod;
    const paidOn = (payload.paidOn as string | undefined) ?? this.today();
    const operationNumber = optional(payload.operationNumber);
    const amountCents = Number(payload.amountCents);
    const customer = String(debts[0].customer);
    if (operationNumber) {
      const repeated = await client.query(
        "SELECT 1 FROM receivables.payments WHERE tenant_id = $1 AND operation_number = $2 AND status <> 'rejected' LIMIT 1",
        [companyId, operationNumber]);
      if (repeated.rows.length) throw new CollectionsError("duplicate_operation", { operationNumber });
    }
    if (payload.fromCapture === true) {
      // A capture is never applied by itself (ADR-0015, point 10).
      const id = randomUUID();
      await client.query(
        `INSERT INTO receivables.payments (id, tenant_id, debt_id, amount_cents, method, operation_number, paid_on, status, reported_by_contact_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)`,
        [id, companyId, debts[0].id, amountCents, method, operationNumber, paidOn, actor.contactId]);
      await this.audit(client, companyId, actor, "capture", { paymentId: id, amountCents });
      const balance = debts.reduce((total, debt) => total + num(debt.balance_cents), 0);
      return { pending: { id, customer, amountCents, method, operationNumber, paidOn } satisfies PendingPayment, customerBalanceCents: balance };
    }
    const result = await this.apply(client, companyId, debts, amountCents, { method, operationNumber, paidOn, contactId: actor.contactId });
    await this.audit(client, companyId, actor, "record_payment", { amountCents, applied: result.applied.length });
    return { customer, ...result, customerBalanceCents: debts.reduce((total, debt) => total + num(debt.balance_cents), 0) };
  }

  /** Validating a capture: anyone in the team, with their name in the log (point 11). */
  async decidePayment(client: QueryClient, companyId: string, actor: { contactId: number | null; portalUserId: string | null }, paymentId: string, approve: boolean) {
    const { rows } = await client.query(
      `SELECT payment.*, debt.customer_id FROM receivables.payments AS payment JOIN receivables.debts AS debt ON debt.id = payment.debt_id
        WHERE payment.tenant_id = $1 AND payment.id = $2 FOR UPDATE OF payment`, [companyId, paymentId]);
    const payment = rows[0];
    if (!payment) throw new CollectionsError("not_found");
    if (payment.status !== "pending") throw new CollectionsError("already_decided", { status: payment.status });
    const customer = await client.query("SELECT name FROM commerce.customers WHERE id = $1", [payment.customer_id]);
    if (!approve) {
      await client.query(
        "UPDATE receivables.payments SET status = 'rejected', decided_by_contact_id = $3, decided_at = CURRENT_TIMESTAMP WHERE tenant_id = $1 AND id = $2",
        [companyId, paymentId, actor.contactId]);
      await this.audit(client, companyId, actor, "reject_payment", { paymentId });
      return { approved: false, customer: String(customer.rows[0]?.name ?? "") };
    }
    const debts = await client.query(
      `SELECT * FROM receivables.debts WHERE tenant_id = $1 AND customer_id = $2 AND status = 'open'
        ORDER BY (id = $3) DESC, due_on, created_at FOR UPDATE`, [companyId, payment.customer_id, payment.debt_id]);
    if (!debts.rows.length) throw new CollectionsError("no_debt", { customer: customer.rows[0]?.name });
    const result = await this.apply(client, companyId, debts.rows, num(payment.amount_cents), {
      method: String(payment.method) as PaymentMethod, operationNumber: optional(payment.operation_number), paidOn: day(payment.paid_on),
      contactId: actor.contactId, paymentId,
    });
    await this.audit(client, companyId, actor, "approve_payment", { paymentId, applied: result.applied.length });
    return {
      approved: true,
      customer: String(customer.rows[0]?.name ?? ""),
      ...result,
      customerBalanceCents: debts.rows.reduce((total, debt) => total + num(debt.balance_cents), 0),
    };
  }

  /** Prepares a reminder: the data and tone; the Worker writes the text (ADR-0015, points 4–8). */
  private async remind(client: QueryClient, companyId: string, companyName: string, actor: { contactId: number; portalUserId: null }, payload: Record<string, unknown>) {
    const debts = await this.debtsFor(client, companyId, payload);
    const debt = debts[0];
    const rule = await client.query(
      `SELECT customer.phone, COALESCE(rules.do_not_contact, FALSE) AS do_not_contact FROM commerce.customers AS customer
         LEFT JOIN receivables.customer_rules AS rules ON rules.tenant_id = customer.tenant_id AND rules.customer_id = customer.id
        WHERE customer.id = $1`, [debt.customer_id]);
    if (rule.rows[0]?.do_not_contact) throw new CollectionsError("do_not_contact", { customer: debt.customer });
    const phone = optional(rule.rows[0]?.phone);
    if (!phone) throw new CollectionsError("no_phone", { customer: debt.customer });
    const settings = await this.settings(companyId, client);
    const today = this.today();
    const summary = this.summary({ ...debt, phone }, today);
    const tone = toneFor(summary.daysLate, summary.remindersSent, settings.maxReminders);
    await client.query(
      `INSERT INTO receivables.reminders (id, tenant_id, debt_id, channel, tone, contact_id) VALUES ($1, $2, $3, 'prepared', $4, $5)`,
      [randomUUID(), companyId, debt.id, tone, actor.contactId]);
    await client.query(
      `UPDATE receivables.debts SET reminders_sent = reminders_sent + 1, last_reminder_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = $1 AND id = $2`, [companyId, debt.id]);
    await this.audit(client, companyId, actor, "remind", { debtId: debt.id, tone });
    return {
      companyName,
      debt: summary,
      customerBalanceCents: debts.reduce((total, row) => total + num(row.balance_cents), 0),
      openDebts: debts.length,
      tone,
      lastReminder: summary.remindersSent + 1 >= settings.maxReminders,
      outsideWindow: !insideWindow(this.now(), settings),
      payment: { yapePhone: settings.yapePhone, plinPhone: settings.plinPhone, bankText: settings.bankText, paymentLink: settings.paymentLink },
    };
  }

  private async answer(companyId: string, type: CollectionsQueryType, period: PaidPeriod | undefined) {
    if (type === "paid") {
      const today = this.today();
      const from = period === "today" ? today
        : period === "week" ? addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7))
        : `${today.slice(0, 7)}-01`;
      const { rows } = await this.query(
        `SELECT payment.amount_cents, payment.method, payment.paid_on, customer.name AS customer
           FROM receivables.payments AS payment
           JOIN receivables.debts AS debt ON debt.id = payment.debt_id
           JOIN commerce.customers AS customer ON customer.id = debt.customer_id
          WHERE payment.tenant_id = $1 AND payment.status = 'confirmed' AND payment.method <> 'nota_credito' AND payment.paid_on >= $2
          ORDER BY payment.paid_on DESC, payment.created_at DESC LIMIT 50`, [companyId, from]);
      const payments = rows.map((row) => ({ customer: String(row.customer), amountCents: num(row.amount_cents), method: String(row.method), paidOn: day(row.paid_on) }));
      return { period: period ?? "week", totalCents: payments.reduce((total, payment) => total + payment.amountCents, 0), payments };
    }
    const snapshot = await this.snapshot(companyId);
    if (type === "owed") {
      return { totalCents: snapshot.totalCents, buckets: snapshot.buckets, customers: new Set(snapshot.debts.map((debt) => debt.customer)).size,
        lateCount: snapshot.debts.filter((debt) => debt.daysLate > 0).length };
    }
    const byCustomer = new Map<string, { customer: string; phone: string | null; balanceCents: number; oldestDaysLate: number; buckets: Buckets; escalated: boolean }>();
    for (const debt of snapshot.debts) {
      const entry = byCustomer.get(debt.customer) ?? { customer: debt.customer, phone: debt.phone, balanceCents: 0, oldestDaysLate: debt.daysLate, buckets: emptyBuckets(), escalated: false };
      entry.balanceCents += debt.balanceCents;
      entry.oldestDaysLate = Math.max(entry.oldestDaysLate, debt.daysLate);
      entry.buckets[agingBucket(debt.daysLate)] += debt.balanceCents;
      entry.escalated ||= debt.escalated;
      byCustomer.set(debt.customer, entry);
    }
    return { customers: [...byCustomer.values()].sort((a, b) => b.balanceCents - a.balanceCents).slice(0, 10), totalCents: snapshot.totalCents };
  }

  /**
   * Brings in what other agents recorded: Sales Cat's credit sales and FacturaYa's credit
   * invoices since activation, and credit notes against them (points 2 and 16). Each source
   * creates one debt; a sale with its invoice counts once.
   */
  async sync(companyId: string): Promise<{ added: number; creditNotes: number; available: boolean }> {
    let added = 0;
    let creditNotes = 0;
    const settings = await this.query("SELECT documents_since, default_due_days FROM receivables.settings WHERE tenant_id = $1", [companyId]);
    if (!settings.rows.length) return { added, creditNotes, available: false };
    const dueDays = num(settings.rows[0].default_due_days ?? 30);
    const since = day(settings.rows[0].documents_since);

    const sales = await this.query(
      `SELECT sale.id, sale.number, sale.customer_id, sale.customer_name, sale.balance_cents, sale.total_cents, sale.sold_at, sale.invoice_number
         FROM sales.sales AS sale
        WHERE sale.tenant_id = $1 AND sale.status = 'confirmed' AND sale.payment_method = 'credito' AND sale.balance_cents > 0
          AND NOT EXISTS (SELECT 1 FROM receivables.debts AS debt WHERE debt.tenant_id = $1 AND debt.source_ref = 'sale:' || sale.id::text)
          -- Its invoice already came in from FacturaYa as a debt.
          AND NOT EXISTS (SELECT 1 FROM receivables.debts AS debt WHERE debt.tenant_id = $1 AND debt.source = 'invoice'
                           AND sale.invoice_number IS NOT NULL AND debt.document_number = sale.invoice_number)
        LIMIT 200`, [companyId]);
    for (const sale of sales.rows) {
      const ok = await this.transaction(async (client) => {
        const customerId = sale.customer_id ? String(sale.customer_id)
          : await this.customer(client, companyId, optional(sale.customer_name) ?? "Cliente varios", { docNumber: null, phone: null, contactId: null });
        const issued = limaDate(new Date(String(sale.sold_at)));
        const { rows } = await client.query(
          `INSERT INTO receivables.debts (id, tenant_id, customer_id, source, source_ref, document_number, description, amount_cents, balance_cents, issued_on, due_on)
           VALUES ($1, $2, $3, 'sale', $4, $5, $6, $7, $7, $8, $9)
           ON CONFLICT (tenant_id, source_ref) WHERE source_ref IS NOT NULL DO NOTHING RETURNING id`,
          [randomUUID(), companyId, customerId, `sale:${sale.id}`, optional(sale.invoice_number), `Venta N° ${sale.number}`,
            num(sale.balance_cents), issued, addDays(issued, dueDays)]);
        return rows.length > 0;
      });
      if (ok) added++;
    }
    await this.query(
      `UPDATE receivables.debts AS debt SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
         FROM sales.sales AS sale
        WHERE debt.tenant_id = $1 AND debt.status = 'open' AND debt.source = 'sale' AND debt.source_ref = 'sale:' || sale.id::text
          AND sale.status = 'cancelled'`, [companyId]);

    if (!this.documents) return { added, creditNotes, available: false };
    const documents = await this.documents.read(companyId, since);
    if (!documents) return { added, creditNotes, available: false };
    for (const document of documents.filter((entry) => entry.kind === "invoice")) {
      if (document.kind !== "invoice" || document.status !== "accepted" || !document.credit) continue;
      const amount = document.outstandingCents ?? document.totalCents;
      if (amount <= 0) continue;
      const ok = await this.transaction(async (client) => {
        // Already a debt through its Sales Cat sale.
        const viaSale = await client.query(
          "SELECT 1 FROM receivables.debts WHERE tenant_id = $1 AND source = 'sale' AND document_number = $2 LIMIT 1", [companyId, document.number]);
        if (viaSale.rows.length) return false;
        const customerId = await this.customer(client, companyId, document.customer.name, {
          docNumber: document.customer.docNumber && /^([0-9]{8}|[0-9]{11})$/.test(document.customer.docNumber) ? document.customer.docNumber : null,
          docType: document.customer.docType === "6" || document.customer.docType === "1" ? document.customer.docType : null,
          phone: null, contactId: null,
        });
        const { rows } = await client.query(
          `INSERT INTO receivables.debts (id, tenant_id, customer_id, source, source_ref, document_number, description, amount_cents, balance_cents, issued_on, due_on)
           VALUES ($1, $2, $3, 'invoice', $4, $5, NULL, $6, $6, $7, $8)
           ON CONFLICT (tenant_id, source_ref) WHERE source_ref IS NOT NULL DO NOTHING RETURNING id`,
          [randomUUID(), companyId, customerId, `invoice:${document.id}`, document.number, amount, document.issueDate,
            document.firstDueDate ?? addDays(document.issueDate, dueDays)]);
        return rows.length > 0;
      });
      if (ok) added++;
    }
    for (const note of documents) {
      if (note.kind !== "credit_note" || note.status !== "accepted" || !note.relatedNumber || note.totalCents <= 0) continue;
      const applied = await this.transaction(async (client) => {
        const done = await client.query("SELECT 1 FROM receivables.payments WHERE tenant_id = $1 AND source_ref = $2",
          [companyId, `credit_note:${note.id}`]);
        if (done.rows.length) return false;
        const debts = await client.query(
          `SELECT * FROM receivables.debts WHERE tenant_id = $1 AND document_number = $2 AND status = 'open' ORDER BY created_at LIMIT 1 FOR UPDATE`,
          [companyId, note.relatedNumber]);
        if (!debts.rows.length) return false;
        const result = await this.apply(client, companyId, debts.rows, note.totalCents, {
          method: "nota_credito", operationNumber: note.number, paidOn: this.today(), contactId: null, sourceRef: `credit_note:${note.id}`,
        });
        return result.applied.length > 0;
      });
      if (applied) creditNotes++;
    }
    return { added, creditNotes, available: true };
  }

  private async audit(db: Db, companyId: string, actor: { contactId: number | null; portalUserId: string | null }, action: string, details: Record<string, unknown>) {
    await this.query(
      "INSERT INTO receivables.audit_log (id, tenant_id, contact_id, portal_user_id, action, details) VALUES ($1, $2, $3, $4, $5, $6)",
      [randomUUID(), companyId, actor.contactId, actor.portalUserId, action, JSON.stringify(details)], db);
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
      destroy = !(error instanceof CollectionsError);
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release(destroy);
    }
  }
}

const strip = (debt: CollectionsSnapshot["debts"][number]): DebtSummary => ({
  id: debt.id, customer: debt.customer, phone: debt.phone, balanceCents: debt.balanceCents, amountCents: debt.amountCents, dueOn: debt.dueOn,
  daysLate: debt.daysLate, document: debt.document, description: debt.description, remindersSent: debt.remindersSent,
});

const cents = (value: unknown) => (value === null || value === undefined || value === "" ? null : Math.round(Number(value) * 100));

type CreditWire = {
  id?: unknown; kind?: unknown; number?: unknown; status?: unknown; issue_date?: unknown; total?: unknown; payment_method?: unknown;
  outstanding_amount?: unknown; installments?: Array<{ due_date?: unknown; amount?: unknown }>; related_number?: unknown;
  customer?: { document_type?: unknown; document_number?: unknown; name?: unknown };
};

/** FacturaYa's `GET /api/issued-documents` with the company's own token: credit terms and credit notes. */
export class FacturayaCreditDocumentReader implements CreditDocumentReader {
  constructor(
    private readonly pool: Db,
    private readonly cipher: { decrypt(encrypted: string): string },
    private readonly baseUrl: string,
    private readonly log: RoleLog,
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async read(tenantId: string, since: string): Promise<CreditDocument[] | null> {
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
      this.log("vps_collections_token_unreadable");
      return null;
    }
    const documents: CreditDocument[] = [];
    let seen = 0;
    for (let page = 1; page <= 20; page++) {
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.baseUrl}/api/issued-documents?from=${since}&page=${page}`, {
          signal: AbortSignal.timeout(15_000),
          headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
        });
      } catch {
        this.log("vps_collections_facturaya_unreachable");
        return null;
      }
      if (!response.ok) {
        this.log("vps_collections_facturaya_error", { status: response.status });
        return null;
      }
      const body = await response.json() as { data?: CreditWire[]; meta?: { total?: number } };
      for (const wire of body.data ?? []) {
        seen++;
        if (typeof wire.id !== "string") continue;
        const status = String(wire.status ?? "");
        const totalCents = cents(wire.total) ?? 0;
        if (wire.kind === "credit_note") {
          documents.push({ kind: "credit_note", id: wire.id, number: String(wire.number ?? ""), status,
            relatedNumber: typeof wire.related_number === "string" ? wire.related_number : null, totalCents });
        } else if (wire.kind === "invoice") {
          const dues = (wire.installments ?? []).map((entry) => String(entry.due_date ?? "")).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)).sort();
          documents.push({
            kind: "invoice", id: wire.id, number: String(wire.number ?? ""), status,
            issueDate: /^\d{4}-\d{2}-\d{2}$/.test(String(wire.issue_date)) ? String(wire.issue_date) : since,
            customer: {
              docType: typeof wire.customer?.document_type === "string" ? wire.customer.document_type : null,
              docNumber: typeof wire.customer?.document_number === "string" ? wire.customer.document_number : null,
              name: String(wire.customer?.name ?? "Cliente varios").trim() || "Cliente varios",
            },
            totalCents,
            credit: wire.payment_method === "credito",
            outstandingCents: cents(wire.outstanding_amount),
            firstDueDate: dues[0] ?? null,
          });
        }
      }
      if (!body.data?.length || seen >= Number(body.meta?.total ?? 0)) return documents;
    }
    return documents;
  }
}
