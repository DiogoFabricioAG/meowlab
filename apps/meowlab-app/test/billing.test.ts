import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { verifyWebhookSignature, type AuthorizedPayment, type MercadoPagoApi, type Preapproval } from "../server/billing/mercadopago";
import { addOneMonth, discountFor, PricingError, quote, type CatalogAgent } from "../server/billing/pricing";
import { BillingService } from "../server/billing/service";
import type { BillingStore, SubscriptionRow, SubscriptionStatus } from "../server/billing/store";

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
  payments = new Map<string, { subscriptionId: string; periodEnd: Date }>();
  webhooks: string[] = [];
  async catalog() { return { agents: catalog.map((a) => ({ ...a, available: a.key === "invoice" })), discounts }; }
  async currentFor(userId: string) {
    const mine = this.subs.filter((s) => s.userId === userId);
    return mine.find((s) => ["creating", "pending", "authorized", "paused"].includes(s.status)) ?? mine.at(-1) ?? null;
  }
  async createSubscription(input: Parameters<BillingStore["createSubscription"]>[0]) {
    if (this.subs.some((s) => s.userId === input.userId && ["creating", "pending", "authorized", "paused"].includes(s.status))) return "already_live" as const;
    this.subs.push({ ...input, status: "creating", providerRef: null, checkoutUrl: null, paidUntil: null, nextPaymentAt: null, createdAt: new Date() });
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
  async reconcilable() { return this.subs.filter((s) => s.providerRef && ["pending", "authorized", "paused"].includes(s.status)); }
  async metrics() { return { live: 0, paying: 0, monthlyRevenueCents: 0, paymentsLast30Days: 0, revenueLast30DaysCents: 0 }; }
}

class FakeMercadoPago implements MercadoPagoApi {
  preapprovals = new Map<string, Preapproval>();
  charges: AuthorizedPayment[] = [];
  created: Array<Parameters<MercadoPagoApi["createPreapproval"]>[0]> = [];
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
}

function setup(webhookSecret?: string) {
  const store = new MemoryStore();
  const mp = new FakeMercadoPago();
  const log = vi.fn();
  const service = new BillingService(store, mp, { appUrl: "https://app.meowlab.tech", webhookSecret, log, now: () => new Date("2026-11-11T12:00:00Z") });
  return { store, mp, service, log };
}

describe("billing service", () => {
  it("prices on the server and opens a Mercado Pago checkout", async () => {
    const { service, mp, store } = setup();
    const result = await service.subscribe("u1", ["invoice"], "pagador@test.com");
    expect(result).toEqual({ status: "redirect", checkoutUrl: "https://mp.example/checkout/pre_1" });
    expect(mp.created[0]).toMatchObject({ amount: 39, payerEmail: "pagador@test.com", reason: "MeowLab · Invoice Cat", backUrl: "https://app.meowlab.tech/?pago=retorno" });
    expect(mp.created[0].externalReference).toMatch(/^meowlab:/);
    expect(store.subs[0]).toMatchObject({ status: "pending", amountCents: 3900, providerRef: "pre_1" });
  });

  it("refuses agents that are not for sale and bad e-mails", async () => {
    const { service } = setup();
    expect(await service.subscribe("u1", ["sales"], "a@b.co")).toEqual({ status: "invalid_agents", reason: "unavailable_agent" });
    expect(await service.subscribe("u1", ["invoice"], "no-es-correo")).toEqual({ status: "invalid_email" });
  });

  it("reopens an unfinished checkout instead of creating a second subscription", async () => {
    const { service, mp } = setup();
    await service.subscribe("u1", ["invoice"], "a@b.co");
    expect(await service.subscribe("u1", ["invoice"], "a@b.co")).toEqual({ status: "redirect", checkoutUrl: "https://mp.example/checkout/pre_1" });
    expect(mp.created).toHaveLength(1);
  });

  it("grants one month per approved charge, never twice, and only for the right amount", async () => {
    const { service, mp, store } = setup();
    await service.subscribe("u1", ["invoice"], "a@b.co");
    mp.preapprovals.get("pre_1")!.status = "authorized";
    mp.charges.push(
      { id: 7001, preapproval_id: "pre_1", status: "processed", transaction_amount: 39, currency_id: "PEN", debit_date: "2026-11-11T12:00:00Z", payment: { id: 1, status: "approved" } },
      { id: 7002, preapproval_id: "pre_1", status: "processed", transaction_amount: 1, currency_id: "PEN", debit_date: "2026-11-11T12:00:00Z", payment: { id: 2, status: "approved" } },
      { id: 7003, preapproval_id: "pre_1", status: "scheduled", transaction_amount: 39, currency_id: "PEN", payment: { id: 3, status: "rejected" } },
    );
    await service.syncFor("u1");
    await service.syncFor("u1");
    expect(store.subs[0].status).toBe("authorized");
    expect(store.subs[0].paidUntil?.toISOString()).toBe("2026-12-11T12:00:00.000Z");
    expect(store.payments.size).toBe(1);
    expect((await service.status("u1")).subscription).toMatchObject({ active: true, status: "authorized" });
  });

  it("ignores a provider resource that belongs to another reference", async () => {
    const { service, mp, store } = setup();
    await service.subscribe("u1", ["invoice"], "a@b.co");
    mp.preapprovals.get("pre_1")!.external_reference = "metodia:otra";
    mp.charges.push({ id: 9, preapproval_id: "pre_1", status: "processed", transaction_amount: 39, currency_id: "PEN", payment: { status: "approved" } });
    await service.syncFor("u1");
    expect(store.payments.size).toBe(0);
  });

  it("only trusts signed webhooks and re-reads the resource", async () => {
    const secret = "whsec";
    const { service, mp, store } = setup(secret);
    await service.subscribe("u1", ["invoice"], "a@b.co");
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
    await service.subscribe("u1", ["invoice"], "a@b.co");
    store.subs[0].paidUntil = new Date("2026-12-11T00:00:00Z");
    expect(await service.cancel("u1")).toBe("cancelled");
    expect(mp.preapprovals.get("pre_1")!.status).toBe("cancelled");
    expect((await service.status("u1")).subscription).toMatchObject({ status: "cancelled", active: true });
  });
});

describe("billing service errors", () => {
  it("explains when a real buyer meets a test seller", async () => {
    const { service, mp } = setup();
    mp.createPreapproval = async () => { throw new Error("mercadopago_400_Both payer and collector must be real or test users"); };
    expect(await service.subscribe("u1", ["invoice"], "real@gmail.com")).toEqual({ status: "test_account_mismatch" });
  });
});
