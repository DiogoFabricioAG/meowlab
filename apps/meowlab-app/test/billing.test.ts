import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { verifyWebhookSignature, type AuthorizedPayment, type CheckoutPreference, type MercadoPagoApi, type MercadoPagoPayment, type Preapproval } from "../server/billing/mercadopago";
import { addOneMonth, discountFor, PricingError, quote, type CatalogAgent } from "../server/billing/pricing";
import { BillingService } from "../server/billing/service";
import type { BillingStore, OrderRow, OrderStatus, SubscriptionRow, SubscriptionStatus } from "../server/billing/store";

const catalog: CatalogAgent[] = [
  { key: "invoice", name: "Invoice Cat", description: "", priceCents: 3900, available: true },
  { key: "sales", name: "Sales Cat", description: "", priceCents: 5900, available: true },
  { key: "stock", name: "Stock Cat", description: "", priceCents: 2900, available: true },
  { key: "reorder", name: "Reorder Cat", description: "", priceCents: 2500, available: true },
  { key: "support", name: "Support Cat", description: "", priceCents: 3900, available: true },
  { key: "collections", name: "Collections Cat", description: "", priceCents: 2500, available: false },
];
const discounts = [
  { minAgents: 1, percent: 0 },
  { minAgents: 2, percent: 10 },
  { minAgents: 3, percent: 15 },
  { minAgents: 5, percent: 20 },
];

describe("pricing (informe ejecutivo 2027-2029)", () => {
  it("matches the report's worked examples", () => {
    expect(quote(["invoice"], catalog, discounts).totalCents).toBe(3900);
    expect(quote(["sales", "stock"], catalog, discounts).totalCents).toBe(7920);
    expect(quote(["invoice", "sales", "stock"], catalog, discounts).totalCents).toBe(10795);
    const all = { ...catalog[5], available: true };
    expect(quote(catalog.map((a) => a.key), [...catalog.slice(0, 5), all], discounts).totalCents).toBe(17280);
  });

  it("prices the full 7-cat catalog (including tender at S/ 35) with 20% discount from 5 agents", () => {
    const fullCatalog: CatalogAgent[] = [
      ...catalog.slice(0, 5),
      { ...catalog[5], available: true },
      { key: "tender", name: "Tender Cat", description: "", priceCents: 3500, available: true },
    ];
    expect(fullCatalog).toHaveLength(7);
    expect(fullCatalog.every((a) => a.available)).toBe(true);
    // 39 + 59 + 29 + 25 + 39 + 25 + 35 = 251.00 PEN -> 20% discount = 200.80 PEN (20080 cents)
    const seven = quote(fullCatalog.map((a) => a.key), fullCatalog, discounts);
    expect(seven.discountPercent).toBe(20);
    expect(seven.subtotalCents).toBe(25100);
    expect(seven.totalCents).toBe(20080);

    // 5 agents -> 20% discount
    const five = quote(["invoice", "sales", "stock", "reorder", "tender"], fullCatalog, discounts);
    expect(five.discountPercent).toBe(20);
    expect(five.subtotalCents).toBe(18700);
    expect(five.totalCents).toBe(14960);
  });

  it("uses the highest tier reached and rejects bad selections", () => {
    expect(discountFor(4, discounts)).toBe(15);
    expect(discountFor(6, discounts)).toBe(20);
    expect(() => quote([], catalog, discounts)).toThrow(PricingError);
    expect(() => quote(["invoice", "invoice"], catalog, discounts)).toThrow("duplicate_agent");
    expect(() => quote(["nope"], catalog, discounts)).toThrow("unknown_agent");
    expect(() => quote(["collections"], catalog, discounts)).toThrow("unavailable_agent");
  });

  it("adds a calendar month, clamping to the month's last day", () => {
    expect(addOneMonth(new Date("2026-01-31T10:00:00Z")).toISOString()).toBe("2026-02-28T10:00:00.000Z");
    expect(addOneMonth(new Date("2026-11-11T00:00:00Z")).toISOString()).toBe("2026-12-11T00:00:00.000Z");
  });
});

