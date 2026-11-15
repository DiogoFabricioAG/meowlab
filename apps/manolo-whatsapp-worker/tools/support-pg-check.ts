// Integration check of Support Cat's data service against a real PostgreSQL (ADR-0017).
// Needs an empty database, e.g. a throwaway container. Never point it at production.
//   SUPPORT_CHECK_DATABASE_URL=postgres://... npx esbuild tools/support-pg-check.ts --bundle --platform=node --format=esm \
//     --packages=external --outfile=node_modules/.cache/support-pg-check.mjs && node node_modules/.cache/support-pg-check.mjs
import { readFileSync } from "node:fs";
import pg from "pg";
import { SupportService } from "../src/node/support/support-service";
import { PortalSupportService } from "../src/node/support/portal-support-service";
import { SalesService } from "../src/node/sales/sales-service";
import { PortalWeeklyService } from "../src/node/portal/weekly-service";
import type { BridgeRequestStore } from "../src/node/bridge/request-store";
import type { SupportBridgeRequest } from "../src/support/bridge-contracts";

const url = process.env.SUPPORT_CHECK_DATABASE_URL;
if (!url) throw new Error("SUPPORT_CHECK_DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: url, max: 5 });

await pool.query(`CREATE SCHEMA whatsapp;
  CREATE TABLE whatsapp.tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', legal_name TEXT, ruc TEXT, address TEXT);
  CREATE TABLE whatsapp.contacts (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, whatsapp_user_id TEXT NOT NULL);
  CREATE TABLE whatsapp.tenant_members (tenant_id TEXT, contact_id BIGINT, status TEXT NOT NULL DEFAULT 'active');
  CREATE TABLE whatsapp.portal_company_members (tenant_id TEXT NOT NULL, portal_user_id TEXT NOT NULL, role TEXT NOT NULL);
  CREATE TABLE whatsapp.portal_whatsapp_links (portal_user_id TEXT PRIMARY KEY, wa_phone TEXT NOT NULL UNIQUE, linked_at TIMESTAMPTZ NOT NULL DEFAULT now());
  INSERT INTO whatsapp.tenants (id, name) VALUES ('manolo', 'Manolo'), ('org_jd', 'CREACIONES J&D'), ('org_off', 'Sin Support');
  INSERT INTO whatsapp.contacts VALUES (1, 'manolo', '51911111111'), (2, 'manolo', '51922222222'), (5, 'manolo', '51955500001');
  INSERT INTO whatsapp.tenant_members VALUES ('org_jd', 1, 'active'), ('org_jd', 2, 'active');
  INSERT INTO whatsapp.portal_company_members VALUES ('org_jd', 'owner-1', 'owner'), ('org_jd', 'member-2', 'member');
  INSERT INTO whatsapp.portal_whatsapp_links (portal_user_id, wa_phone) VALUES ('owner-1', '51911111111'), ('member-2', '51922222222');`);
await pool.query(readFileSync("infra/postgres/migrations/014-sales-cat.sql", "utf8"));
await pool.query(readFileSync("infra/postgres/migrations/017-sales-subscriptions.sql", "utf8"));
await pool.query(readFileSync("infra/postgres/migrations/019-collections-cat.sql", "utf8"));
const migration = readFileSync("infra/postgres/migrations/021-support-cat.sql", "utf8");
await pool.query(migration);
await pool.query(migration); // re-runnable
await pool.query(`INSERT INTO sales.settings (tenant_id) VALUES ('org_jd');
  INSERT INTO support.settings (tenant_id, phone_number_id) VALUES ('org_jd', '1266091906580349');
  INSERT INTO commerce.products (id, tenant_id, name, unit_price_cents) VALUES
    ('00000000-0000-4000-8000-000000000001', 'org_jd', 'Polo blanco M', 2500), ('00000000-0000-4000-8000-000000000002', 'org_jd', 'Taza blanca 11 oz', 1800);`);

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
// Sunday 15/11/2026, 11:00 in Lima.
let now = new Date("2026-11-15T16:00:00Z");
const sales = new SalesService(pool, store, () => undefined, () => now);
const pdfs = { async byNumber(_company: string, number: number) { return { filename: `Cotizacion-${number}.pdf`, bytes: new TextEncoder().encode(`%PDF-1.4 ${"x".repeat(120)}`) }; } };
const support = new SupportService(pool, store, () => undefined, sales, pdfs, () => now);
let requests = 0;
const call = async (contactId: number | null, operation: SupportBridgeRequest["operation"], payload: Record<string, unknown> = {},
  company: string | undefined = "org_jd", requestId = `req-${++requests}`) => {
  const result = await support.process({ channel_tenant_id: "manolo", ...(contactId !== null ? { contact_id: contactId } : {}), operation,
    ...(company ? { company_id: company } : {}), payload }, requestId, requestId);
  return result.status === "completed" ? result.response as any : { status: result.status };
};

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` -> ${JSON.stringify(actual)}`}`);
  if (!ok) failures++;
}

const CUSTOMER = "51999888777";
check("another number has no Support Cat", (await call(null, "customer_context", { phoneNumberId: "999999", phone: CUSTOMER }, undefined)).data, { mode: "off" });
check("the team is not a customer", (await call(null, "customer_context", { phoneNumberId: "1266091906580349", phone: "51922222222" }, undefined)).data, { mode: "off" });
const portal = new PortalSupportService(pool, support, () => undefined);
await portal.faq("owner-1", "org_jd", { question: "¿Cuál es el horario?", answer: "De lunes a sábado de 9 a 7." });
await portal.faq("owner-1", "org_jd", { question: "¿Hacen delivery?", answer: "Sí, en Lima a S/ 10." });
check("only the owner edits the frequent questions", (await portal.faq("member-2", "org_jd", { question: "x", answer: "y" })).status, "owner_only");
let result = await call(null, "customer_context", { phoneNumberId: "1266091906580349", phone: CUSTOMER }, undefined);
check("a customer gets the FAQs and the catalog",
  { mode: result.data.mode, company: result.data.companyName, faqs: result.data.faqs.length, catalog: result.data.catalog.map((p: any) => p.name).sort(), customer: result.data.customer },
  { mode: "customer", company: "CREACIONES J&D", faqs: 2, catalog: ["Polo blanco M", "Taza blanca 11 oz"], customer: { name: null } });

// A quote from the catalog.
check("products outside the catalog are not quoted",
  (await call(null, "customer_quote", { phone: CUSTOMER, items: [{ product: "Gorra", quantity: 2 }] })).error, { code: "unknown_products", details: { products: ["Gorra"] } });
result = await call(null, "customer_quote", { phone: CUSTOMER, customerName: "Rosa Díaz", items: [{ product: "polo blanco m", quantity: 3 }, { product: "Taza blanca 11 oz", quantity: 2 }], sourceRef: "wamid.q1" });
check("a quote with catalog prices", [result.data.quote.number, result.data.quote.totalCents, result.data.quote.lines], [1, 11100, [{ name: "Polo blanco M", quantity: 3 }, { name: "Taza blanca 11 oz", quantity: 2 }]]);
check("the customer keeps their WhatsApp", (await pool.query("SELECT name, phone FROM commerce.customers")).rows, [{ name: "Rosa Díaz", phone: CUSTOMER }]);
result = await call(null, "customer_context", { phoneNumberId: "1266091906580349", phone: CUSTOMER }, undefined);
check("next time the cat knows her and her quote", [result.data.customer.name, result.data.quotes.map((q: any) => [q.number, q.totalCents])], ["Rosa Díaz", [[1, 11100]]]);
check("the quote PDF", (await call(null, "quote_pdf", { number: 1 })).data.pdf.filename, "Cotizacion-1.pdf");

// Tickets.
result = await call(null, "open_ticket", { phone: CUSTOMER, kind: "complaint", question: "Llegó una taza rota", sourceRef: "wamid.t1" });
const complaint = result.data.ticket;
check("a complaint is a high-priority ticket for the owner",
  { number: complaint.number, priority: complaint.priority, name: complaint.customerName, owners: result.data.ownerPhones },
  { number: 1, priority: "high", name: "Rosa Díaz", owners: ["51911111111"] });
result = await call(null, "open_ticket", { phone: "51900000002", kind: "question", question: "¿Tienen polos talla XXL?" });
const question = result.data.ticket;
check("tickets are numbered per company", question.number, 2);
check("a member sees the pending cases, urgent first", (await call(2, "pending")).data.open.map((t: any) => t.number), [1, 2]);
check("only the owner answers", (await call(2, "answer_ticket", { ticketId: question.id, answer: "Sí, hasta XXL" })).error.code, "owner_only");
result = await call(1, "answer_ticket", { ticketId: question.id, answer: "Sí, tenemos hasta XXL" });
check("the owner answers", [result.data.ticket.status, result.data.ticket.answer, result.data.companyName], ["answered", "Sí, tenemos hasta XXL", "CREACIONES J&D"]);
await call(1, "mark_relayed", { ticketId: question.id, relayed: true });
await call(null, "mark_notified", { ticketIds: [complaint.id] });
check("relayed and notified are recorded", (await pool.query("SELECT number, relayed, notified_at IS NOT NULL AS notified FROM support.tickets ORDER BY number")).rows,
  [{ number: 1, relayed: false, notified: true }, { number: 2, relayed: true, notified: false }]);
check("a stranger cannot answer", (await call(5, "pending")).error.code, "forbidden");

// Events and the daily summary.
await call(null, "customer_event", { phone: CUSTOMER, kind: "answered", sourceRef: "wamid.a1" });
await call(null, "customer_event", { phone: CUSTOMER, kind: "answered", sourceRef: "wamid.a1" });
await call(null, "customer_event", { phone: "51900000003", kind: "answered", sourceRef: "wamid.a2" });
await call(null, "customer_event", { phone: CUSTOMER, kind: "rated_yes" });
check("before the summary hour nothing is sent", (await call(null, "summaries", {}, undefined)).data.summaries, []);
now = new Date("2026-11-16T01:05:00Z"); // 20:05 in Lima
result = await call(null, "summaries", {}, undefined);
check("the daily summary at 20:00",
  result.data.summaries.map((s: any) => [s.companyId, s.ownerPhones, s.phoneNumberId, s.text]),
  [["org_jd", ["51911111111"], "1266091906580349",
    "🛟 *Support Cat · CREACIONES J&D* — resumen de hoy\n3 clientes escribieron; resolví 2 consultas solo y mandé 1 cotización.\nTe pasé 2 casos.\n«¿Te ayudé?»: 1 sí, 0 no.\nPendientes (1): #1 Rosa Díaz. Escribe /support para verlos."]]);
check("only once a day", (await call(null, "summaries", {}, undefined)).data.summaries, []);
await call(1, "close_ticket", { ticketId: complaint.id });
check("closing the complaint leaves nothing open", (await call(1, "pending")).data.open, []);

// Portal and the weekly line.
check("a stranger does not see the portal page", (await portal.view("someone", "org_jd")).status, "forbidden");
result = await portal.view("member-2", "org_jd") as any;
check("the portal page", { owner: result.support.owner, faqs: result.support.faqs.length, open: result.support.open.length, recent: result.support.recent.length, phone: result.support.phoneNumberId },
  { owner: false, faqs: 2, open: 0, recent: 2, phone: "1266091906580349" });
const faqId = result.support.faqs[1].id;
result = await portal.faq("owner-1", "org_jd", { id: faqId, remove: true }) as any;
check("the owner removes a question", result.support.faqs.map((f: any) => f.question), ["¿Cuál es el horario?"]);
const weekly = new PortalWeeklyService(pool as never, { decrypt: () => "" } as never, "http://facturaya.invalid", () => undefined, () => now);
check("the weekly line", await (weekly as any).support("org_jd", new Date("2026-11-09T05:00:00Z")), { enabled: true, customers: 3, answered: 3, escalated: 2, open: 0 });
check("off for a company without Support Cat", (await (weekly as any).support("org_off", new Date("2026-11-09T05:00:00Z"))).enabled, false);

await pool.end();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
