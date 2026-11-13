// Integration check of the weekly summary SQL against a real PostgreSQL («Inicio» of the portal).
// Needs an empty database, e.g. a throwaway container. Never point it at production.
//   PORTAL_COMPANY_CHECK_DATABASE_URL=postgres://... npx esbuild tools/portal-weekly-pg-check.ts \
//     --bundle --platform=node --format=esm --outfile=node_modules/.cache/portal-weekly-pg-check.mjs \
//     && node node_modules/.cache/portal-weekly-pg-check.mjs
import pg from "pg";
import { PortalWeeklyService } from "../src/node/portal/weekly-service";

const url = process.env.PORTAL_COMPANY_CHECK_DATABASE_URL;
if (!url) throw new Error("PORTAL_COMPANY_CHECK_DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: url });

// Shapes as in production (005, 006, 009, 012).
await pool.query(`CREATE SCHEMA whatsapp;
  CREATE TABLE whatsapp.tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active');
  CREATE TABLE whatsapp.contacts (id BIGSERIAL PRIMARY KEY, tenant_id TEXT, whatsapp_user_id TEXT NOT NULL);
  CREATE TABLE whatsapp.tenant_members (tenant_id TEXT, contact_id BIGINT, status TEXT NOT NULL DEFAULT 'active');
  CREATE TABLE whatsapp.tenant_integrations (tenant_id TEXT, provider TEXT, status TEXT, encrypted_token TEXT);
  CREATE TABLE whatsapp.portal_company_members (tenant_id TEXT, portal_user_id TEXT, role TEXT);
  CREATE TABLE whatsapp.conversations (id TEXT PRIMARY KEY, tenant_id TEXT, contact_id BIGINT);
  CREATE TABLE whatsapp.messages (id BIGSERIAL PRIMARY KEY, tenant_id TEXT, conversation_id TEXT, direction TEXT, created_at TIMESTAMPTZ);
  CREATE TABLE whatsapp.radar_candidate_snapshots (tenant_id TEXT, phone_number_id TEXT, contact_id BIGINT, ocid TEXT, candidate JSONB, published_at TIMESTAMPTZ);
  CREATE TABLE whatsapp.radar_current_selections (tenant_id TEXT, phone_number_id TEXT, contact_id BIGINT, ocid TEXT, state TEXT, seq BIGINT, changed_at TIMESTAMPTZ);
  INSERT INTO whatsapp.tenants (id, name) VALUES ('manolo', 'Manolo'), ('org', 'Empresa'), ('other', 'Otra');
  INSERT INTO whatsapp.contacts (tenant_id, whatsapp_user_id) VALUES ('manolo', '51911111111'), ('manolo', '51922222222'), ('manolo', '51933333333');
  INSERT INTO whatsapp.tenant_members VALUES ('org', 1, 'active'), ('org', 2, 'active'), ('org', 3, 'inactive'), ('other', 3, 'active');
  INSERT INTO whatsapp.portal_company_members VALUES ('org', 'ana', 'owner');
  INSERT INTO whatsapp.conversations VALUES ('c1', 'manolo', 1), ('c2', 'manolo', 2), ('c3', 'manolo', 3);
  INSERT INTO whatsapp.messages (tenant_id, conversation_id, direction, created_at) VALUES
    ('manolo', 'c1', 'inbound', '2026-11-10T15:00:00Z'), ('manolo', 'c1', 'inbound', '2026-11-12T15:00:00Z'),
    ('manolo', 'c1', 'outbound', '2026-11-12T15:01:00Z'), ('manolo', 'c2', 'inbound', '2026-11-09T05:00:00Z'),
    ('manolo', 'c2', 'inbound', '2026-11-09T04:59:00Z'), ('manolo', 'c2', 'inbound', '2026-11-03T12:00:00Z'),
    ('manolo', 'c3', 'inbound', '2026-11-11T12:00:00Z');
  INSERT INTO whatsapp.radar_candidate_snapshots VALUES
    ('manolo', 'p', 1, 'ocid-1', '{"alert":{"description":"Afiches","buyer":"Muni","deadline":"20/11","amount":"S/ 1","sourceUrl":"https://prod2.seace.gob.pe/a"}}', '2026-11-10T12:00:00Z'),
    ('manolo', 'p', 2, 'ocid-1', '{"alert":{"description":"Afiches","buyer":"Muni","deadline":"20/11","amount":"S/ 1","sourceUrl":"https://prod2.seace.gob.pe/a"}}', '2026-11-10T12:05:00Z'),
    ('manolo', 'p', 1, 'ocid-2', '{"alert":{"description":"Banner","buyer":"Gore","deadline":"25/11","amount":"S/ 2","sourceUrl":"https://prod2.seace.gob.pe/b"}}', '2026-11-11T12:00:00Z'),
    ('manolo', 'p', 3, 'ocid-3', '{"alert":{"description":"Ajena","buyer":"X","deadline":"x","amount":"x","sourceUrl":"https://prod2.seace.gob.pe/c"}}', '2026-11-11T12:00:00Z'),
    ('manolo', 'p', 1, 'ocid-old', '{"alert":{"description":"Vieja","buyer":"X","deadline":"x","amount":"x","sourceUrl":"https://prod2.seace.gob.pe/d"}}', '2026-11-05T12:00:00Z');
  INSERT INTO whatsapp.radar_current_selections VALUES ('manolo', 'p', 2, 'ocid-1', 'interesting', 1, now());`);

const service = new PortalWeeklyService(pool, { decrypt: () => "x" }, "https://f.example", () => undefined, () => new Date("2026-11-13T04:00:00Z"));
let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` -> ${JSON.stringify(actual)}`}`);
  if (!ok) failures++;
}
check("non-members are refused", await service.handle("beto", "org"), { status: "forbidden" });
const result = await service.handle("ana", "org") as { weekly: Record<string, any> };
check("team counts inbound messages of active members, this week and last",
  result.weekly.team, { members: 2, messages: 3, activePeople: 2, previousMessages: 2 });
check("tenders: one row per tender, interesting first, other companies excluded",
  { found: result.weekly.tender.found, interesting: result.weekly.tender.interesting,
    order: result.weekly.tender.highlights.map((h: { description: string }) => h.description) },
  { found: 2, interesting: 1, order: ["Afiches", "Banner"] });
check("no Invoice Cat means no invoicing block", result.weekly.invoicing, null);

await pool.query("DROP SCHEMA whatsapp CASCADE");
await pool.end();
console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