describe("webhook signature", () => {
  const secret = "test-webhook-secret";
  const sign = (manifest: string) => createHmac("sha256", secret).update(manifest).digest("hex");

  it("accepts the documented manifest and lowercases data.id", async () => {
    const v1 = sign("id:abc123;request-id:req-1;ts:1704908010;");
    expect(await verifyWebhookSignature({ secret, signatureHeader: `ts=1704908010,v1=${v1}`, requestId: "req-1", dataId: "ABC123" })).toBe(true);
  });

  it("rejects a tampered id, another secret or a malformed header", async () => {
    const v1 = sign("id:abc123;request-id:req-1;ts:1704908010;");
    expect(await verifyWebhookSignature({ secret, signatureHeader: `ts=1704908010,v1=${v1}`, requestId: "req-1", dataId: "abc124" })).toBe(false);
    expect(await verifyWebhookSignature({ secret: "other", signatureHeader: `ts=1704908010,v1=${v1}`, requestId: "req-1", dataId: "abc123" })).toBe(false);
    expect(await verifyWebhookSignature({ secret, signatureHeader: "ts=abc,v1=zz", requestId: "req-1", dataId: "abc123" })).toBe(false);
    expect(await verifyWebhookSignature({ secret, signatureHeader: null, requestId: "req-1", dataId: "abc123" })).toBe(false);
  });
});

class MemoryStore implements BillingStore {
  subs: SubscriptionRow[] = [];
  orders: OrderRow[] = [];
  payments = new Map<string, { subscriptionId: string; periodEnd: Date }>();
  orderPayments = new Map<string, { orderId: string; periodEnd: Date }>();
  webhooks: string[] = [];
  async catalog() { return { agents: catalog.map((a) => ({ ...a, available: a.key === "invoice" || a.key === "sales" })), discounts }; }
  async currentFor(tenantId: string) {
    const mine = this.subs.filter((s) => s.tenantId === tenantId);
    return mine.find((s) => ["creating", "pending", "authorized", "paused"].includes(s.status)) ?? mine.at(-1) ?? null;
  }
  async createSubscription(input: Parameters<BillingStore["createSubscription"]>[0]) {
    if (this.subs.some((s) => s.tenantId === input.tenantId && ["creating", "pending", "authorized", "paused"].includes(s.status))) return "already_live" as const;
    this.subs.push({ ...input, status: "creating", providerRef: null, checkoutUrl: null, paidUntil: null, nextPaymentAt: null,
      entitlementAppliedUntil: null, createdAt: new Date() });
    return "created" as const;
  }
  async markCreated(id: string, providerRef: string, checkoutUrl: string | null, status: SubscriptionStatus) {
    Object.assign(this.subs.find((s) => s.id === id)!, { providerRef, checkoutUrl, status });
  }
  async markFailed(id: string) { this.subs.find((s) => s.id === id)!.status = "failed"; }
  async byProviderRef(ref: string) { return this.subs.find((s) => s.providerRef === ref) ?? null; }
  async updateStatus(id: string, status: SubscriptionStatus, next: Date | null) { Object.assign(this.subs.find((s) => s.id === id)!, { status, nextPaymentAt: next }); }
  async grantMonth(input: Parameters<BillingStore["grantMonth"]>[0]) {
    const key = `${input.provider}:${input.providerRef}`;
    if (this.payments.has(key)) return "duplicate" as const;
    const sub = this.subs.find((s) => s.id === input.subscriptionId)!;
    const start = sub.paidUntil && sub.paidUntil > input.paidAt ? sub.paidUntil : input.paidAt;
    sub.paidUntil = addOneMonth(start);
    this.payments.set(key, { subscriptionId: sub.id, periodEnd: sub.paidUntil });
    return "granted" as const;
  }
  async recordWebhook(input: Parameters<BillingStore["recordWebhook"]>[0]) { this.webhooks.push(`${input.topic}:${input.outcome}`); }
  async markEntitlementApplied(id: string, until: Date) { this.subs.find((s) => s.id === id)!.entitlementAppliedUntil = until; }
  async reconcilable() {
    return this.subs.filter((s) => (s.providerRef && ["pending", "authorized", "paused"].includes(s.status))
      || (s.tenantId && s.paidUntil && (!s.entitlementAppliedUntil || s.entitlementAppliedUntil < s.paidUntil)));
  }
  async metrics() { return { live: 0, paying: 0, monthlyRevenueCents: 0, paymentsLast30Days: 0, revenueLast30DaysCents: 0 }; }

