// Integration check of per company billing (migration 0004 + PgBillingStore) against a real
// PostgreSQL. Needs an empty database. Never point it at production.
//   BILLING_CHECK_DATABASE_URL=postgres://... npx esbuild scripts/billing-company-pg-check.ts --bundle --platform=node --format=esm \
//     --packages=external --outfile=node_modules/.cache/billing-company-pg-check.mjs && node node_modules/.cache/billing-company-pg-check.mjs
import { readFileSync } from "node:fs";
import pg from "pg";
import { PgBillingStore } from "../server/billing/store";

const url = process.env.BILLING_CHECK_DATABASE_URL;
if (!url) throw new Error("BILLING_CHECK_DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: url, max: 5 });
for (const file of ["0001_better_auth.sql", "0002_user_role.sql", "0003_billing.sql"]) {
  await pool.query(readFileSync(`migrations-postgres/${file}`, "utf8"));
}
await pool.query(`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ('u1', 'Ana', 'ana@test.pe', true, now(), now()), ('u2', 'Bea', 'bea@test.pe', true, now(), now())`);
// A subscription from before companies existed, still live.
await pool.query(`INSERT INTO billing_subscriptions (id, user_id, agents, amount_cents, status, external_reference, payer_email, paid_until)
  VALUES (gen_random_uuid(), 'u1', '{invoice}', 3900, 'authorized', 'meowlab:legacy', 'ana@test.pe', now() + interval '10 days')`);
const migration = readFileSync("migrations-postgres/0004_billing_por_empresa.sql", "utf8");
await pool.query(migration);

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` -> ${JSON.stringify(actual)}`}`);
  if (!ok) failures++;
}
const store = new PgBillingStore(pool);
const sub = (id: string, user: string, tenant: string) => ({ id, userId: user, tenantId: tenant, agents: ["sales"], amountCents: 5900, externalReference: `meowlab:${id}`, payerEmail: "ana@test.pe" });

check("Sales Cat is for sale", (await store.catalog()).agents.find((a) => a.key === "sales")?.available, true);
check("the legacy subscription keeps no company", (await pool.query("SELECT tenant_id FROM billing_subscriptions")).rows, [{ tenant_id: null }]);
check("an owner with a legacy live subscription can still subscribe a company",
  await store.createSubscription(sub("11111111-1111-1111-1111-111111111111", "u1", "org_1")), "created");
check("one live subscription per company", await store.createSubscription(sub("22222222-2222-2222-2222-222222222222", "u2", "org_1")), "already_live");
check("another company of the same account gets its own", await store.createSubscription(sub("33333333-3333-3333-3333-333333333333", "u1", "org_2")), "created");
check("the company's plan is read by company", (await store.currentFor("org_1"))?.id, "11111111-1111-1111-1111-111111111111");

await pool.query(`UPDATE billing_subscriptions SET provider_ref = 'pre_1', status = 'cancelled', paid_until = now() + interval '20 days'
  WHERE id = '11111111-1111-1111-1111-111111111111'`);
check("a cancelled company plan with an unconfirmed paid period is reconciled",
  (await store.reconcilable()).map((s) => s.id).includes("11111111-1111-1111-1111-111111111111"), true);
const until = (await store.currentFor("org_1"))!.paidUntil!;
await store.markEntitlementApplied("11111111-1111-1111-1111-111111111111", until);
await store.markEntitlementApplied("11111111-1111-1111-1111-111111111111", new Date(Date.now() - 86_400_000));
check("confirmation never goes back in time", (await store.currentFor("org_1"))?.entitlementAppliedUntil?.toISOString(), until.toISOString());
check("once confirmed it is not reconciled again", (await store.reconcilable()).map((s) => s.id).includes("11111111-1111-1111-1111-111111111111"), false);
check("after cancelling, the company can subscribe again", await store.createSubscription(sub("44444444-4444-4444-4444-444444444444", "u1", "org_1")), "created");

let rejected = false;
try { await pool.query(`UPDATE billing_subscriptions SET tenant_id = '../x' WHERE id = '33333333-3333-3333-3333-333333333333'`); } catch { rejected = true; }
check("a malformed company id is refused", rejected, true);

await pool.end();
console.log(failures ? `${failures} check(s) failed` : "all billing checks passed");
process.exit(failures ? 1 : 0);
