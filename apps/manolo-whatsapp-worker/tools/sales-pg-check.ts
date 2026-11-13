// Integration check of Sales Cat's data service against a real PostgreSQL (ADR-0011).
// Needs an empty database, e.g. a throwaway container. Never point it at production.
//   SALES_CHECK_DATABASE_URL=postgres://... npx esbuild tools/sales-pg-check.ts --bundle --platform=node --format=esm \
//     --outfile=node_modules/.cache/sales-pg-check.mjs && node node_modules/.cache/sales-pg-check.mjs
import { readFileSync } from "node:fs";
import pg from "pg";
import { PublicQuoteService, SalesService } from "../src/node/sales/sales-service";
import type { BridgeRequestStore } from "../src/node/bridge/request-store";
import type { SalesBridgeRequest, SalesBridgeResponse } from "../src/sales/bridge-contracts";

const url = process.env.SALES_CHECK_DATABASE_URL;
if (!url) throw new Error("SALES_CHECK_DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: url, max: 10 });

await pool.query(`CREATE SCHEMA whatsapp;
  CREATE TABLE whatsapp.tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', legal_name TEXT, ruc TEXT, address TEXT);
  CREATE TABLE whatsapp.contacts (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, whatsapp_user_id TEXT NOT NULL);
  CREATE TABLE whatsapp.tenant_members (tenant_id TEXT, contact_id BIGINT, status TEXT NOT NULL DEFAULT 'active');
  INSERT INTO whatsapp.tenants (id, name, legal_name, ruc) VALUES ('manolo', 'Manolo', NULL, NULL),
    ('org_jd', 'CREACIONES J&D', 'CREACIONES J&D S.A.C.', '20601234565'), ('org_off', 'Sin Sales', NULL, NULL);
  INSERT INTO whatsapp.contacts VALUES (1, 'manolo', '51911111111'), (2, 'manolo', '51922222222'), (3, 'other', '51933333333');
  INSERT INTO whatsapp.tenant_members VALUES ('org_jd', 1, 'active'), ('org_off', 1, 'active'), ('org_jd', 3, 'active');`);
const migration = readFileSync("infra/postgres/migrations/014-sales-cat.sql", "utf8");
await pool.query(migration);
await pool.query(migration); // re-runnable
// Quotes read the brand kit (ADR-0012) since migration 015.
await pool.query(readFileSync("infra/postgres/migrations/015-brand-kit.sql", "utf8"));
await pool.query("INSERT INTO sales.settings (tenant_id) VALUES ('org_jd')");

// In-memory idempotency store with the same rules as PgBridgeRequestStore.
const stored = new Map<string, { hash: string; status: string; reply?: string }>();
const store: BridgeRequestStore = {
  async claim(identity) {
    const row = stored.get(identity.requestId);
    if (!row) { stored.set(identity.requestId, { hash: identity.requestHash, status: "processing" }); return { status: "claimed" } as never; }
    if (row.hash !== identity.requestHash) return { status: "conflict" } as never;
    if (row.status === "completed") return { status: "completed", replyText: row.reply! } as never;
    return { status: "in_progress" } as never;
  },
  async complete(identity, reply) { stored.set(identity.requestId, { hash: identity.requestHash, status: "completed", reply }); },
  async fail(identity) { stored.delete(identity.requestId); },
};
let clock = new Date("2026-11-13T15:00:00Z");
let tokens = 0;
const service = new SalesService(pool, store, () => undefined, () => clock, () => `Tok${String(++tokens).padStart(19, "0")}`);
let requests = 0;
const call = async (contactId: number, operation: SalesBridgeRequest["operation"], payload: Record<string, unknown> = {}, company: string | undefined = "org_jd", requestId = `req-${++requests}`, hash = requestId) => {
  const result = await service.process({ channel_tenant_id: "manolo", contact_id: contactId, operation, ...(company ? { company_id: company } : {}), payload }, requestId, hash);
  return result.status === "completed" ? result.response as SalesBridgeResponse & { data: any } : { status: result.status } as any;
};

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` -> ${JSON.stringify(actual)}`}`);
  if (!ok) failures++;
}

check("companies: only memberships with Sales Cat on", (await call(1, "companies", {}, undefined)).data, { companies: [{ id: "org_jd", name: "CREACIONES J&D" }] });
check("a contact of another channel is refused", (await call(3, "companies", {}, undefined)).error, { code: "forbidden" });
check("a company without membership is refused", (await call(2, "catalog")).error, { code: "forbidden" });
check("a member of a company without Sales Cat is refused", (await call(1, "catalog", {}, "org_off")).error, { code: "forbidden" });

const sale = (customer: unknown, lines: unknown[], extra: Record<string, unknown> = {}) =>
  ({ customer, lines, paymentMethod: "yape", discountCents: 0, notes: null, ...extra });
const ruc = { docType: "6", docNumber: "20123456789", name: "Comercial Lima" };
const first = await call(1, "create_sale", sale(ruc, [{ description: "Polo blanco", quantity: 3, unitPriceCents: 2500 }]));
check("first sale is N.° 1 with its total", { number: first.data.sale.number, total: first.data.sale.totalCents }, { number: 1, total: 7500 });
check("the product was created on the fly", (await call(1, "catalog")).data.products, [{ name: "Polo blanco", unitPriceCents: 2500 }]);
await call(1, "create_sale", sale({ ...ruc, name: "Comercial Lima S.A.C." }, [{ description: "polo BLANCO", quantity: 1, unitPriceCents: 2500 }], { paymentMethod: "credito" }));
check("the same RUC reuses the customer (name updated)",
  (await pool.query("SELECT count(*)::int AS n, max(name) AS name FROM commerce.customers")).rows[0], { n: 1, name: "Comercial Lima S.A.C." });
check("the same product name reuses the product",
  (await pool.query("SELECT count(*)::int AS n FROM commerce.products")).rows[0], { n: 1 });
check("credit sales keep the debt", (await pool.query("SELECT balance_cents::int AS b FROM sales.sales WHERE number = 2")).rows[0], { b: 2500 });

const replayA = await call(1, "create_sale", sale(null, [{ description: "Taza", quantity: 1, unitPriceCents: 1000 }]), "org_jd", "same-id", "hash-a");
const replayB = await call(1, "create_sale", sale(null, [{ description: "Taza", quantity: 1, unitPriceCents: 1000 }]), "org_jd", "same-id", "hash-a");
check("a repeated request replays without a second sale", { a: replayA.data.sale.number, b: replayB.data.sale.number, replayed: replayB.replayed }, { a: 3, b: 3, replayed: true });
check("same id with different content is a conflict", await call(1, "create_sale", sale(null, [{ description: "Taza", quantity: 2, unitPriceCents: 1000 }]), "org_jd", "same-id", "hash-b"), { status: "conflict" });

const parallel = await Promise.all(Array.from({ length: 5 }, () => call(1, "create_sale", sale(null, [{ description: "Llavero", quantity: 1, unitPriceCents: 500 }]))));
check("concurrent sales get unique consecutive numbers", parallel.map((r) => r.data.sale.number).sort((a: number, b: number) => a - b), [4, 5, 6, 7, 8]);

const discounted = await call(1, "create_sale", sale(null, [{ description: "Polo blanco", quantity: 2, unitPriceCents: 2500 }], { discountCents: 9000 }));
check("a discount never takes the total below zero", discounted.data.sale.totalCents, 0);

const quote = await call(1, "create_quote", { customer: ruc, lines: [{ description: "Volantes A5", quantity: 100, unitPriceCents: 150 }], discountCents: 0, notes: "Entrega en 3 días" });
check("quote N.° 1, valid 7 days, code returned once", { n: quote.data.quote.number, until: quote.data.quote.validUntil, token: quote.data.quote.publicToken },
  { n: 1, until: "2026-11-20", token: "Tok0000000000000000001" });
check("the code itself is not stored", (await pool.query("SELECT count(*)::int AS n FROM sales.quotes WHERE public_token_hash LIKE 'Tok%'")).rows[0], { n: 0 });
const view = await new PublicQuoteService(pool).view("Tok0000000000000000001");
check("public view shows company, customer and lines", { company: view?.company.ruc, customer: view?.customerName, lines: view?.lines, total: view?.totalCents },
  { company: "20601234565", customer: "Comercial Lima", lines: [{ description: "Volantes A5", quantity: 100, unitPriceCents: 150, totalCents: 15000 }], total: 15000 });
check("a wrong code shows nothing", await new PublicQuoteService(pool).view("Zzzzzzzzzzzzzzzzzzzzzz"), null);

check("cancel a sale", (await call(1, "cancel_sale", { number: 1, reason: null })).data, { cancelled: { number: 1 } });
check("cannot cancel it twice", (await call(1, "cancel_sale", { number: 1, reason: null })).error, { code: "not_found" });
check("the cancellation is audited with who did it",
  (await pool.query("SELECT action, contact_id::int AS c FROM sales.audit_log WHERE action = 'cancelled'")).rows, [{ action: "cancelled", c: 1 }]);

const summary = (await call(1, "summary", { period: "today" })).data.summary;
check("today's summary excludes the cancelled sale", { count: summary.salesCount, total: summary.totalCents, credit: summary.creditCents, quotes: summary.quotesCount, top: summary.topProducts[0]?.description },
  // Sales 2-9; the discounted one totals 0. Top products rank by line amounts (before the discount).
  { count: 8, total: 2500 + 1000 + 5 * 500 + 0, credit: 2500, quotes: 1, top: "Polo blanco" });
clock = new Date("2026-11-14T15:00:00Z");
check("tomorrow, today is empty", (await call(1, "summary", { period: "today" })).data.summary.salesCount, 0);
check("but yesterday has them", (await call(1, "summary", { period: "yesterday" })).data.summary.salesCount, 8);

check("change a product's price", (await call(1, "upsert_product", { name: "polo blanco", unitPriceCents: 3000 })).data.product, { name: "Polo blanco", unitPriceCents: 3000, created: false });
check("link a receipt to a sale", (await call(1, "link_invoice", { number: 2, invoiceNumber: "B001-00000009" })).data, { linked: true });

await pool.query("DROP SCHEMA whatsapp, commerce, sales CASCADE");
await pool.end();
console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
