import { type MercadoPagoApi, type Preapproval, verifyWebhookSignature } from "./mercadopago";
import { PricingError, quote } from "./pricing";
import type { BillingStore, SubscriptionRow, SubscriptionStatus } from "./store";

export type BillingLog = (event: string, details?: Record<string, unknown>) => void;

const LIVE: readonly SubscriptionStatus[] = ["creating", "pending", "authorized", "paused"];
const REFERENCE_PREFIX = "meowlab:";

function mapStatus(status: string): SubscriptionStatus {
  if (status === "authorized" || status === "paused" || status === "cancelled" || status === "pending") return status;
  return "pending";
}

export type SubscribeResult =
  | { status: "redirect"; checkoutUrl: string }
  | { status: "already_subscribed" }
  | { status: "invalid_agents"; reason: string }
  | { status: "invalid_email" }
  | { status: "provider_error" };

export type WebhookResult = { status: number; outcome: string };

export class BillingService {
  constructor(
    private readonly store: BillingStore,
    private readonly mercadopago: MercadoPagoApi,
    private readonly options: { appUrl: string; webhookSecret?: string; testMode?: boolean; log: BillingLog; now?: () => Date },
  ) {}

  private now() {
    return this.options.now?.() ?? new Date();
  }

  async catalog() {
    return this.store.catalog();
  }

  async status(userId: string) {
    const [{ agents, discounts }, subscription] = await Promise.all([this.store.catalog(), this.store.currentFor(userId)]);
    const now = this.now();
    return {
      agents,
      discounts,
      testMode: Boolean(this.options.testMode),
      subscription: subscription && {
        status: subscription.status,
        agents: subscription.agents,
        amountCents: subscription.amountCents,
        payerEmail: subscription.payerEmail,
        paidUntil: subscription.paidUntil?.toISOString() ?? null,
        nextPaymentAt: subscription.nextPaymentAt?.toISOString() ?? null,
        active: Boolean(subscription.paidUntil && subscription.paidUntil > now),
        checkoutUrl: subscription.status === "pending" ? subscription.checkoutUrl : null,
      },
    };
  }

  async subscribe(userId: string, requestedAgents: string[], payerEmail: string): Promise<SubscribeResult> {
    const email = payerEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return { status: "invalid_email" };
    const { agents, discounts } = await this.store.catalog();
    let priced;
    try {
      priced = quote(requestedAgents, agents, discounts);
    } catch (error) {
      if (error instanceof PricingError) return { status: "invalid_agents", reason: error.code };
      throw error;
    }

    const current = await this.store.currentFor(userId);
    if (current && LIVE.includes(current.status)) {
      // A checkout that was never completed can be reopened instead of creating another one.
      if (current.status === "pending" && current.checkoutUrl
        && current.amountCents === priced.totalCents && current.payerEmail === email) {
        return { status: "redirect", checkoutUrl: current.checkoutUrl };
      }
      if (current.status !== "pending" && current.status !== "creating") return { status: "already_subscribed" };
      // A stale pending checkout (other plan or email) is replaced.
      if (current.providerRef) {
        await this.mercadopago.cancelPreapproval(current.providerRef).catch(() => undefined);
      }
      await this.store.updateStatus(current.id, "cancelled", null);
    }

    const id = crypto.randomUUID();
    const externalReference = `${REFERENCE_PREFIX}${id}`;
    if (await this.store.createSubscription({ id, userId, agents: priced.agents, amountCents: priced.totalCents, externalReference, payerEmail: email }) === "already_live") {
      return { status: "already_subscribed" };
    }
    const names = agents.filter((agent) => priced.agents.includes(agent.key)).map((agent) => agent.name).join(" + ");
    try {
      const preapproval = await this.mercadopago.createPreapproval({
        reason: `MeowLab · ${names}`,
        externalReference,
        payerEmail: email,
        amount: priced.totalCents / 100,
        backUrl: `${this.options.appUrl}/?pago=retorno`,
      });
      if (preapproval.external_reference !== externalReference || !preapproval.init_point) throw new Error("unexpected_preapproval");
      await this.store.markCreated(id, preapproval.id, preapproval.init_point, mapStatus(preapproval.status));
      this.options.log("billing_subscription_created", { agents: priced.agents, amountCents: priced.totalCents });
      return { status: "redirect", checkoutUrl: preapproval.init_point };
    } catch (error) {
      await this.store.markFailed(id);
      this.options.log("billing_subscription_failed", { reason: error instanceof Error ? error.message.slice(0, 80) : "error" });
      return { status: "provider_error" };
    }
  }

