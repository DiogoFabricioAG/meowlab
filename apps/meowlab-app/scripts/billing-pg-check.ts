// Integration check of PgBillingStore against a throwaway PostgreSQL that already has
// migrations-postgres applied (ADR-0007). Never point it at production.
//   BILLING_CHECK_DATABASE_URL=postgres://... npx esbuild scripts/billing-pg-check.ts --bundle \
//     --platform=node --format=esm --packages=external --outfile=build/billing-check.mjs && node build/billing-check.mjs
import pg from "pg";
import { PgBillingStore } from "../server/billing/store";

const pool = new pg.Pool({ connectionString: process.env.BILLING_CHECK_DATABASE_URL });
const store = new PgBillingStore(pool);
let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` -> ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
};

await pool.query(`DELETE FROM billing_payments; DELETE FROM billing_subscriptions; DELETE FROM billing_webhook_events;
  INSERT INTO "user" (id, name, email, "emailVerified") VALUES ('billing-check', 'Check', 'billing-check@meowlab.test', true) ON CONFLICT DO NOTHING;`);

const { agents, discounts } = await store.catalog();
check("catálogo de 6 agentes, sólo Invoice disponible", agents.length === 6 && agents.filter((a) => a.available).map((a) => a.key).join() === "invoice", agents);
check("descuentos 0/10/15/20", discounts.map((d) => d.percent).join() === "0,10,15,20", discounts);

const id = crypto.randomUUID();
check("crea suscripción", await store.createSubscription({ id, userId: "billing-check", agents: ["invoice"], amountCents: 3900, externalReference: `meowlab:${id}`, payerEmail: "a@b.co" }) === "created");
const second = crypto.randomUUID();
check("una sola viva por cuenta", await store.createSubscription({ id: second, userId: "billing-check", agents: ["invoice"], amountCents: 3900, externalReference: `meowlab:${second}`, payerEmail: "a@b.co" }) === "already_live");
await store.markCreated(id, "pre_check_1", "https://mp.example/x", "authorized");

const paidAt = new Date("2026-11-11T12:00:00Z");
const concurrent = await Promise.all(Array.from({ length: 5 }, () =>
  store.grantMonth({ subscriptionId: id, provider: "mercadopago", providerRef: "ap_1", amountCents: 3900, paidAt })));
check("5 notificaciones simultáneas del mismo pago → 1 mes", concurrent.filter((r) => r === "granted").length === 1, concurrent);
let sub = await store.currentFor("billing-check");
check("pagado hasta +1 mes", sub?.paidUntil?.toISOString() === "2026-12-11T12:00:00.000Z", sub?.paidUntil);

check("segundo pago encadena", await store.grantMonth({ subscriptionId: id, provider: "mercadopago", providerRef: "ap_2", amountCents: 3900, paidAt: new Date("2026-12-10T12:00:00Z") }) === "granted");
sub = await store.currentFor("billing-check");
check("periodo encadenado hasta 11/01", sub?.paidUntil?.toISOString() === "2027-01-11T12:00:00.000Z", sub?.paidUntil);

const jan = crypto.randomUUID();
await pool.query("UPDATE billing_subscriptions SET paid_until = '2026-01-31T12:00:00Z' WHERE id = $1", [id]);
await store.grantMonth({ subscriptionId: id, provider: "mercadopago", providerRef: `ap_${jan}`, amountCents: 3900, paidAt: new Date("2026-01-01T00:00:00Z") });
sub = await store.currentFor("billing-check");
check("31/01 + 1 mes = 28/02", sub?.paidUntil?.toISOString() === "2026-02-28T12:00:00.000Z", sub?.paidUntil);

await store.recordWebhook({ topic: "subscription_preapproval", resourceRef: "pre_check_1", requestId: "r1", outcome: "synced" });
const metrics = await store.metrics();
check("métricas", metrics.paymentsLast30Days >= 0 && metrics.live === 1, metrics);
check("rechaza estados inválidos", await pool.query("UPDATE billing_subscriptions SET status = 'robado' WHERE id = $1", [id]).then(() => false, () => true));

await pool.query(`DELETE FROM billing_payments; DELETE FROM billing_subscriptions; DELETE FROM billing_webhook_events; DELETE FROM "user" WHERE id = 'billing-check';`);
await pool.end();
console.log(failures ? `${failures} fallaron` : "todas pasaron");
process.exitCode = failures ? 1 : 0;