  async createOrder(input: Parameters<NonNullable<BillingStore["createOrder"]>>[0]) {
    this.orders.push({
      ...input,
      status: "creating",
      preferenceId: null,
      checkoutUrl: null,
      providerPaymentId: null,
      paidAt: null,
      periodStart: null,
      periodEnd: null,
      entitlementAppliedUntil: null,
      createdAt: new Date(),
    });
  }
  async markOrderCreated(id: string, providerRef: string, checkoutUrl: string) {
    Object.assign(this.orders.find((o) => o.id === id)!, { preferenceId: providerRef, checkoutUrl, status: "pending" as const });
  }
  async markOrderFailed(id: string) { this.orders.find((o) => o.id === id)!.status = "failed"; }
  async markOrderRejected(id: string) { this.orders.find((o) => o.id === id)!.status = "rejected"; }
  async orderById(id: string) {
    return this.orders.find((o) => o.id === id) ?? null;
  }
  async orderByExternalReference(externalReference: string) {
    return this.orders.find((o) => o.externalReference === externalReference) ?? null;
  }
  async currentOrderFor(tenantId: string) {
    return [...this.orders].reverse().find((o) => o.tenantId === tenantId && o.status === "approved") ?? null;
  }
  async grantOrderPayment(input: Parameters<NonNullable<BillingStore["grantOrderPayment"]>>[0]) {
    if (this.orderPayments.has(input.providerPaymentId)) return { result: "duplicate" as const };
    const order = this.orders.find((o) => o.id === input.orderId)!;
    let base = input.paidAt;
    for (const s of this.subs) {
      if (s.tenantId === order.tenantId && s.paidUntil && s.paidUntil > base) base = s.paidUntil;
    }
    for (const o of this.orders) {
      if (o.tenantId === order.tenantId && o.status === "approved" && o.periodEnd && o.periodEnd > base) base = o.periodEnd;
    }
    let periodEnd = base;
    for (let i = 0; i < order.months; i++) periodEnd = addOneMonth(periodEnd);
    Object.assign(order, {
      status: "approved" as const,
      providerPaymentId: input.providerPaymentId,
      paidAt: input.paidAt,
      periodStart: base,
      periodEnd,
    });
    this.orderPayments.set(input.providerPaymentId, { orderId: order.id, periodEnd });
    return { result: "granted" as const, order: { ...order } };
  }
  async markOrderEntitlementApplied(id: string, until: Date) {
    this.orders.find((o) => o.id === id)!.entitlementAppliedUntil = until;
  }
  async reconcilableOrders() {
    return this.orders.filter(
      (o) => o.status === "pending" || (o.status === "paid" && o.periodEnd && (!o.entitlementAppliedUntil || o.entitlementAppliedUntil < o.periodEnd)),
    );
  }
}

