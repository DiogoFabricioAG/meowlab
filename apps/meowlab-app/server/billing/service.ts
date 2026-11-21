import { type MercadoPagoApi, type MercadoPagoPayment, type Preapproval, verifyWebhookSignature } from "./mercadopago";
import { PricingError, quote } from "./pricing";
import type { BillingStore, OrderRow, SubscriptionRow, SubscriptionStatus } from "./store";

export type BillingLog = (event: string, details?: Record<string, unknown>) => void;

const LIVE: readonly SubscriptionStatus[] = ["creating", "pending", "authorized", "paused"];
const REFERENCE_PREFIX = "meowlab:";
const ORDER_REFERENCE_PREFIX = "meowlab-order:";
const PREPAID_MONTHS = new Set([1, 3, 6]);

function mapStatus(status: string): SubscriptionStatus {
  if (status === "authorized" || status === "paused" || status === "cancelled" || status === "pending") return status;
  return "pending";
}

export type SubscribeResult =
  | { status: "redirect"; checkoutUrl: string }
  | { status: "already_subscribed" }
  | { status: "invalid_agents"; reason: string }
  | { status: "invalid_months" }
  | { status: "invalid_email" }
  | { status: "test_account_mismatch" }
  | { status: "provider_error" };

export type WebhookResult = { status: number; outcome: string };

/**
 * Tells the platform what a company paid for and until when (signed portal route). Returns
 * false when it could not confirm; the next reconciliation tries again.
 */
export interface EntitlementSink {
  apply(tenantId: string, agents: string[], activeUntil: Date): Promise<boolean>;
}

export class BillingService {
  constructor(
    private readonly store: BillingStore,
    private readonly mercadopago: MercadoPagoApi,
    private readonly options: {
      appUrl: string;
      webhookSecret?: string;
      testMode?: boolean;
      log: BillingLog;
      now?: () => Date;
      entitlements?: EntitlementSink;
    },
  ) {}

  private now() {
    return this.options.now?.() ?? new Date();
  }

  async catalog() {
    return this.store.catalog();
  }

