// Integration check of the brand kit (ADR-0012, phase 1) against a real PostgreSQL.
// Needs an empty database, e.g. a throwaway container. Never point it at production.
//   BRAND_CHECK_DATABASE_URL=postgres://... npx esbuild tools/brand-pg-check.ts --bundle --platform=node --format=esm \
//     --outfile=node_modules/.cache/brand-pg-check.mjs && node node_modules/.cache/brand-pg-check.mjs
import { readFileSync } from "node:fs";
import pg from "pg";
import { PortalBrandService } from "../src/node/portal/brand-service";
import { PublicQuoteService, SalesService } from "../src/node/sales/sales-service";
import type { BridgeRequestStore } from "../src/node/bridge/request-store";

const url = process.env.BRAND_CHECK_DATABASE_URL;
if (!url) throw new Error("BRAND_CHECK_DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: url, max: 5 });

await pool.query(`CREATE SCHEMA whatsapp;
  CREATE TABLE whatsapp.tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', legal_name TEXT, ruc TEXT, address TEXT);
  CREATE TABLE whatsapp.contacts (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, whatsapp_user_id TEXT NOT NULL);
  CREATE TABLE whatsapp.tenant_members (tenant_id TEXT, contact_id BIGINT, status TEXT NOT NULL DEFAULT 'active');
  CREATE TABLE whatsapp.portal_company_members (tenant_id TEXT NOT NULL, portal_user_id TEXT NOT NULL, role TEXT NOT NULL);
  INSERT INTO whatsapp.tenants (id, name, legal_name, ruc) VALUES ('manolo', 'Manolo', NULL, NULL), ('org_jd', 'CREACIONES J&D', 'CREACIONES J&D S.A.C.', '20601234565');
  INSERT INTO whatsapp.contacts VALUES (1, 'manolo', '51911111111');
  INSERT INTO whatsapp.tenant_members VALUES ('org_jd', 1, 'active');
  INSERT INTO whatsapp.portal_company_members VALUES ('org_jd', 'owner-1', 'owner'), ('org_jd', 'member-1', 'member');`);
await pool.query(readFileSync("infra/postgres/migrations/014-sales-cat.sql", "utf8"));
const migration = readFileSync("infra/postgres/migrations/015-brand-kit.sql", "utf8");
await pool.query(migration);
await pool.query(migration); // re-runnable
await pool.query("INSERT INTO sales.settings (tenant_id, quote_valid_days) VALUES ('org_jd', 7)");

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` -> ${JSON.stringify(actual)}`}`);
  if (!ok) failures++;
}

const brand = new PortalBrandService(pool, () => undefined);
const ask = (portalUserId: string, extra: Record<string, unknown>) =>
  brand.handle({ portalUserId, tenantId: "org_jd", ...extra } as never) as Promise<any>;

const empty = await ask("member-1", { action: "brand_get" });
check("an empty kit reads as empty", { status: empty.status, color: empty.brand.primaryColor, logo: empty.brand.logo, canEdit: empty.canEdit },
  { status: "ok", color: null, logo: null, canEdit: false });
check("a member cannot save", await ask("member-1", { action: "brand_save", kit: {} }), { status: "forbidden" });
check("a stranger cannot read", await ask("nobody", { action: "brand_get" }), { status: "forbidden" });

const kit = { primaryColor: "#0F3D2E", contactPhone: "999 888 777", contactEmail: "ventas@jd.pe", contactWeb: "jd.pe",
  paymentMethods: [{ kind: "yape", label: "Yape", value: "999888777" }, { kind: "bank", label: "BCP soles", value: "191-1234567-0-12" }],
  footerText: "Gracias por su preferencia", quoteValidDays: 15, quotePaymentTerms: "50% adelantado", quoteDeliveryTerms: "3 días hábiles" };
const saved = await ask("owner-1", { action: "brand_save", kit });
check("the owner saves the kit", { status: saved.status, color: saved.brand.primaryColor, methods: saved.brand.paymentMethods.length, days: saved.brand.quoteValidDays },
  { status: "ok", color: "#0f3d2e", methods: 2, days: 15 });
await ask("owner-1", { action: "brand_save", kit: { ...kit, footerText: "Gracias" } });
check("saving again updates the same row", (await pool.query("SELECT count(*)::int AS n, max(footer_text) AS f FROM commerce.brand_kits")).rows[0], { n: 1, f: "Gracias" });

const png = Buffer.alloc(400);
png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
png.writeUInt32BE(480, 16);
png.writeUInt32BE(160, 20);
const withLogo = await ask("owner-1", { action: "brand_logo_put", contentBase64: png.toString("base64") });
check("the owner uploads a logo", withLogo.brand.logo && { w: withLogo.brand.logo.width, h: withLogo.brand.logo.height, v: withLogo.brand.logo.version.length }, { w: 480, h: 160, v: 16 });
const logo = await ask("member-1", { action: "brand_logo_get" });
check("members read the logo bytes", Buffer.from(logo.logo.contentBase64, "base64").equals(png), true);

// Sales Cat copies the kit's terms and validity into each new quote.
const store: BridgeRequestStore = {
  async claim() { return { status: "claimed" } as never; },
  async complete() {},
  async fail() {},
};
const sales = new SalesService(pool, store, () => undefined, () => new Date("2026-11-13T15:00:00Z"), () => "Tok0000000000000000001");
await sales.process({ channel_tenant_id: "manolo", contact_id: 1, operation: "create_quote", company_id: "org_jd",
  payload: { customer: null, lines: [{ description: "Volantes A5", quantity: 100, unitPriceCents: 150 }], discountCents: 0, notes: null } }, "q1", "q1");
const publicQuotes = new PublicQuoteService(pool);
const view = await publicQuotes.view("Tok0000000000000000001") as any;
check("the quote uses the kit's validity", view.validUntil, "2026-11-28");
check("the quote keeps the kit's terms", { p: view.paymentTerms, d: view.deliveryTerms }, { p: "50% adelantado", d: "3 días hábiles" });
check("the public quote carries the brand", { color: view.brand.primaryColor, yape: view.brand.paymentMethods[0].value, logo: Boolean(view.brand.logo) },
  { color: "#0f3d2e", yape: "999888777", logo: true });
await ask("owner-1", { action: "brand_save", kit: { ...kit, quotePaymentTerms: "Contado" } });
check("changing the kit does not rewrite a sent quote", ((await publicQuotes.view("Tok0000000000000000001")) as any).paymentTerms, "50% adelantado");
const publicLogo = await publicQuotes.logo("Tok0000000000000000001");
check("the logo is reachable through the quote link", publicLogo && Buffer.from(publicLogo.contentBase64, "base64").equals(png), true);
check("a wrong link reaches no logo", await publicQuotes.logo("Zzzzzzzzzzzzzzzzzzzzzz"), null);

await ask("owner-1", { action: "brand_logo_delete" });
check("the owner removes the logo", (await ask("owner-1", { action: "brand_get" })).brand.logo, null);
let rejected = false;
try { await pool.query("UPDATE commerce.brand_kits SET primary_color = 'red'"); } catch { rejected = true; }
check("the database refuses a malformed color", rejected, true);

await pool.end();
console.log(failures ? `${failures} check(s) failed` : "all brand checks passed");
process.exit(failures ? 1 : 0);