class FakeMercadoPago implements MercadoPagoApi {
  preapprovals = new Map<string, Preapproval>();
  preferences = new Map<string, CheckoutPreference>();
  payments = new Map<string, MercadoPagoPayment>();
  charges: AuthorizedPayment[] = [];
  created: Array<Parameters<MercadoPagoApi["createPreapproval"]>[0]> = [];
  createdPreferences: Array<Parameters<NonNullable<MercadoPagoApi["createPreference"]>>[0]> = [];
  async createPreapproval(input: Parameters<MercadoPagoApi["createPreapproval"]>[0]) {
    this.created.push(input);
    const id = `pre_${this.preapprovals.size + 1}`;
    const preapproval = { id, status: "pending", external_reference: input.externalReference, init_point: `https://mp.example/checkout/${id}` };
    this.preapprovals.set(id, preapproval);
    return preapproval;
  }
  async getPreapproval(id: string) { return this.preapprovals.get(id)!; }
  async cancelPreapproval(id: string) { const p = this.preapprovals.get(id)!; p.status = "cancelled"; return p; }
  async authorizedPayments(id: string) { return this.charges.filter((c) => c.preapproval_id === id); }
  async getAuthorizedPayment(id: string) { return this.charges.find((c) => String(c.id) === id)!; }
  async createPreference(input: Parameters<NonNullable<MercadoPagoApi["createPreference"]>>[0]) {
    this.createdPreferences.push(input);
    const id = `pref_${this.preferences.size + 1}`;
    const pref: CheckoutPreference = { id, init_point: `https://mp.example/checkout/pref/${id}` };
    this.preferences.set(id, pref);
    return pref;
  }
  async getPayment(id: string) {
    const p = this.payments.get(String(id));
    if (!p) throw new Error("mercadopago_404_not_found");
    return p;
  }
  async searchPaymentsByReference(externalReference: string) {
    return [...this.payments.values()].filter((p) => p.external_reference === externalReference);
  }
}

function setup(webhookSecret?: string, sinkWorks = true) {
  const store = new MemoryStore();
  const mp = new FakeMercadoPago();
  const log = vi.fn();
  const entitlements = { apply: vi.fn(async (_tenant: string, _agents: string[], _until: Date) => sinkWorks) };
  const service = new BillingService(store, mp, {
    appUrl: "https://app.meowlab.tech", webhookSecret, log, now: () => new Date("2026-11-11T12:00:00Z"), entitlements,
  });
  return { store, mp, service, log, entitlements };
}

