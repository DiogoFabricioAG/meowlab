import type { CatalogAgent, Discount } from "./pricing";

export type SubscriptionStatus = "creating" | "pending" | "authorized" | "paused" | "cancelled" | "failed";

export type SubscriptionRow = {
  id: string;
  userId: string;
  /** The company the subscription pays for; null on subscriptions from before 13/11/2026. */
  tenantId: string | null;
  agents: string[];
  amountCents: number;
  status: SubscriptionStatus;
  externalReference: string;
  providerRef: string | null;
  payerEmail: string;
  checkoutUrl: string | null;
  paidUntil: Date | null;
  nextPaymentAt: Date | null;
  /** End of the paid period last confirmed by the platform. */
  entitlementAppliedUntil: Date | null;
  createdAt: Date;
};

export type OrderStatus = "creating" | "pending" | "approved" | "rejected" | "failed";

export type OrderRow = {
  id: string;
  userId: string;
  tenantId: string;
  agents: string[];
  months: number;
  amountCents: number;
  status: OrderStatus;
  externalReference: string;
  preferenceId: string | null;
  checkoutUrl: string | null;
  providerPaymentId: string | null;
  paidAt: Date | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  entitlementAppliedUntil: Date | null;
  createdAt: Date;
};

export type GrantResult = "granted" | "duplicate";

export interface BillingStore {
  catalog(): Promise<{ agents: CatalogAgent[]; discounts: Discount[] }>;
  /** The company's live subscription (creating/pending/authorized/paused) or, failing that, its latest one. */
  currentFor(tenantId: string): Promise<SubscriptionRow | null>;
  createSubscription(input: {
    id: string;
    userId: string;
    tenantId: string;
    agents: string[];
    amountCents: number;
    externalReference: string;
    payerEmail: string;
  }): Promise<"created" | "already_live">;
  markCreated(id: string, providerRef: string, checkoutUrl: string | null, status: SubscriptionStatus): Promise<void>;
  markFailed(id: string): Promise<void>;
  byProviderRef(providerRef: string): Promise<SubscriptionRow | null>;
  updateStatus(id: string, status: SubscriptionStatus, nextPaymentAt: Date | null): Promise<void>;
  /** Atomic: one provider payment grants at most one month, chained after the paid period. */
  grantMonth(input: { subscriptionId: string; provider: "mercadopago"; providerRef: string; amountCents: number; paidAt: Date }): Promise<GrantResult>;
  recordWebhook(input: { topic: string; resourceRef: string; requestId: string | null; outcome: string }): Promise<void>;
  markEntitlementApplied(id: string, until: Date): Promise<void>;
  /** Live subscriptions to read again, plus any paid period the platform has not confirmed yet. */
  reconcilable(): Promise<SubscriptionRow[]>;
  metrics(): Promise<{ live: number; paying: number; monthlyRevenueCents: number; paymentsLast30Days: number; revenueLast30DaysCents: number }>;
  currentOrderFor?(tenantId: string): Promise<OrderRow | null>;
  createOrder?(input: {
    id: string;
    userId: string;
    tenantId: string;
    agents: string[];
    months: number;
    amountCents: number;
    externalReference: string;
  }): Promise<void>;
  markOrderCreated?(id: string, preferenceId: string, checkoutUrl: string | null): Promise<void>;
  markOrderFailed?(id: string): Promise<void>;
  markOrderRejected?(id: string): Promise<void>;
  orderById?(id: string): Promise<OrderRow | null>;
  orderByExternalReference?(externalReference: string): Promise<OrderRow | null>;
  grantOrderPayment?(input: {
    orderId: string;
    providerPaymentId: string;
    paidAt: Date;
  }): Promise<{ result: GrantResult; order: OrderRow | null }>;
  markOrderEntitlementApplied?(id: string, until: Date): Promise<void>;
  reconcilableOrders?(): Promise<OrderRow[]>;
}

type Query = (sql: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }>;
type Client = { query: Query; release(): void };
export type BillingPool = { query: Query; connect(): Promise<Client> };

const ORDER_COLUMNS = `id, user_id, tenant_id, agents, months, amount_cents, status, external_reference, preference_id,
  checkout_url, provider_payment_id, paid_at, period_start, period_end, entitlement_applied_until, created_at`;

