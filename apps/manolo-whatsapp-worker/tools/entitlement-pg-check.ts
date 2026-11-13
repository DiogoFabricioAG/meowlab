// Integration check of per-company entitlements (Plan → Sales Cat) against a real PostgreSQL.
// Needs an empty database, e.g. a throwaway container. Never point it at production.
//   ENTITLEMENT_CHECK_DATABASE_URL=postgres://... npx esbuild tools/entitlement-pg-check.ts --bundle --platform=node --format=esm \
//     --packages=external --outfile=node_modules/.cache/entitlement-pg-check.mjs && node node_modules/.cache/entitlement-pg-check.mjs
import { readFileSync } from "node:fs";
import pg from "pg";
import { PortalEntitlementService } from "../src/node/portal/entitlement-service";
import { SalesService } from "../src/node/sales/sales-service";
import type { BridgeRequestStore } from "../src/node/bridge/request-store";

const url = process.env.ENTITLEMENT_CHECK_DATABASE_URL;
if (!url) throw new Error("ENTITLEMENT_CHECK_DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: url, max: 5 });

await pool.query(`CREATE SCHEMA whatsapp;
  CREATE TABLE whatsapp.tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', legal_name TEXT, ruc TEXT, address TEXT);
  CREATE TABLE whatsapp.contacts (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, whatsapp_user_id TEXT NOT NULL);
  CREATE TABLE whatsapp.tenant_members (tenant_id TEXT, contact_id BIGINT, status TEXT NOT NULL DEFAULT 'active');
  INSERT INTO whatsapp.tenants (id, name) VALUES ('manolo', 'Manolo'), ('org_jd', 'CREACIONES J&D'), ('org_paid', 'Agu Bello'), ('org_off', 'Inactiva');
  UPDATE whatsapp.tenants SET status = 'inactive' WHERE id = 'org_off';
  INSERT INTO whatsapp.contacts VALUES (1, 'manolo', '51911111111');
  INSERT INTO whatsapp.tenant_members VALUES ('org_jd', 1, 'active'), ('org_paid', 1, 'active');`);
for (const file of ["014-sales-cat.sql", "016-quote-pdf.sql", "017-sales-subscriptions.sql", "017-sales-subscriptions.sql"]) {
  await pool.query(readFileSync(`infra/postgres/migrations/${file}`, "utf8"));
}
// The pilot as it exists in production: enabled by hand before 017.
await pool.query("INSERT INTO sales.settings (tenant_id) VALUES ('org_jd')");

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` -> ${JSON.stringify(actual)}`}`);
  if (!ok) failures++;
}
const settings = async (tenant: string) => (await pool.query(
  "SELECT enabled, source, to_char(active_until AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS until FROM sales.settings WHERE tenant_id = $1", [tenant])).rows[0] ?? null;

const store: BridgeRequestStore = { async claim() { return { status: "claimed" } as never; }, async complete() {}, async fail() {} };
const sales = new SalesService(pool, store, () => undefined);
const companies = async () => {
  const result = await sales.process({ channel_tenant_id: "manolo", contact_id: 1, operation: "companies", payload: {} }, `c-${Math.random()}`, "h");
  return result.status === "completed" ? (result.response.data as { companies: Array<{ id: string }> }).companies.map((c) => c.id) : result.status;
};

check("the pilot keeps working as courtesy after 017", await settings("org_jd"), { enabled: true, source: "courtesy", until: null });
check("only the pilot has Sales Cat before paying", await companies(), ["org_jd"]);

const entitlements = new PortalEntitlementService(pool, () => undefined);
const future = new Date(Date.now() + 30 * 86_400_000);
const request = (tenantId: string, until: Date, agents = ["sales"]) =>
  ({ version: 1, requestId: "r", portalUserId: "billing", tenantId, agents, activeUntil: until.toISOString() }) as const;

check("a paid company is enabled until the end of its period", (await entitlements.handle(request("org_paid", future))).status, "ok");
check("…with source subscription", (await settings("org_paid"))?.source, "subscription");
check("now both companies have Sales Cat (ordered by name)", await companies(), ["org_paid", "org_jd"]);
await entitlements.handle(request("org_paid", new Date(Date.now() + 86_400_000)));
check("an older date never shortens the period", (await settings("org_paid"))?.until, future.toISOString().slice(0, 10));
await entitlements.handle(request("org_jd", new Date(Date.now() + 86_400_000)));
check("the courtesy pilot is never touched by billing", await settings("org_jd"), { enabled: true, source: "courtesy", until: null });
check("an inactive company is not found", await entitlements.handle(request("org_off", future)), { status: "not_found" });

// The paid period ends (simulated): Sales Cat stops, the data stays.
await pool.query("UPDATE sales.settings SET active_until = now() - interval '1 minute' WHERE tenant_id = 'org_paid'");
check("after the paid period the company no longer has Sales Cat", await companies(), ["org_jd"]);
check("…but its settings row is kept", (await settings("org_paid"))?.enabled, true);
await entitlements.handle(request("org_paid", future));
check("paying again turns it back on", (await companies() as string[]).includes("org_paid"), true);

let rejected = false;
try { await pool.query("UPDATE sales.settings SET active_until = now() WHERE tenant_id = 'org_jd'"); } catch { rejected = true; }
check("a courtesy row cannot get an end date by mistake", rejected, true);

await pool.end();
console.log(failures ? `${failures} check(s) failed` : "all entitlement checks passed");
process.exit(failures ? 1 : 0);
