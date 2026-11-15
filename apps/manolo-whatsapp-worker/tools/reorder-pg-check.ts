// Integration check of Reorder Cat's data service against a real PostgreSQL (ADR-0016).
// Needs an empty database, e.g. a throwaway container. Never point it at production.
//   REORDER_CHECK_DATABASE_URL=postgres://... npx esbuild tools/reorder-pg-check.ts --bundle --platform=node --format=esm \
//     --packages=external --outfile=node_modules/.cache/reorder-pg-check.mjs && node node_modules/.cache/reorder-pg-check.mjs
import { readFileSync } from "node:fs";
import pg from "pg";
import { ReorderService, type PurchaseOrderPdfInput } from "../src/node/reorder/reorder-service";
import { PortalReorderService } from "../src/node/reorder/portal-reorder-service";
import { StockService } from "../src/node/stock/stock-service";
import { PortalWeeklyService } from "../src/node/portal/weekly-service";
import type { BridgeRequestStore } from "../src/node/bridge/request-store";
import type { ReorderBridgeRequest } from "../src/reorder/bridge-contracts";
import type { StockBridgeRequest } from "../src/stock/bridge-contracts";

const url = process.env.REORDER_CHECK_DATABASE_URL;
if (!url) throw new Error("REORDER_CHECK_DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: url, max: 5 });

await pool.query(`CREATE SCHEMA whatsapp;
  CREATE TABLE whatsapp.tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', legal_name TEXT, ruc TEXT, address TEXT);
  CREATE TABLE whatsapp.contacts (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, whatsapp_user_id TEXT NOT NULL);
  CREATE TABLE whatsapp.tenant_members (tenant_id TEXT, contact_id BIGINT, status TEXT NOT NULL DEFAULT 'active');
  CREATE TABLE whatsapp.portal_company_members (tenant_id TEXT NOT NULL, portal_user_id TEXT NOT NULL, role TEXT NOT NULL);
  CREATE TABLE whatsapp.portal_whatsapp_links (portal_user_id TEXT PRIMARY KEY, wa_phone TEXT NOT NULL UNIQUE, linked_at TIMESTAMPTZ NOT NULL DEFAULT now());
  INSERT INTO whatsapp.tenants (id, name, legal_name, ruc, address) VALUES ('manolo', 'Manolo', NULL, NULL, NULL),
    ('org_jd', 'CREACIONES J&D', 'CREACIONES J&D', '10410461248', 'RIMAC, LIMA'), ('org_off', 'Sin Reorder', NULL, NULL, NULL);
  INSERT INTO whatsapp.contacts VALUES (1, 'manolo', '51911111111'), (2, 'manolo', '51922222222'), (3, 'manolo', '51933333333');
  INSERT INTO whatsapp.tenant_members VALUES ('org_jd', 1, 'active'), ('org_jd', 2, 'active'), ('org_off', 1, 'active');
  INSERT INTO whatsapp.portal_company_members VALUES ('org_jd', 'owner-1', 'owner'), ('org_jd', 'member-2', 'member');
  INSERT INTO whatsapp.portal_whatsapp_links (portal_user_id, wa_phone) VALUES ('owner-1', '51911111111'), ('member-2', '51922222222');`);
await pool.query(readFileSync("infra/postgres/migrations/018-stock-cat.sql", "utf8"));
const migration = readFileSync("infra/postgres/migrations/020-reorder-cat.sql", "utf8");
await pool.query(migration);
await pool.query(migration); // re-runnable
await pool.query("INSERT INTO stock.settings (tenant_id) VALUES ('org_jd'), ('org_off')");
await pool.query("INSERT INTO purchasing.settings (tenant_id) VALUES ('org_jd')");

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
// Saturday 14/11/2026, 10:00 in Lima.
let now = new Date("2026-11-14T15:00:00Z");
const rendered: PurchaseOrderPdfInput[] = [];
const reorder = new ReorderService(pool, store, () => undefined, {
  async render(order) { rendered.push(order); return new TextEncoder().encode(`%PDF-1.4 ${"x".repeat(120)}`); },
}, () => now);
const stock = new StockService(pool, store, () => undefined, null, () => now, reorder);
let requests = 0;
const call = async (contactId: number | null, operation: ReorderBridgeRequest["operation"], payload: Record<string, unknown> = {},
  company: string | undefined = "org_jd", requestId = `req-${++requests}`) => {
  const result = await reorder.process({ channel_tenant_id: "manolo", ...(contactId !== null ? { contact_id: contactId } : {}), operation,
    ...(company ? { company_id: company } : {}), payload }, requestId, requestId);
  return result.status === "completed" ? result.response as any : { status: result.status };
};
const stockCall = async (contactId: number, operation: StockBridgeRequest["operation"], payload: Record<string, unknown>) => {
  const requestId = `stock-${++requests}`;
  const result = await stock.process({ channel_tenant_id: "manolo", contact_id: contactId, operation, company_id: "org_jd", payload }, requestId, requestId);
  return result.status === "completed" ? result.response as any : { status: result.status };
};

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` -> ${JSON.stringify(actual)}`}`);
  if (!ok) failures++;
}

check("companies: only those with Reorder Cat on", (await call(1, "companies", {}, undefined)).data.companies.map((c: any) => c.id), ["org_jd"]);
check("a company without Reorder Cat is refused", (await call(1, "overview", {}, "org_off")).error.code, "forbidden");
check("a contact outside the company is refused", (await call(3, "overview")).error.code, "forbidden");
check("a person cannot use the platform's operations", (await call(1, "followups", {}, undefined)).error.code, "forbidden");

// Stock: three products and an input, with minimums and costs.
await stockCall(1, "move", { kind: "in", lines: [
  { name: "Polo blanco M", quantity: 20, unitCostCents: 1200 },
  { name: "Polo negro L", quantity: 10, unitCostCents: 1300 },
  { name: "Polo estampado", quantity: 8 },
  { name: "Taza blanca", quantity: 30 },
] });
for (const [name, minQty] of [["Polo blanco M", 10], ["Polo negro L", 5], ["Polo estampado", 5], ["Taza blanca", 10]] as const) {
  await stockCall(1, "set_min", { name, minQty });
}
await stockCall(1, "move", { kind: "out", lines: [{ name: "Polo blanco M", quantity: 15 }, { name: "Polo negro L", quantity: 6 }, { name: "Polo estampado", quantity: 5 }] });

let result = await call(2, "overview");
check("below the minimum without a maximum: asked for, nothing proposed",
  { created: result.data.created.length, needsMax: result.data.needsMax, needsSupplier: result.data.needsSupplier, owner: result.data.owner },
  { created: 0, needsMax: ["Polo blanco M", "Polo estampado", "Polo negro L"], needsSupplier: [], owner: false });
check("only the owner sets the maximum", (await call(2, "set_rule", { item: "Polo blanco M", maxQty: 50 })).error.code, "owner_only");
check("an unknown product is not found", (await call(1, "set_rule", { item: "Gorra", maxQty: 5 })).error, { code: "item_not_found", details: { item: "Gorra" } });
result = await call(1, "set_rule", { item: "polo blanco m", maxQty: 50 });
check("the owner sets the maximum", result.data.rule, { item: "Polo blanco M", onHand: 5, minQty: 10, supplyType: "purchase", maxQty: 50, supplier: null, supplierPhone: null });
await call(1, "set_rule", { item: "Polo negro L", maxQty: 20 });
await call(1, "set_rule", { item: "Polo estampado", maxQty: 30, supplyType: "manufacture" });

result = await call(1, "overview");
check("a product made in-house becomes a production order; bought ones wait for a supplier",
  { created: result.data.created.map((o: any) => [o.kind, o.number, o.lines.map((l: any) => [l.item, l.quantity])]), needsSupplier: result.data.needsSupplier },
  { created: [["production", 1, [["Polo estampado", 27]]]], needsSupplier: ["Polo blanco M", "Polo negro L"] });
const production = result.data.created[0].id;

result = await call(2, "set_supplier", { name: "Textiles Lima", phone: "51987654321", items: ["Polo blanco M", "polo negro l", "Gorra"] });
check("anyone in the team adds a supplier and what it sells",
  result.data, { supplier: { name: "Textiles Lima", phone: "51987654321", ruc: null }, linked: ["Polo blanco M", "Polo negro L"], notFound: ["Gorra"] });
result = await call(1, "propose");
const purchase = result.data.created[0];
check("one order per supplier, up to the maximum, estimated with the stock's average cost",
  { kind: purchase.kind, number: purchase.number, supplier: purchase.supplier.name, lines: purchase.lines.map((l: any) => [l.item, l.quantity, l.unitPriceCents]), estimated: purchase.estimatedCents },
  { kind: "purchase", number: 2, supplier: "Textiles Lima", lines: [["Polo blanco M", 45, 1200], ["Polo negro L", 16, 1300]], estimated: 74800 });
check("proposing again does not repeat what is already proposed", (await call(1, "propose")).data.created.length, 0);

// Changing a proposal.
check("only the owner changes a proposal", (await call(2, "change_line", { orderId: purchase.id, item: "negro", quantity: 10 })).error.code, "owner_only");
result = await call(1, "change_line", { orderId: purchase.id, item: "negro", quantity: 10 });
check("the owner changes a quantity and the estimate follows", [result.data.order.lines.map((l: any) => l.quantity), result.data.order.estimatedCents], [[45, 10], 67000]);

// Budget.
check("the budget belongs to the owner", (await call(2, "settings", { change: { monthlyBudgetCents: 50000 } })).error.code, "owner_only");
check("the escalation must come after the follow-up", (await call(1, "settings", { change: { escalateHours: 12 } })).error.code, "invalid_settings");
await call(1, "settings", { change: { monthlyBudgetCents: 50000 } });
result = await call(1, "approve", { orderId: purchase.id });
check("an order over the monthly budget asks first", result.error, { code: "over_budget", details: { spentCents: 0, budgetCents: 50000, orderCents: 67000 } });
check("only the owner approves", (await call(2, "approve", { orderId: purchase.id, force: true })).error.code, "owner_only");
result = await call(1, "approve", { orderId: purchase.id, force: true });
check("approved anyway: stays proposed until it is sent", [result.data.order.status, result.data.order.approved, result.data.companyName], ["proposed", true, "CREACIONES J&D"]);
result = await call(1, "mark_sent", { orderId: purchase.id, sent: true, phoneNumberId: "1112223334" });
check("sent from MeowLab's number", result.data.order.status, "sent");
result = await call(1, "approve", { orderId: production });
check("a production order starts when approved", result.data.order.status, "in_production");

// The PDF.
result = await call(1, "order_pdf", { orderId: purchase.id });
check("the purchase order PDF is drawn with the company, supplier and lines",
  { file: result.data.pdf.filename, company: rendered[0].company.ruc, supplier: rendered[0].supplier.name, lines: rendered[0].lines.length, number: rendered[0].number },
  { file: "Orden-de-compra-000002.pdf", company: "10410461248", supplier: "Textiles Lima", lines: 2, number: 2 });

// The supplier answers.
result = await call(null, "supplier_match", { phone: "51987654321" }, undefined);
check("the supplier's WhatsApp finds the order sent to them", result.data.matches.map((m: any) => [m.companyId, m.order.number, m.pdfSent]), [["org_jd", 2, false]]);
check("another WhatsApp finds nothing", (await call(null, "supplier_match", { phone: "51900000000" }, undefined)).data.matches, []);
check("someone else cannot answer for the supplier",
  (await call(null, "supplier_reply", { orderId: purchase.id, phone: "51900000000", reply: { outcome: "accepted" } })).error.code, "forbidden");
result = await call(null, "supplier_reply", { orderId: purchase.id, phone: "51987654321",
  reply: { outcome: "accepted", deliverBy: "2026-11-18", totalCents: 66000, unitPrices: [{ item: "Polo blanco M", unitPriceCents: 1150 }], note: "Mando el martes" } });
check("accepted: confirmed with date, total and the new price, owner told, PDF to send",
  { status: result.data.order.status, deliverBy: result.data.order.deliverBy, confirmed: result.data.order.confirmedCents,
    price: result.data.order.lines[0].unitPriceCents, owners: result.data.ownerPhones, sendPdf: result.data.sendPdf, phone: result.data.phoneNumberId,
    notice: result.data.notice.body },
  { status: "confirmed", deliverBy: "2026-11-18", confirmed: 66000, price: 1150, owners: ["51911111111"], sendPdf: true, phone: "1112223334",
    notice: "Textiles Lima confirmó el pedido OC-000002, con entrega el 18/11, por S/ 660.00. Dice: «Mando el martes»." });
check("the supplier's price is remembered for next time",
  (await pool.query("SELECT last_unit_cost_cents::int AS cents FROM purchasing.item_rules r JOIN stock.items i ON i.id = r.item_id WHERE i.name = 'Polo blanco M'")).rows[0].cents, 1150);
result = await call(null, "supplier_reply", { orderId: purchase.id, phone: "51987654321", reply: { outcome: "other", note: "¿A qué dirección?" } });
check("a second message is passed on and the PDF is not sent twice", [result.data.sendPdf, result.data.order.status, result.data.notice.body],
  [false, "confirmed", "Textiles Lima respondió sobre el pedido OC-000002: «¿A qué dirección?»."]);

// Notices wait for the owner until delivered.
result = await call(2, "overview");
check("the notices wait in the overview", result.data.notices.length, 2);
await call(null, "notices_delivered", { ids: result.data.notices.map((n: any) => n.id) });
check("delivered notices are not shown again", (await call(2, "overview")).data.notices.length, 0);

// Receiving through Stock Cat.
result = await stockCall(2, "move", { kind: "in", lines: [{ name: "Polo blanco M", quantity: 30 }] });
check("a partial entry: the order is partial and says what is missing", result.data.received,
  [{ number: 2, kind: "purchase", supplier: "Textiles Lima", complete: false, missing: [{ item: "Polo blanco M", quantity: 15 }, { item: "Polo negro L", quantity: 10 }] }]);
result = await stockCall(2, "move", { kind: "in", lines: [{ name: "Polo blanco M", quantity: 20 }, { name: "Polo negro L", quantity: 10 }] });
check("the rest arrives: received, and the extra 5 polos stay in stock",
  [result.data.received, (await pool.query("SELECT status FROM purchasing.orders WHERE number = 2")).rows[0].status],
  [[{ number: 2, kind: "purchase", supplier: "Textiles Lima", complete: true, missing: [] }], "received"]);
result = await stockCall(2, "move", { kind: "in", lines: [{ name: "Polo estampado", quantity: 27 }] });
check("finished production closes the production order", result.data.received, [{ number: 1, kind: "production", supplier: null, complete: true, missing: [] }]);

// A supplier read from a purchase invoice photo.
result = await stockCall(2, "move", { kind: "in", lines: [{ name: "Taza blanca", quantity: 5, unitCostCents: 800 }], supplier: { name: "Cerámicas Perú SAC", ruc: "20123456789" } });
check("the supplier on the invoice is remembered for its products, with the cost",
  (await pool.query(`SELECT s.name, s.ruc, r.last_unit_cost_cents::int AS cents FROM purchasing.item_rules r JOIN purchasing.suppliers s ON s.id = r.supplier_id
    JOIN stock.items i ON i.id = r.item_id WHERE i.name = 'Taza blanca'`)).rows[0], { name: "Cerámicas Perú SAC", ruc: "20123456789", cents: 800 });
await call(2, "set_supplier", { name: "Ceramicas Peru SAC", ruc: "20123456789", phone: "51955555555" });
check("the same RUC under another spelling is the same supplier",
  (await pool.query("SELECT count(*)::int AS n, max(phone) AS phone FROM purchasing.suppliers WHERE ruc = '20123456789'")).rows[0], { n: 1, phone: "51955555555" });

// Follow-ups and escalation.
await stockCall(1, "move", { kind: "out", lines: [{ name: "Taza blanca", quantity: 30 }] });
await call(1, "set_rule", { item: "Taza blanca", maxQty: 40 });
result = await call(1, "propose");
const cups = result.data.created[0];
check("cups go to the invoice's supplier", [cups.supplier.name, cups.lines[0].quantity, cups.estimatedCents], ["Cerámicas Perú SAC", 35, 28000]);
await call(1, "approve", { orderId: cups.id, force: true });
await call(1, "mark_sent", { orderId: cups.id, sent: true, phoneNumberId: "1112223334" });
now = new Date("2026-11-15T14:00:00Z"); // 23 h later
check("nothing due before 24 hours", (await call(null, "followups", {}, undefined)).data, { reminders: [], escalations: [] });
now = new Date("2026-11-15T16:00:00Z"); // 25 h later, 11:00 in Lima
result = await call(null, "followups", {}, undefined);
check("one reminder after 24 hours, from the same number", result.data.reminders.map((r: any) => [r.order.number, r.phoneNumberId, r.companyName]), [[3, "1112223334", "CREACIONES J&D"]]);
check("the reminder is not repeated", (await call(null, "followups", {}, undefined)).data.reminders.length, 0);
now = new Date("2026-11-17T03:00:00Z"); // 22:00 in Lima, after 48 h
check("nobody is written to at night", (await call(null, "followups", {}, undefined)).data, { reminders: [], escalations: [] });
now = new Date("2026-11-17T13:30:00Z"); // 8:30 in Lima
result = await call(null, "followups", {}, undefined);
check("after 48 hours without an answer it goes to the owner", result.data.escalations.map((e: any) => [e.companyName, e.ownerPhones, e.notice.body]),
  [["CREACIONES J&D", ["51911111111"], "Cerámicas Perú SAC no respondió el pedido OC-000003, ni después de recordárselo. Conviene que lo llames tú (+51955555555) o elijas otro proveedor."]]);
check("the escalation is not repeated", (await call(null, "followups", {}, undefined)).data.escalations.length, 0);
result = await call(null, "supplier_reply", { orderId: cups.id, phone: "51955555555", reply: { outcome: "declined", note: "Sin stock" } });
check("declined: closed and passed to the owner", [result.data.order.status, result.data.notice.body],
  ["declined", "Cerámicas Perú SAC no puede atender el pedido OC-000003. Dice: «Sin stock». Conviene que le escribas tú o elijas otro proveedor."]);

// Queries, discard, portal and the weekly line.
result = await call(2, "query", { type: "month" });
check("purchases this month by supplier (declined ones out)", [result.data.month, result.data.totalCents, result.data.budgetCents],
  [[{ supplier: "Textiles Lima", orders: 1, totalCents: 66000 }], 66000, 50000]);
result = await call(1, "propose");
check("a declined order is proposed again", result.data.created.map((o: any) => o.number), [4]);
result = await call(1, "discard", { orderId: result.data.created[0].id });
check("the owner discards a proposal", result.data.order.status, "cancelled");
check("pending: nothing on its way now", (await call(2, "query", { type: "pending" })).data.pending, []);

const portal = new PortalReorderService(pool, reorder, () => undefined);
check("a stranger does not see the portal page", (await portal.view("someone", "org_jd")).status, "forbidden");
result = await portal.view("member-2", "org_jd") as any;
check("a member sees suppliers and the month in the portal",
  { owner: result.reorder.owner, suppliers: result.reorder.suppliers.map((s: any) => [s.name, s.items]), month: result.reorder.monthSpentCents },
  { owner: false, suppliers: [["Cerámicas Perú SAC", ["Taza blanca"]], ["Textiles Lima", ["Polo blanco M", "Polo negro L"]]], month: 66000 });
check("only the owner changes settings in the portal", (await portal.settings("member-2", "org_jd", { followupHours: 12 })).status, "owner_only");
result = await portal.settings("owner-1", "org_jd", { followupHours: 12, escalateHours: 36 }) as any;
check("the owner changes the waiting times", [result.reorder.settings.followupHours, result.reorder.settings.escalateHours], [12, 36]);
check("an invalid change is refused", (await portal.settings("owner-1", "org_jd", { escalateHours: 6 })).status, "invalid_settings");

const weekly = new PortalWeeklyService(pool as never, { decrypt: () => "" } as never, "http://facturaya.invalid", () => undefined, () => now);
result = await (weekly as any).reorder("org_jd", now);
check("the weekly line", result, { enabled: true, toApprove: 0, waiting: 0, escalated: 1, monthSpentCents: 66000 });
check("off for a company without Reorder Cat", (await (weekly as any).reorder("org_off", now)).enabled, false);

await pool.end();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