function toOrderRow(row: Record<string, unknown>): OrderRow {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    tenantId: String(row.tenant_id),
    agents: row.agents as string[],
    months: Number(row.months),
    amountCents: Number(row.amount_cents),
    status: row.status as OrderStatus,
    externalReference: String(row.external_reference),
    preferenceId: (row.preference_id as string | null) ?? null,
    checkoutUrl: (row.checkout_url as string | null) ?? null,
    providerPaymentId: (row.provider_payment_id as string | null) ?? null,
    paidAt: (row.paid_at as Date | null) ?? null,
    periodStart: (row.period_start as Date | null) ?? null,
    periodEnd: (row.period_end as Date | null) ?? null,
    entitlementAppliedUntil: (row.entitlement_applied_until as Date | null) ?? null,
    createdAt: row.created_at as Date,
  };
}

const COLUMNS = `id, user_id, tenant_id, agents, amount_cents, status, external_reference, provider_ref, payer_email,
  checkout_url, paid_until, next_payment_at, entitlement_applied_until, created_at`;

function toRow(row: Record<string, unknown>): SubscriptionRow {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    tenantId: (row.tenant_id as string | null) ?? null,
    agents: row.agents as string[],
    amountCents: Number(row.amount_cents),
    status: row.status as SubscriptionStatus,
    externalReference: String(row.external_reference),
    providerRef: (row.provider_ref as string | null) ?? null,
    payerEmail: String(row.payer_email),
    checkoutUrl: (row.checkout_url as string | null) ?? null,
    paidUntil: (row.paid_until as Date | null) ?? null,
    nextPaymentAt: (row.next_payment_at as Date | null) ?? null,
    entitlementAppliedUntil: (row.entitlement_applied_until as Date | null) ?? null,
    createdAt: row.created_at as Date,
  };
}

export class PgBillingStore implements BillingStore {
  constructor(private readonly pool: BillingPool) {}

  async catalog() {
    const [agents, discounts] = await Promise.all([
      this.pool.query("SELECT key, name, description, price_cents, available FROM billing_agents ORDER BY sort"),
      this.pool.query("SELECT min_agents, percent FROM billing_discounts ORDER BY min_agents"),
    ]);
    return {
      agents: agents.rows.map((row) => ({
        key: String(row.key),
        name: String(row.name),
        description: String(row.description),
        priceCents: Number(row.price_cents),
        available: Boolean(row.available),
      })),
      discounts: discounts.rows.map((row) => ({ minAgents: Number(row.min_agents), percent: Number(row.percent) })),
    };
  }

  async currentFor(tenantId: string) {
    const { rows } = await this.pool.query(
      `SELECT ${COLUMNS} FROM billing_subscriptions WHERE tenant_id = $1
        ORDER BY (status IN ('creating', 'pending', 'authorized', 'paused')) DESC, created_at DESC LIMIT 1`,
      [tenantId],
    );
    return rows[0] ? toRow(rows[0]) : null;
  }

  async createSubscription(input: Parameters<BillingStore["createSubscription"]>[0]) {
    try {
      await this.pool.query(
        `INSERT INTO billing_subscriptions (id, user_id, tenant_id, agents, amount_cents, status, external_reference, payer_email)
         VALUES ($1, $2, $3, $4, $5, 'creating', $6, $7)`,
        [input.id, input.userId, input.tenantId, input.agents, input.amountCents, input.externalReference, input.payerEmail],
      );
      return "created" as const;
    } catch (error) {
      if ((error as { code?: string }).code === "23505") return "already_live" as const;
      throw error;
    }
  }

  async markCreated(id: string, providerRef: string, checkoutUrl: string | null, status: SubscriptionStatus) {
    await this.pool.query(
      `UPDATE billing_subscriptions SET provider_ref = $2, checkout_url = $3, status = $4, updated_at = now() WHERE id = $1`,
      [id, providerRef, checkoutUrl, status],
    );
  }

  async markFailed(id: string) {
    await this.pool.query(`UPDATE billing_subscriptions SET status = 'failed', updated_at = now() WHERE id = $1 AND status = 'creating'`, [id]);
  }

  async byProviderRef(providerRef: string) {
    const { rows } = await this.pool.query(`SELECT ${COLUMNS} FROM billing_subscriptions WHERE provider_ref = $1`, [providerRef]);
    return rows[0] ? toRow(rows[0]) : null;
  }