describe("billing service", () => {
  it("prices on the server and opens a Mercado Pago checkout", async () => {
    const { service, mp, store } = setup();
    const result = await service.subscribe("u1", "org_1", ["invoice"], "pagador@test.com");
    expect(result).toEqual({ status: "redirect", checkoutUrl: "https://mp.example/checkout/pre_1" });
    expect(mp.created[0]).toMatchObject({ amount: 39, payerEmail: "pagador@test.com", reason: "MeowLab · Invoice Cat", backUrl: "https://app.meowlab.tech/?pago=retorno" });
    expect(mp.created[0].externalReference).toMatch(/^meowlab:/);
    expect(store.subs[0]).toMatchObject({ status: "pending", amountCents: 3900, providerRef: "pre_1" });
  });

  it("refuses agents that are not for sale and bad e-mails", async () => {
    const { service } = setup();
    expect(await service.subscribe("u1", "org_1", ["stock"], "a@b.co")).toEqual({ status: "invalid_agents", reason: "unavailable_agent" });
    expect(await service.subscribe("u1", "org_1", ["invoice"], "no-es-correo")).toEqual({ status: "invalid_email" });
  });

  it("reopens an unfinished checkout instead of creating a second subscription", async () => {
    const { service, mp } = setup();
    await service.subscribe("u1", "org_1", ["invoice"], "a@b.co");
    expect(await service.subscribe("u1", "org_1", ["invoice"], "a@b.co")).toEqual({ status: "redirect", checkoutUrl: "https://mp.example/checkout/pre_1" });
    expect(mp.created).toHaveLength(1);
  });

  it("grants one month per approved charge, never twice, and only for the right amount", async () => {
    const { service, mp, store } = setup();
    await service.subscribe("u1", "org_1", ["invoice"], "a@b.co");
    mp.preapprovals.get("pre_1")!.status = "authorized";
    mp.charges.push(
      { id: 7001, preapproval_id: "pre_1", status: "processed", transaction_amount: 39, currency_id: "PEN", debit_date: "2026-11-11T12:00:00Z", payment: { id: 1, status: "approved" } },
      { id: 7002, preapproval_id: "pre_1", status: "processed", transaction_amount: 1, currency_id: "PEN", debit_date: "2026-11-11T12:00:00Z", payment: { id: 2, status: "approved" } },
      { id: 7003, preapproval_id: "pre_1", status: "scheduled", transaction_amount: 39, currency_id: "PEN", payment: { id: 3, status: "rejected" } },
    );
    await service.syncFor("org_1");
    await service.syncFor("org_1");
    expect(store.subs[0].status).toBe("authorized");
    expect(store.subs[0].paidUntil?.toISOString()).toBe("2026-12-11T12:00:00.000Z");
    expect(store.payments.size).toBe(1);
    expect((await service.status("org_1")).subscription).toMatchObject({ active: true, status: "authorized" });
  });

  it("ignores a provider resource that belongs to another reference", async () => {
    const { service, mp, store } = setup();
    await service.subscribe("u1", "org_1", ["invoice"], "a@b.co");
    mp.preapprovals.get("pre_1")!.external_reference = "metodia:otra";
    mp.charges.push({ id: 9, preapproval_id: "pre_1", status: "processed", transaction_amount: 39, currency_id: "PEN", payment: { status: "approved" } });
    await service.syncFor("org_1");
    expect(store.payments.size).toBe(0);
  });

  it("only trusts signed webhooks and re-reads the resource", async () => {
    const secret = "whsec";
    const { service, mp, store } = setup(secret);
    await service.subscribe("u1", "org_1", ["invoice"], "a@b.co");
    mp.charges.push({ id: 555, preapproval_id: "pre_1", status: "processed", transaction_amount: 39, currency_id: "PEN", debit_date: "2026-11-11T12:00:00Z", payment: { status: "approved" } });
    const query = new URLSearchParams({ type: "subscription_authorized_payment", "data.id": "555" });
    const bad = await service.webhook({ query, signature: "ts=1,v1=" + "0".repeat(64), requestId: "r1", body: null });
    expect(bad.status).toBe(401);
    expect(store.payments.size).toBe(0);
    const v1 = createHmac("sha256", secret).update("id:555;request-id:r1;ts:1;").digest("hex");
    const good = await service.webhook({ query, signature: `ts=1,v1=${v1}`, requestId: "r1", body: { amount: 999999 } });
    expect(good).toEqual({ status: 200, outcome: "synced" });
    expect(store.payments.size).toBe(1);
  });

  it("refuses webhooks while no secret is configured", async () => {
    const { service } = setup();
    expect((await service.webhook({ query: new URLSearchParams({ "data.id": "1" }), signature: null, requestId: null, body: null })).status).toBe(503);
  });

  it("cancels at Mercado Pago and keeps the paid period", async () => {
    const { service, mp, store } = setup();
    await service.subscribe("u1", "org_1", ["invoice"], "a@b.co");
    store.subs[0].paidUntil = new Date("2026-12-11T00:00:00Z");
    expect(await service.cancel("org_1")).toBe("cancelled");
    expect(mp.preapprovals.get("pre_1")!.status).toBe("cancelled");
    expect((await service.status("org_1")).subscription).toMatchObject({ status: "cancelled", active: true });
  });
});

