// Integration check of PortalCompanyService against a real PostgreSQL (ADR-0010).
// Needs an empty database, e.g. a throwaway container. Never point it at production:
// it creates and deletes rows.
//   PORTAL_COMPANY_CHECK_DATABASE_URL=postgres://... npx esbuild tools/portal-company-pg-check.ts \
//     --bundle --platform=node --format=esm --outfile=node_modules/.cache/portal-company-pg-check.mjs \
//     && node node_modules/.cache/portal-company-pg-check.mjs
import { readFileSync } from "node:fs";
import pg from "pg";
import { PortalCompanyService } from "../src/node/portal/company-service";
import type { PortalCompanyResponse } from "../src/bridge/portal-company-contracts";

const url = process.env.PORTAL_COMPANY_CHECK_DATABASE_URL;
if (!url) throw new Error("PORTAL_COMPANY_CHECK_DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: url });

// Minimal shape of the tables this migration builds on (005/006 in production).
await pool.query(`CREATE SCHEMA IF NOT EXISTS whatsapp;
  CREATE TABLE IF NOT EXISTS whatsapp.tenants (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
    timezone TEXT NOT NULL DEFAULT 'America/Bogota', created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, legal_name TEXT, ruc TEXT, address TEXT);
  CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_tenants_ruc_unique ON whatsapp.tenants (ruc) WHERE ruc IS NOT NULL AND BTRIM(ruc) <> '';
  CREATE TABLE IF NOT EXISTS whatsapp.tenant_integrations (tenant_id TEXT, provider TEXT, status TEXT);
  INSERT INTO whatsapp.tenants (id, name, ruc) VALUES ('kromata', 'Kromata', '20601234565') ON CONFLICT DO NOTHING;`);
// Run from apps/manolo-whatsapp-worker. Twice: the migration must be re-runnable.
const migration = readFileSync("infra/postgres/migrations/012-portal-companies.sql", "utf8");
await pool.query(migration);
await pool.query(migration);

const registry: Record<string, { status: string }> = {
  "20557288016": { status: "ACTIVO" },
  "20100070970": { status: "ACTIVO" },
  "20131312955": { status: "ACTIVO" },
  "20100047218": { status: "ACTIVO" },
  "20512345671": { status: "ACTIVO" },
};
let next = 0;
const service = new PortalCompanyService(
  pool,
  { find: async (ruc) => registry[ruc] ? { ruc, legalName: `Empresa ${ruc}`, address: null, status: registry[ruc].status, condition: "HABIDO" } : null },
  () => undefined,
  () => `org_check_${++next}`,
);
const call = (portalUserId: string, body: Record<string, unknown>) =>
  service.handle({ version: 1, requestId: crypto.randomUUID(), portalUserId, ...body } as never) as Promise<PortalCompanyResponse>;

let failures = 0;
function check(name: string, actual: unknown, expected: Record<string, unknown>) {
  const ok = Object.entries(expected).every(([key, value]) => JSON.stringify((actual as Record<string, unknown>)[key]) === JSON.stringify(value));
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` -> ${JSON.stringify(actual)}`}`);
  if (!ok) failures++;
}

check("existing operator RUC is taken", await call("ana", { action: "lookup", ruc: "20601234565" }), { status: "taken" });
check("creates the first company", await call("ana", { action: "create", ruc: "20557288016", name: "Agu" }), { status: "created" });
const [first, second] = await Promise.all([
  call("ana", { action: "create", ruc: "20100070970" }),
  call("beto", { action: "create", ruc: "20100070970" }),
]);
check("concurrent creation of one RUC: exactly one wins",
  { statuses: [first.status, second.status].sort() }, { statuses: ["created", "taken"] });
// Ana now owns 1 or 2 companies; fresh RUCs fill her up to 3, then the next is refused.
const fresh = ["20131312955", "20100047218", "20512345671"];
let last: PortalCompanyResponse = { status: "unavailable" };
for (const ruc of fresh) {
  last = await call("ana", { action: "create", ruc });
  if (last.status !== "created") break;
}
check("ownership limit of 3", last, { status: "limit_reached" });
const mine = await call("ana", { action: "mine" }) as Extract<PortalCompanyResponse, { companies: unknown }>;
check("ana owns exactly 3 companies", { count: mine.companies.length, allOwner: mine.companies.every((c) => c.role === "owner") },
  { count: 3, allOwner: true });
check("portal companies are marked and use Lima time",
  (await pool.query("SELECT count(*)::int AS n FROM whatsapp.tenants WHERE origin = 'portal' AND timezone <> 'America/Lima'")).rows[0], { n: 0 });
check("operator companies keep their origin",
  (await pool.query("SELECT origin FROM whatsapp.tenants WHERE id = 'kromata'")).rows[0], { origin: "operator" });
let secondOwner = "allowed";
try {
  await pool.query("INSERT INTO whatsapp.portal_company_members (tenant_id, portal_user_id, role) VALUES ('org_check_1', 'zoe', 'owner')");
} catch {
  secondOwner = "refused";
}
check("a company cannot have two owners", { secondOwner }, { secondOwner: "refused" });

await pool.query("DROP SCHEMA whatsapp CASCADE");
await pool.end();
console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