  async updateStatus(id: string, status: SubscriptionStatus, nextPaymentAt: Date | null) {
    await this.pool.query(
      `UPDATE billing_subscriptions SET status = $2, next_payment_at = $3, last_synced_at = now(), updated_at = now() WHERE id = $1`,
      [id, status, nextPaymentAt],
    );
  }

  async grantMonth(input: Parameters<BillingStore["grantMonth"]>[0]): Promise<GrantResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        "SELECT paid_until FROM billing_subscriptions WHERE id = $1 FOR UPDATE",
        [input.subscriptionId],
      );
      if (!rows[0]) throw new Error("subscription_not_found");
      const paidUntil = rows[0].paid_until as Date | null;
      const start = paidUntil && paidUntil > input.paidAt ? paidUntil : input.paidAt;
      const inserted = await client.query(
        `INSERT INTO billing_payments (id, subscription_id, provider, provider_ref, amount_cents, currency, paid_at, period_start, period_end)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'PEN', $5, $6, $6::timestamptz + interval '1 month')
         ON CONFLICT (provider, provider_ref) DO NOTHING
         RETURNING period_end`,
        [input.subscriptionId, input.provider, input.providerRef, input.amountCents, input.paidAt, start],
      );
      if (!inserted.rows[0]) {
        await client.query("ROLLBACK");
        return "duplicate";
      }
      await client.query(
        "UPDATE billing_subscriptions SET paid_until = $2, updated_at = now() WHERE id = $1",
        [input.subscriptionId, inserted.rows[0].period_end],
      );
      await client.query("COMMIT");
      return "granted";
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async recordWebhook(input: Parameters<BillingStore["recordWebhook"]>[0]) {
    await this.pool.query(
      `INSERT INTO billing_webhook_events (provider, topic, resource_ref, request_id, outcome) VALUES ('mercadopago', $1, $2, $3, $4)`,
      [input.topic.slice(0, 64), input.resourceRef.slice(0, 128), input.requestId?.slice(0, 128) ?? null, input.outcome],
    );
  }

  async markEntitlementApplied(id: string, until: Date) {
    await this.pool.query(
      `UPDATE billing_subscriptions SET entitlement_applied_until = GREATEST(entitlement_applied_until, $2), updated_at = now() WHERE id = $1`,
      [id, until],
    );
  }

  async reconcilable() {
    const { rows } = await this.pool.query(
      `SELECT ${COLUMNS} FROM billing_subscriptions
        WHERE (provider_ref IS NOT NULL AND status IN ('pending', 'authorized', 'paused'))
           OR (tenant_id IS NOT NULL AND paid_until > now()
               -- JavaScript dates carry milliseconds; PostgreSQL keeps microseconds.
               AND (entitlement_applied_until IS NULL OR entitlement_applied_until < date_trunc('milliseconds', paid_until)))`,
    );
    return rows.map(toRow);
  }

  async metrics() {
    const { rows } = await this.pool.query(
      `SELECT
         (SELECT count(*)::int FROM billing_subscriptions WHERE status IN ('pending', 'authorized', 'paused')) AS live,
         (SELECT count(*)::int FROM billing_subscriptions WHERE paid_until > now()) AS paying,
         (SELECT coalesce(sum(amount_cents), 0)::int FROM billing_subscriptions WHERE status = 'authorized' AND paid_until > now()) AS mrr,
         (SELECT count(*)::int FROM billing_payments WHERE paid_at > now() - interval '30 days') AS payments30,
         (SELECT coalesce(sum(amount_cents), 0)::int FROM billing_payments WHERE paid_at > now() - interval '30 days') AS revenue30`,
    );
    const row = rows[0] ?? {};
    return {
      live: Number(row.live ?? 0),
      paying: Number(row.paying ?? 0),
      monthlyRevenueCents: Number(row.mrr ?? 0),
      paymentsLast30Days: Number(row.payments30 ?? 0),
      revenueLast30DaysCents: Number(row.revenue30 ?? 0),
    };
  }

  async currentOrderFor(tenantId: string) {
    const { rows } = await this.pool.query(
      `SELECT ${ORDER_COLUMNS} FROM billing_orders
        WHERE tenant_id = $1 AND status = 'approved'
        ORDER BY period_end DESC NULLS LAST, created_at DESC LIMIT 1`,
      [tenantId],
    );
    return rows[0] ? toOrderRow(rows[0]) : null;
  }

  async createOrder(input: Parameters<NonNullable<BillingStore["createOrder"]>>[0]) {
    await this.pool.query(
      `INSERT INTO billing_orders (id, user_id, tenant_id, agents, months, amount_cents, status, external_reference)
       VALUES ($1, $2, $3, $4, $5, $6, 'creating', $7)`,
      [input.id, input.userId, input.tenantId, input.agents, input.months, input.amountCents, input.externalReference],
    );
  }

  async markOrderCreated(id: string, preferenceId: string, checkoutUrl: string | null) {
    await this.pool.query(
      `UPDATE billing_orders SET preference_id = $2, checkout_url = $3, status = 'pending', updated_at = now() WHERE id = $1`,
      [id, preferenceId, checkoutUrl],
    );
  }

  async markOrderFailed(id: string) {
    await this.pool.query(`UPDATE billing_orders SET status = 'failed', updated_at = now() WHERE id = $1 AND status = 'creating'`, [id]);
  }

  async markOrderRejected(id: string) {
    await this.pool.query(`UPDATE billing_orders SET status = 'rejected', updated_at = now() WHERE id = $1 AND status = 'pending'`, [id]);
  }

  async orderById(id: string) {
    const { rows } = await this.pool.query(`SELECT ${ORDER_COLUMNS} FROM billing_orders WHERE id = $1`, [id]);
    return rows[0] ? toOrderRow(rows[0]) : null;
  }

  async orderByExternalReference(externalReference: string) {
    const { rows } = await this.pool.query(`SELECT ${ORDER_COLUMNS} FROM billing_orders WHERE external_reference = $1`, [externalReference]);
    return rows[0] ? toOrderRow(rows[0]) : null;
  }

  async grantOrderPayment(input: { orderId: string; providerPaymentId: string; paidAt: Date }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `SELECT ${ORDER_COLUMNS} FROM billing_orders WHERE id = $1 FOR UPDATE`,
        [input.orderId],
      );
      if (!rows[0]) {
        await client.query("ROLLBACK");
        return { result: "duplicate" as const, order: null };
      }
      const order = toOrderRow(rows[0]);
      if (order.providerPaymentId || order.status === "approved") {
        await client.query("ROLLBACK");
        return { result: "duplicate" as const, order };
      }
      const dup = await client.query(
        "SELECT 1 FROM billing_orders WHERE provider_payment_id = $1 LIMIT 1",
        [input.providerPaymentId],
      );
      if (dup.rows[0]) {
        await client.query("ROLLBACK");
        return { result: "duplicate" as const, order };
      }
      const paidRows = await client.query(
        `SELECT GREATEST(
           COALESCE((SELECT MAX(paid_until) FROM billing_subscriptions WHERE tenant_id = $1), to_timestamp(0)),
           COALESCE((SELECT MAX(period_end) FROM billing_orders WHERE tenant_id = $1 AND status = 'approved'), to_timestamp(0))
         ) AS current_end`,
        [order.tenantId],
      );
      const currentEnd = paidRows.rows[0]?.current_end as Date | null;
      const start = currentEnd && currentEnd > input.paidAt ? currentEnd : input.paidAt;
      const updated = await client.query(
        `UPDATE billing_orders
            SET status = 'approved',
                provider_payment_id = $2,
                paid_at = $3,
                period_start = $4,
                period_end = $4::timestamptz + ($5 || ' months')::interval,
                updated_at = now()
          WHERE id = $1 AND provider_payment_id IS NULL
          RETURNING ${ORDER_COLUMNS}`,
        [order.id, input.providerPaymentId, input.paidAt, start, String(order.months)],
      );
      await client.query("COMMIT");
      return { result: "granted" as const, order: updated.rows[0] ? toOrderRow(updated.rows[0]) : null };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async markOrderEntitlementApplied(id: string, until: Date) {
    await this.pool.query(
      `UPDATE billing_orders SET entitlement_applied_until = GREATEST(entitlement_applied_until, $2), updated_at = now() WHERE id = $1`,
      [id, until],
    );
  }

  async reconcilableOrders() {
    const { rows } = await this.pool.query(
      `SELECT ${ORDER_COLUMNS} FROM billing_orders
        WHERE (status = 'pending' AND preference_id IS NOT NULL AND created_at > now() - interval '7 days')
           OR (status = 'approved' AND period_end > now()
               AND (entitlement_applied_until IS NULL OR entitlement_applied_until < date_trunc('milliseconds', period_end)))`,
    );
    return rows.map(toOrderRow);
  }
}