describe("billing per company (13/11/2026)", () => {
  const approve = (mp: FakeMercadoPago, id: number, amount: number) => mp.charges.push(
    { id, preapproval_id: "pre_1", status: "processed", transaction_amount: amount, currency_id: "PEN", debit_date: "2026-11-11T12:00:00Z", payment: { status: "approved" } });

  it("keeps one live subscription per company, not per account", async () => {
    const { service, store } = setup();
    await service.subscribe("u1", "org_1", ["invoice"], "a@b.co");
    store.subs[0].status = "authorized";
    expect(await service.subscribe("u1", "org_1", ["sales"], "a@b.co")).toEqual({ status: "already_subscribed" });
    expect((await service.subscribe("u1", "org_2", ["sales"], "a@b.co")).status).toBe("redirect");
    expect(store.subs.map((s) => s.tenantId)).toEqual(["org_1", "org_2"]);
    expect((await service.status(null)).subscription).toBeNull();
  });

  it("switches Sales Cat on in the company once the payment is confirmed, until the end of the paid period", async () => {
    const { service, mp, store, entitlements } = setup();
    await service.subscribe("u1", "org_1", ["sales"], "a@b.co");
    await service.syncFor("org_1");
    expect(entitlements.apply).not.toHaveBeenCalled();
    mp.preapprovals.get("pre_1")!.status = "authorized";
    approve(mp, 801, 59);
    await service.syncFor("org_1");
    expect(entitlements.apply).toHaveBeenCalledWith("org_1", ["sales"], new Date("2026-12-11T12:00:00.000Z"));
    expect(store.subs[0].entitlementAppliedUntil?.toISOString()).toBe("2026-12-11T12:00:00.000Z");
    await service.syncFor("org_1");
    expect(entitlements.apply).toHaveBeenCalledTimes(1);
  });

  it("retries the platform on the next reconciliation when it could not confirm", async () => {
    const { service, mp, store, entitlements } = setup(undefined, false);
    await service.subscribe("u1", "org_1", ["sales"], "a@b.co");
    mp.preapprovals.get("pre_1")!.status = "authorized";
    approve(mp, 802, 59);
    await service.syncFor("org_1");
    expect(store.subs[0].entitlementAppliedUntil).toBeNull();
    entitlements.apply.mockResolvedValue(true);
    // Cancelled after paying: still reconciled until the platform confirms the paid period.
    await service.cancel("org_1");
    expect(await service.reconcileAll()).toBe(1);
    expect(store.subs[0].entitlementAppliedUntil?.toISOString()).toBe("2026-12-11T12:00:00.000Z");
    expect(entitlements.apply).toHaveBeenLastCalledWith("org_1", ["sales"], new Date("2026-12-11T12:00:00.000Z"));
  });

  it("never touches subscriptions from before companies, nor expired periods", async () => {
    const { service, store, entitlements } = setup();
    await service.subscribe("u1", "org_1", ["sales"], "a@b.co");
    Object.assign(store.subs[0], { tenantId: null, paidUntil: new Date("2026-12-11T12:00:00Z"), status: "cancelled" });
    await service.applyEntitlements(store.subs[0]);
    Object.assign(store.subs[0], { tenantId: "org_1", paidUntil: new Date("2026-11-01T00:00:00Z") });
    await service.applyEntitlements(store.subs[0]);
    expect(entitlements.apply).not.toHaveBeenCalled();
  });
});

describe("billing service errors", () => {
  it("explains when a real buyer meets a test seller", async () => {
    const { service, mp } = setup();
    mp.createPreapproval = async () => { throw new Error("mercadopago_400_Both payer and collector must be real or test users"); };
    expect(await service.subscribe("u1", "org_1", ["invoice"], "real@gmail.com")).toEqual({ status: "test_account_mismatch" });
  });
});

describe("Mercado Pago client", () => {
  it("walks the charges in pages of 12, the largest the API accepts", async () => {
    const { MercadoPagoClient } = await import("../server/billing/mercadopago");
    const urls: string[] = [];
    const charge = (n: number) => ({ id: n, preapproval_id: "p", status: "processed", transaction_amount: 39, currency_id: "PEN" });
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      const offset = Number(new URL(url).searchParams.get("offset"));
      const results = Array.from({ length: offset === 0 ? 12 : 3 }, (_, i) => charge(offset + i));
      return new Response(JSON.stringify({ results, paging: { total: 15, limit: 12, offset } }));
    }) as unknown as typeof fetch;
    const charges = await new MercadoPagoClient("token", fetchImpl).authorizedPayments("p");
    expect(charges).toHaveLength(15);
    expect(urls.every((url) => new URL(url).searchParams.get("limit") === "12")).toBe(true);
  });
});