  async cancel(userId: string): Promise<"cancelled" | "not_found"> {
    const current = await this.store.currentFor(userId);
    if (!current || !LIVE.includes(current.status) || !current.providerRef) return "not_found";
    await this.mercadopago.cancelPreapproval(current.providerRef);
    await this.store.updateStatus(current.id, "cancelled", null);
    this.options.log("billing_subscription_cancelled");
    return "cancelled";
  }

  async syncFor(userId: string) {
    const current = await this.store.currentFor(userId);
    if (current?.providerRef && LIVE.includes(current.status)) await this.sync(current);
  }

  /**
   * Reads the subscription and its charges from Mercado Pago and grants one month per
   * approved charge whose amount matches. Idempotent: safe from webhooks, the return
   * page and the periodic reconciliation alike.
   */
  async sync(subscription: SubscriptionRow): Promise<void> {
    if (!subscription.providerRef) return;
    const preapproval: Preapproval = await this.mercadopago.getPreapproval(subscription.providerRef);
    if (preapproval.external_reference !== subscription.externalReference) {
      this.options.log("billing_sync_reference_mismatch");
      return;
    }
    const next = preapproval.next_payment_date ? new Date(preapproval.next_payment_date) : null;
    await this.store.updateStatus(subscription.id, mapStatus(preapproval.status), next && !Number.isNaN(next.getTime()) ? next : null);

    for (const charge of await this.mercadopago.authorizedPayments(subscription.providerRef)) {
      if (String(charge.preapproval_id) !== subscription.providerRef) continue;
      const approved = charge.payment?.status === "approved";
      if (!approved) continue;
      const amountCents = Math.round(Number(charge.transaction_amount) * 100);
      if (charge.currency_id !== "PEN" || amountCents !== subscription.amountCents) {
        this.options.log("billing_charge_amount_mismatch", { expected: subscription.amountCents, received: amountCents });
        continue;
      }
      const paidAt = new Date(charge.debit_date ?? charge.date_created ?? this.now().toISOString());
      const result = await this.store.grantMonth({
        subscriptionId: subscription.id,
        provider: "mercadopago",
        providerRef: String(charge.id),
        amountCents,
        paidAt: Number.isNaN(paidAt.getTime()) ? this.now() : paidAt,
      });
      if (result === "granted") this.options.log("billing_month_granted", { amountCents });
    }
  }

  async reconcileAll(): Promise<number> {
    let synced = 0;
    for (const subscription of await this.store.reconcilable()) {
      try {
        await this.sync(subscription);
        synced++;
      } catch {
        this.options.log("billing_reconcile_failed");
      }
    }
    return synced;
  }

  /** Mercado Pago notification. Only the signature and a fresh read from the API count. */
  async webhook(input: { query: URLSearchParams; signature: string | null; requestId: string | null; body: unknown }): Promise<WebhookResult> {
    if (!this.options.webhookSecret) return { status: 503, outcome: "not_configured" };
    const body = (input.body ?? {}) as { type?: unknown; topic?: unknown; data?: { id?: unknown } };
    const topic = String(input.query.get("type") ?? input.query.get("topic") ?? body.type ?? body.topic ?? "");
    const dataId = input.query.get("data.id") ?? input.query.get("id");
    if (!dataId || !/^[A-Za-z0-9_-]{1,64}$/.test(dataId)) return { status: 400, outcome: "invalid" };
    const valid = await verifyWebhookSignature({
      secret: this.options.webhookSecret,
      signatureHeader: input.signature,
      requestId: input.requestId,
      dataId,
    });
    if (!valid) {
      this.options.log("billing_webhook_rejected");
      return { status: 401, outcome: "invalid_signature" };
    }

    let outcome = "ignored";
    try {
      let providerRef: string | null = null;
      if (topic === "subscription_preapproval") providerRef = dataId;
      else if (topic === "subscription_authorized_payment") providerRef = String((await this.mercadopago.getAuthorizedPayment(dataId)).preapproval_id);
      if (providerRef) {
        const subscription = await this.store.byProviderRef(providerRef);
        if (subscription) {
          await this.sync(subscription);
          outcome = "synced";
        } else {
          outcome = "unknown_subscription";
        }
      }
    } catch {
      outcome = "provider_error";
    }
    await this.store.recordWebhook({ topic: topic || "unknown", resourceRef: dataId, requestId: input.requestId, outcome });
    // 5xx makes Mercado Pago retry; anything we understood is acknowledged.
    return { status: outcome === "provider_error" ? 503 : 200, outcome };
  }
}