  /** The catalog, plus the company's subscription and prepaid period when a company is given. */
  async status(tenantId: string | null) {
    const [{ agents, discounts }, subscription, prepaidOrder] = await Promise.all([
      this.store.catalog(),
      tenantId ? this.store.currentFor(tenantId) : Promise.resolve(null),
      tenantId && this.store.currentOrderFor ? this.store.currentOrderFor(tenantId) : Promise.resolve(null),
    ]);
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
      prepaid: prepaidOrder && prepaidOrder.periodEnd
        ? {
            months: prepaidOrder.months,
            agents: prepaidOrder.agents,
            amountCents: prepaidOrder.amountCents,
            paidUntil: prepaidOrder.periodEnd.toISOString(),
            active: prepaidOrder.periodEnd > now,
          }
        : null,
    };
  }

  /** The caller checks that `userId` is the owner of `tenantId` (ADR-0010). */
  async subscribe(userId: string, tenantId: string, requestedAgents: string[], payerEmail: string): Promise<SubscribeResult> {
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

    const current = await this.store.currentFor(tenantId);
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
    if (await this.store.createSubscription({ id, userId, tenantId, agents: priced.agents, amountCents: priced.totalCents, externalReference, payerEmail: email }) === "already_live") {
      return { status: "already_subscribed" };
    }
    const names = agents.filter((agent) => priced.agents.includes(agent.key)).map((agent) => agent.name);
    try {
      const preapproval = await this.mercadopago.createPreapproval({
        reason: subscriptionReason(names),
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
      const reason = error instanceof Error ? error.message.slice(0, 80) : "error";
      this.options.log("billing_subscription_failed", { reason });
      // Mercado Pago refuses to mix a test seller with a real buyer (and vice versa).
      if (/payer and collector must be real or test/i.test(reason)) return { status: "test_account_mismatch" };
      return { status: "provider_error" };
    }
  }

  async cancel(tenantId: string): Promise<"cancelled" | "not_found"> {
    const current = await this.store.currentFor(tenantId);
    if (!current || !LIVE.includes(current.status) || !current.providerRef) return "not_found";
    await this.mercadopago.cancelPreapproval(current.providerRef);
    await this.store.updateStatus(current.id, "cancelled", null);
    this.options.log("billing_subscription_cancelled");
    return "cancelled";
  }

  /** One-time Checkout Pro preference for 1, 3 or 6 months (supports Yape). */
  async createPrepaidOrder(
    userId: string,
    tenantId: string,
    requestedAgents: string[],
    months: number,
    payerEmail: string,
  ): Promise<SubscribeResult> {
    if (!PREPAID_MONTHS.has(months)) return { status: "invalid_months" };
    const email = payerEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return { status: "invalid_email" };
    if (!this.store.createOrder || !this.store.markOrderCreated || !this.store.markOrderFailed || !this.mercadopago.createPreference) {
      return { status: "provider_error" };
    }

    const current = await this.store.currentFor(tenantId);
    if (current && LIVE.includes(current.status) && current.status !== "pending" && current.status !== "creating") {
      return { status: "already_subscribed" };
    }

    const { agents, discounts } = await this.store.catalog();
    let priced;
    try {
      priced = quote(requestedAgents, agents, discounts);
    } catch (error) {
      if (error instanceof PricingError) return { status: "invalid_agents", reason: error.code };
      throw error;
    }

    const totalCents = priced.totalCents * months;
    const id = crypto.randomUUID();
    const externalReference = `${ORDER_REFERENCE_PREFIX}${id}`;
    await this.store.createOrder({
      id,
      userId,
      tenantId,
      agents: priced.agents,
      months,
      amountCents: totalCents,
      externalReference,
    });

    const names = agents.filter((agent) => priced.agents.includes(agent.key)).map((agent) => agent.name);
    try {
      const preference = await this.mercadopago.createPreference({
        title: subscriptionReason(names),
        externalReference,
        payerEmail: email,
        amount: totalCents / 100,
        backUrl: `${this.options.appUrl}/plan?pago=retorno_unico&order=${id}`,
        notificationUrl: `${this.options.appUrl}/api/webhooks/mercadopago`,
      });
      if (!preference.init_point) throw new Error("unexpected_preference");
      await this.store.markOrderCreated(id, preference.id, preference.init_point);
      this.options.log("billing_prepaid_order_created", { agents: priced.agents, months, amountCents: totalCents });
      return { status: "redirect", checkoutUrl: preference.init_point };
    } catch (error) {
      await this.store.markOrderFailed(id);
      const reason = error instanceof Error ? error.message.slice(0, 80) : "error";
      this.options.log("billing_prepaid_order_failed", { reason });
      if (/payer and collector must be real or test/i.test(reason)) return { status: "test_account_mismatch" };
      return { status: "provider_error" };
    }
  }

  async applyOrderEntitlements(order: OrderRow): Promise<void> {
    const sink = this.options.entitlements;
    const until = order.periodEnd;
    if (!sink || !until || until <= this.now()) return;
    if (order.entitlementAppliedUntil && order.entitlementAppliedUntil >= until) return;
    if (await sink.apply(order.tenantId, order.agents, until)) {
      await this.store.markOrderEntitlementApplied?.(order.id, until);
      this.options.log("billing_entitlement_applied", { agents: order.agents, months: order.months });
    } else {
      this.options.log("billing_entitlement_pending");
    }
  }

  async processPayment(payment: MercadoPagoPayment): Promise<string> {
    const ref = payment.external_reference;
    if (!ref || !ref.startsWith(ORDER_REFERENCE_PREFIX)) return "ignored";
    const order = await this.store.orderByExternalReference?.(ref);
    if (!order) return "unknown_order";
    if (payment.status === "rejected" || payment.status === "cancelled") {
      await this.store.markOrderRejected?.(order.id);
      return "rejected";
    }
    if (payment.status !== "approved") return "pending";

    const amountCents = Math.round(Number(payment.transaction_amount) * 100);
    if (payment.currency_id !== "PEN" || amountCents !== order.amountCents) {
      this.options.log("billing_order_amount_mismatch", { expected: order.amountCents, received: amountCents });
      return "amount_mismatch";
    }
    if (!this.store.grantOrderPayment) return "provider_error";

    const paidAt = new Date(payment.date_approved ?? payment.date_created ?? this.now().toISOString());
    const { result, order: updated } = await this.store.grantOrderPayment({
      orderId: order.id,
      providerPaymentId: String(payment.id),
      paidAt: Number.isNaN(paidAt.getTime()) ? this.now() : paidAt,
    });
    if (result === "granted") {
      this.options.log("billing_prepaid_granted", { months: order.months, amountCents });
    }
    if (updated) await this.applyOrderEntitlements(updated);
    return result === "granted" ? "payment_granted" : "payment_duplicate";
  }

  async syncPrepaid(tenantId: string, orderId?: string, paymentId?: string): Promise<void> {
    if (paymentId && this.mercadopago.getPayment) {
      const payment = await this.mercadopago.getPayment(paymentId);
      if (payment.external_reference?.startsWith(ORDER_REFERENCE_PREFIX)) {
        const order = await this.store.orderByExternalReference?.(payment.external_reference);
        if (order && order.tenantId === tenantId) {
          await this.processPayment(payment);
          return;
        }
      }
    }
    if (orderId && this.store.orderById && this.mercadopago.searchPaymentsByReference) {
      const order = await this.store.orderById(orderId);
      if (!order || order.tenantId !== tenantId) return;
      if (order.status === "approved") {
        await this.applyOrderEntitlements(order);
        return;
      }
      for (const payment of await this.mercadopago.searchPaymentsByReference(order.externalReference)) {
        await this.processPayment(payment);
      }
    }
  }

  async syncFor(tenantId: string) {
    const current = await this.store.currentFor(tenantId);
    if (current?.providerRef && LIVE.includes(current.status)) await this.sync(current);
  }

  /**
   * Switches the paid agents on in the company until the end of the paid period. Cancelling
   * or a failed charge never shortens it: the agents stop when that date passes.
   */
  async applyEntitlements(subscription: SubscriptionRow): Promise<void> {
    const sink = this.options.entitlements;
    const until = subscription.paidUntil;
    if (!sink || !subscription.tenantId || !until || until <= this.now()) return;
    if (subscription.entitlementAppliedUntil && subscription.entitlementAppliedUntil >= until) return;
    if (await sink.apply(subscription.tenantId, subscription.agents, until)) {
      await this.store.markEntitlementApplied(subscription.id, until);
      this.options.log("billing_entitlement_applied", { agents: subscription.agents });
    } else {
      this.options.log("billing_entitlement_pending");
    }
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
    const fresh = await this.store.byProviderRef(subscription.providerRef);
    if (fresh) await this.applyEntitlements(fresh);
  }

  async reconcileAll(): Promise<number> {
    let synced = 0;
    for (const subscription of await this.store.reconcilable()) {
      try {
        if (subscription.providerRef && LIVE.includes(subscription.status)) await this.sync(subscription);
        else await this.applyEntitlements(subscription);
        synced++;
      } catch (error) {
        this.options.log("billing_reconcile_failed", { reason: error instanceof Error ? error.message.slice(0, 80) : "error" });
      }
    }
    for (const order of await this.store.reconcilableOrders?.() ?? []) {
      try {
        if (order.status === "approved") await this.applyOrderEntitlements(order);
        else if (this.mercadopago.searchPaymentsByReference) {
          for (const payment of await this.mercadopago.searchPaymentsByReference(order.externalReference)) {
            await this.processPayment(payment);
          }
        }
        synced++;
      } catch (error) {
        this.options.log("billing_order_reconcile_failed", { reason: error instanceof Error ? error.message.slice(0, 80) : "error" });
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
      if (topic === "payment") {
        if (this.mercadopago.getPayment) {
          const payment = await this.mercadopago.getPayment(dataId);
          outcome = await this.processPayment(payment);
        }
      } else {
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
      }
    } catch {
      outcome = "provider_error";
    }
    await this.store.recordWebhook({ topic: topic || "unknown", resourceRef: dataId, requestId: input.requestId, outcome });
    // 5xx makes Mercado Pago retry; anything we understood is acknowledged.
    return { status: outcome === "provider_error" ? 503 : 200, outcome };
  }
}

/** Mercado Pago rejects a preapproval reason longer than 60 characters. */
export const REASON_MAX = 60;

/** «MeowLab · Invoice Cat + Sales Cat» while it fits; «MeowLab · 4 gatos» otherwise. */
export function subscriptionReason(names: readonly string[]): string {
  const listed = `MeowLab · ${names.join(" + ")}`;
  if (listed.length <= REASON_MAX) return listed;
  return `MeowLab · ${names.length} gatos`.slice(0, REASON_MAX);
}