import { REASON_MAX, subscriptionReason } from "../server/billing/service";

describe("Mercado Pago: descripción de la suscripción", () => {
  it("lists the cats while it fits and never passes Mercado Pago's 60 characters", () => {
    expect(subscriptionReason(["Invoice Cat"])).toBe("MeowLab · Invoice Cat");
    expect(subscriptionReason(["Invoice Cat", "Sales Cat"])).toBe("MeowLab · Invoice Cat + Sales Cat");
    const all = ["Invoice Cat", "Sales Cat", "Stock Cat", "Reorder Cat", "Support Cat", "Collections Cat"];
    expect(subscriptionReason(all)).toBe("MeowLab · 6 gatos");
    for (let n = 1; n <= all.length; n++) expect(subscriptionReason(all.slice(0, n)).length).toBeLessThanOrEqual(REASON_MAX);
  });
});

describe("prepaid one-time payments (Checkout Pro / Yape)", () => {
  const webhookCall = (secret: string, id: string, requestId = "req-1", ts = "1704908010") => {
    const v1 = createHmac("sha256", secret).update(`id:${id.toLowerCase()};request-id:${requestId};ts:${ts};`).digest("hex");
    return {
      query: new URLSearchParams({ type: "payment", "data.id": id }),
      signature: `ts=${ts},v1=${v1}`,
      requestId,
      body: { type: "payment", data: { id } },
    };
  };

  it("creates a Checkout Pro preference and credits N months when an approved payment arrives", async () => {
    const { service, mp, store, entitlements } = setup("sec-yape");
    const result = await service.createPrepaidOrder("u1", "org_1", ["invoice"], 3, "yape@test.com");
    expect(result).toEqual({ status: "redirect", checkoutUrl: "https://mp.example/checkout/pref/pref_1" });
    expect(mp.createdPreferences[0]).toMatchObject({
      title: "MeowLab · Invoice Cat",
      amount: 117,
      payerEmail: "yape@test.com",
      notificationUrl: "https://app.meowlab.tech/api/webhooks/mercadopago",
    });
    expect(mp.createdPreferences[0].externalReference).toMatch(/^meowlab-order:/);
    expect(mp.createdPreferences[0].title.length).toBeLessThanOrEqual(REASON_MAX);

    const ref = store.orders[0].externalReference;
    mp.payments.set("9001", {
      id: 9001,
      status: "approved",
      external_reference: ref,
      transaction_amount: 117,
      currency_id: "PEN",
      date_approved: "2026-11-11T12:00:00Z",
    });
    expect(await service.webhook(webhookCall("sec-yape", "9001"))).toMatchObject({ status: 200 });

    expect(store.orders[0].status).toBe("approved");
    expect(store.orders[0].periodEnd?.toISOString()).toBe("2027-02-11T12:00:00.000Z");
    expect(entitlements.apply).toHaveBeenCalledWith("org_1", ["invoice"], new Date("2027-02-11T12:00:00.000Z"));
    expect((await service.status("org_1")).prepaid).toMatchObject({
      months: 3,
      agents: ["invoice"],
      amountCents: 11700,
      paidUntil: "2027-02-11T12:00:00.000Z",
      active: true,
    });
  });

  it("does not credit pending or rejected payments", async () => {
    const { service, mp, store, entitlements } = setup("sec-yape");
    await service.createPrepaidOrder("u1", "org_1", ["invoice"], 1, "yape@test.com");
    const ref = store.orders[0].externalReference;

    mp.payments.set("9002", { id: 9002, status: "pending", external_reference: ref, transaction_amount: 39, currency_id: "PEN" });
    mp.payments.set("9003", { id: 9003, status: "rejected", external_reference: ref, transaction_amount: 39, currency_id: "PEN" });
    await service.webhook(webhookCall("sec-yape", "9002"));
    await service.webhook(webhookCall("sec-yape", "9003"));

    expect(store.orders[0].status).toBe("rejected");
    expect(entitlements.apply).not.toHaveBeenCalled();
  });

  it("credits a duplicate payment notification only once", async () => {
    const { service, mp, store, entitlements } = setup("sec-yape");
    await service.createPrepaidOrder("u1", "org_1", ["invoice"], 3, "yape@test.com");
    const ref = store.orders[0].externalReference;

    mp.payments.set("9004", {
      id: 9004,
      status: "approved",
      external_reference: ref,
      transaction_amount: 117,
      currency_id: "PEN",
      date_approved: "2026-11-11T12:00:00Z",
    });
    await service.webhook(webhookCall("sec-yape", "9004"));
    await service.webhook(webhookCall("sec-yape", "9004"));
    await service.syncPrepaid("org_1", store.orders[0].id, "9004");

    expect(store.orders[0].periodEnd?.toISOString()).toBe("2027-02-11T12:00:00.000Z");
    expect(entitlements.apply).toHaveBeenCalledTimes(1);
  });

  it("does not credit when payment amount or currency does not match the order", async () => {
    const { service, mp, store, entitlements } = setup("sec-yape");
    await service.createPrepaidOrder("u1", "org_1", ["invoice"], 3, "yape@test.com");
    const ref = store.orders[0].externalReference;

    mp.payments.set("9005", { id: 9005, status: "approved", external_reference: ref, transaction_amount: 39, currency_id: "PEN" });
    mp.payments.set("9006", { id: 9006, status: "approved", external_reference: ref, transaction_amount: 117, currency_id: "USD" });
    await service.webhook(webhookCall("sec-yape", "9005"));
    await service.webhook(webhookCall("sec-yape", "9006"));

    expect(store.orders[0].status).toBe("pending");
    expect(entitlements.apply).not.toHaveBeenCalled();
  });

  it("ignores payments whose external_reference belongs to another app or unknown order", async () => {
    const { service, mp, store, entitlements } = setup("sec-yape");
    await service.createPrepaidOrder("u1", "org_1", ["invoice"], 1, "yape@test.com");

    mp.payments.set("9007", {
      id: 9007,
      status: "approved",
      external_reference: "foreign-app:order-999",
      transaction_amount: 39,
      currency_id: "PEN",
    });
    expect(await service.webhook(webhookCall("sec-yape", "9007"))).toEqual({ status: 200, outcome: "ignored" });
    expect(store.orders[0].status).toBe("pending");
    expect(store.webhooks).toContain("payment:ignored");
    expect(entitlements.apply).not.toHaveBeenCalled();
  });

  it("returns 401 from /api/webhooks/mercadopago when the signature is invalid", async () => {
    const { createApp } = await import("../server/app");
    const { service } = setup("sec-yape");
    const app = createApp({
      auth: { api: { getSession: async () => null } } as never,
      allowedOrigins: ["https://app.meowlab.tech"],
      tenants: { listForUser: async () => [], roleFor: async () => null } as never,
      billing: service,
    });
    const res = await app.request("/api/webhooks/mercadopago?type=payment&data.id=9001", {
      method: "POST",
      headers: { "x-signature": "ts=1704908010,v1=deadbeef", "x-request-id": "req-bad" },
      body: JSON.stringify({ type: "payment", data: { id: "9001" } }),
    });
    expect(res.status).toBe(401);
  });

  it("blocks prepaid checkout when the company already has a live subscription", async () => {
    const { service, mp, store } = setup("sec-yape");
    await service.subscribe("u1", "org_1", ["invoice"], "sub@test.com");
    mp.preapprovals.get("pre_1")!.status = "authorized";
    await service.syncFor("org_1");
    expect(await service.createPrepaidOrder("u1", "org_1", ["invoice"], 1, "yape@test.com")).toEqual({ status: "already_subscribed" });
    expect(store.orders).toHaveLength(0);
  });
});

