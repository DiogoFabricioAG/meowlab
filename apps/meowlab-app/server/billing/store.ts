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
}

type Query = (sql: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }>;
type Client = { query: Query; release(): void };
export type BillingPool = { query: Query; connect(): Promise<Client> };

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
}
