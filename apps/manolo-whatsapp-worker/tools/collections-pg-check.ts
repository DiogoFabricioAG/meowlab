// Integration check of Collections Cat's data service against a real PostgreSQL (ADR-0015).
// Needs an empty database, e.g. a throwaway container. Never point it at production.
//   COLLECTIONS_CHECK_DATABASE_URL=postgres://... npx esbuild tools/collections-pg-check.ts --bundle --platform=node --format=esm \
//     --packages=external --outfile=node_modules/.cache/collections-pg-check.mjs && node node_modules/.cache/collections-pg-check.mjs
import { readFileSync } from "node:fs";
import pg from "pg";
import { CollectionsService, type CreditDocument } from "../src/node/collections/collections-service";
import { PortalCollectionsService } from "../src/node/collections/portal-collections-service";
import { PortalWeeklyService } from "../src/node/portal/weekly-service";
import type { BridgeRequestStore } from "../src/node/bridge/request-store";
import type { CollectionsBridgeRequest } from "../src/collections/bridge-contracts";

const url = process.env.COLLECTIONS_CHECK_DATABASE_URL;
if (!url) throw new Error("COLLECTIONS_CHECK_DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: url, max: 5 });

await pool.query(`CREATE SCHEMA whatsapp;
  CREATE TABLE whatsapp.tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', legal_name TEXT, ruc TEXT, address TEXT);
  CREATE TABLE whatsapp.contacts (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, whatsapp_user_id TEXT NOT NULL);
  CREATE TABLE whatsapp.tenant_members (tenant_id TEXT, contact_id BIGINT, status TEXT NOT NULL DEFAULT 'active');
  CREATE TABLE whatsapp.portal_company_members (tenant_id TEXT NOT NULL, portal_user_id TEXT NOT NULL, role TEXT NOT NULL);
  CREATE TABLE whatsapp.portal_whatsapp_links (portal_user_id TEXT PRIMARY KEY, wa_phone TEXT NOT NULL UNIQUE, linked_at TIMESTAMPTZ NOT NULL DEFAULT now());
  INSERT INTO whatsapp.tenants (id, name) VALUES ('manolo', 'Manolo'), ('org_jd', 'CREACIONES J&D'), ('org_off', 'Sin Cobranzas');
  INSERT INTO whatsapp.contacts VALUES (1, 'manolo', '51911111111'), (2, 'manolo', '51922222222'), (3, 'manolo', '51933333333');
  INSERT INTO whatsapp.tenant_members VALUES ('org_jd', 1, 'active'), ('org_jd', 2, 'active'), ('org_off', 1, 'active');
  INSERT INTO whatsapp.portal_company_members VALUES ('org_jd', 'owner-1', 'owner'), ('org_jd', 'member-2', 'member');
  INSERT INTO whatsapp.portal_whatsapp_links (portal_user_id, wa_phone) VALUES ('owner-1', '51911111111'), ('member-2', '51922222222');`);
await pool.query(readFileSync("infra/postgres/migrations/014-sales-cat.sql", "utf8"));
const migration = readFileSync("infra/postgres/migrations/019-collections-cat.sql", "utf8");
await pool.query(migration);
await pool.query(migration); // re-runnable
await pool.query("INSERT INTO receivables.settings (tenant_id, documents_since) VALUES ('org_jd', '2026-11-01')");

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
let documents: CreditDocument[] = [];
// Friday 14/11/2026, 10:00 in Lima.
let now = new Date("2026-11-14T15:00:00Z");
const service = new CollectionsService(pool, store, () => undefined, { async read() { return documents; } }, () => now);
let requests = 0;
const call = async (contactId: number, operation: CollectionsBridgeRequest["operation"], payload: Record<string, unknown> = {},
  company: string | undefined = "org_jd", requestId = `req-${++requests}`) => {
  const result = await service.process({ channel_tenant_id: "manolo", contact_id: contactId, operation, ...(company ? { company_id: company } : {}), payload }, requestId, requestId);
  return result.status === "completed" ? result.response as any : { status: result.status };
};

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` -> ${JSON.stringify(actual)}`}`);
  if (!ok) failures++;
}

check("companies: only those with Collections Cat on", (await call(1, "companies", {}, undefined)).data.companies.map((c: any) => c.id), ["org_jd"]);
check("a company without Collections Cat is refused", (await call(1, "overview", {}, "org_off")).error.code, "forbidden");
check("a contact outside the company is refused", (await call(3, "overview")).error.code, "forbidden");

// Debts said in the chat.
let result = await call(2, "add_debt", { customer: "Juan Pérez", amountCents: 20000, description: "polos" });
check("a debt said in the chat is due in 30 days by default", { due: result.data.debt.dueOn, late: result.data.debt.daysLate, balance: result.data.customerBalanceCents },
  { due: "2026-12-14", late: -30, balance: 20000 });
const juanDebt = result.data.debt.id;
result = await call(2, "add_debt", { customer: "juan pérez", amountCents: 5000, dueOn: "2026-11-10", phone: "51911222333" });
check("the same customer in another case adds to their balance", result.data.customerBalanceCents, 25000);
check("…and their phone is kept", (await pool.query("SELECT count(*)::int AS n, max(phone) AS phone FROM commerce.customers")).rows[0], { n: 1, phone: "51911222333" });
const replay = await call(2, "add_debt", { customer: "Juan Pérez", amountCents: 20000, description: "polos" }, "org_jd", "req-4");
check("replaying a request does not add the debt twice", [replay.replayed, (await pool.query("SELECT count(*)::int AS n FROM receivables.debts")).rows[0].n], [true, 2]);

// Payments: oldest due first, partial allowed, Sales Cat sale kept in step.
result = await call(2, "record_payment", { customer: "Juan", amountCents: 7000, method: "efectivo", fromCapture: false });
check("a payment covers the oldest debt first and the rest goes to the next",
  { applied: result.data.applied.map((a: any) => [a.amountCents, a.balanceCents]), balance: result.data.customerBalanceCents },
  { applied: [[5000, 0], [2000, 18000]], balance: 18000 });
check("the paid debt is closed", (await pool.query("SELECT status, count(*)::int AS n FROM receivables.debts GROUP BY 1 ORDER BY 1")).rows,
  [{ status: "open", n: 1 }, { status: "paid", n: 1 }]);
check("an unknown customer is not found", (await call(2, "record_payment", { customer: "Rosa", amountCents: 100, method: "yape", fromCapture: false })).error,
  { code: "not_found", details: { customer: "Rosa" } });

// Captures stay pending until someone validates them.
result = await call(2, "record_payment", { customer: "Juan Pérez", amountCents: 3000, method: "yape", operationNumber: "OP-1", fromCapture: true });
const pendingId = result.data.pending.id;
check("a capture is pending and does not lower the balance", [result.data.pending.amountCents, result.data.customerBalanceCents], [3000, 18000]);
check("the same operation number cannot be reported twice",
  (await call(2, "record_payment", { customer: "Juan Pérez", amountCents: 3000, method: "yape", operationNumber: "OP-1", fromCapture: true })).error.code,
  "duplicate_operation");
result = await call(1, "decide_payment", { paymentId: pendingId, approve: true });
check("validating it applies the amount", [result.data.approved, result.data.customerBalanceCents], [true, 15000]);
check("a decided capture cannot be decided again", (await call(2, "decide_payment", { paymentId: pendingId, approve: false })).error.code, "already_decided");
result = await call(2, "record_payment", { customer: "Juan Pérez", amountCents: 1000, method: "plin", fromCapture: true });
await call(2, "decide_payment", { paymentId: result.data.pending.id, approve: false });
check("a rejected capture does not count", (await pool.query("SELECT sum(balance_cents)::int AS b FROM receivables.debts WHERE status = 'open'")).rows[0].b, 15000);
check("who decided is logged", (await pool.query("SELECT action, contact_id::int FROM receivables.audit_log WHERE action LIKE '%_payment' ORDER BY created_at")).rows
  .map((row) => `${row.action}:${row.contact_id}`), ["record_payment:2", "approve_payment:1", "reject_payment:2"]);

// CollectionsService.remind() currently writes CURRENT_TIMESTAMP in SQL instead of this.now().
// Sync the recorded reminder timestamp to the simulated clock so overview() stays deterministic.
async function syncReminderTimestamp(at: Date, customer: string) {
  const iso = at.toISOString();
  await pool.query(
    `UPDATE receivables.debts
        SET last_reminder_at = $1, updated_at = $1
      WHERE tenant_id = 'org_jd'
        AND customer_id IN (SELECT id FROM commerce.customers WHERE tenant_id = 'org_jd' AND name = $2)
        AND last_reminder_at IS NOT NULL`,
    [iso, customer],
  );
  await pool.query(
    `UPDATE receivables.reminders
        SET created_at = $1
      WHERE debt_id IN (
        SELECT d.id FROM receivables.debts d
        JOIN commerce.customers c ON c.id = d.customer_id
        WHERE d.tenant_id = 'org_jd' AND c.name = $2
      )`,
    [iso, customer],
  );
}

// Reminders.
check("without a phone there is no reminder", (await call(2, "add_debt", { customer: "Bodega Rosita", amountCents: 35000, dueOn: "2026-11-15" }),
  (await call(2, "remind", { customer: "Bodega Rosita" })).error), { code: "no_phone", details: { customer: "Bodega Rosita" } });
await call(2, "set_customer", { customer: "Bodega Rosita", phone: "51944555666" });
result = await call(2, "remind", { customer: "Bodega Rosita" });
await syncReminderTimestamp(now, "Bodega Rosita");
check("a reminder before the due date is friendly and carries the payment options",
  { tone: result.data.tone, phone: result.data.debt.phone, company: result.data.companyName, yape: result.data.payment.yapePhone, outside: result.data.outsideWindow },
  { tone: "friendly", phone: "51944555666", company: "CREACIONES J&D", yape: null, outside: false });
check("only the owner changes the rules", (await call(2, "settings", { change: { yapePhone: "987654321" } })).error.code, "owner_only");
check("the owner sets Yape and two reminders", (await call(1, "settings", { change: { yapePhone: "987654321", maxReminders: 2 } })).data.settings.yapePhone, "987654321");
check("a window that ends before it starts is refused", (await call(1, "settings", { change: { windowStartHour: 18 } }, "org_jd"),
  (await call(1, "settings", { change: { windowEndHour: 10 } })).error.code), "invalid_window");
await call(2, "set_customer", { customer: "Juan Pérez", doNotContact: true });
check("a customer who asked not to be written to gets no reminder", (await call(2, "remind", { customer: "Juan Pérez" })).error.code, "do_not_contact");

// Overview: what to do today and who needs the owner.
now = new Date("2026-11-20T15:00:00Z");
result = await call(2, "overview");
check("Rosita is due for a reminder after its due date; Juan, who asked not to be written to, goes to the owner",
  { remind: result.data.toRemind.map((d: any) => d.customer), owner: result.data.escalated.map((d: any) => d.customer) },
  { remind: ["Bodega Rosita"], owner: [] });
await call(2, "remind", { customer: "Bodega Rosita" });
await syncReminderTimestamp(now, "Bodega Rosita");
now = new Date("2026-11-28T15:00:00Z");
result = await call(2, "overview");
check("after its last reminder and a week without paying, Rosita goes to the owner too",
  result.data.escalated.map((d: any) => d.customer), ["Bodega Rosita"]);
check("Juan's debt goes to the owner once it is late", (now = new Date("2026-12-20T15:00:00Z"), (await call(2, "overview")).data.escalated.map((d: any) => d.customer)),
  ["Bodega Rosita", "Juan Pérez"]);

// Sales Cat's credit sales and FacturaYa's credit invoices come in by themselves, once.
await pool.query(`INSERT INTO sales.sales (id, tenant_id, number, customer_name, payment_method, subtotal_cents, total_cents, balance_cents, sold_at, invoice_number)
  VALUES ('00000000-0000-4000-8000-000000000001', 'org_jd', 1, 'Imprenta Lucho', 'credito', 40000, 40000, 40000, '2026-12-01T15:00:00Z', 'F001-10'),
         ('00000000-0000-4000-8000-000000000002', 'org_jd', 2, 'Cliente contado', 'efectivo', 1000, 1000, 0, '2026-12-01T15:00:00Z', NULL)`);
documents = [
  { kind: "invoice", id: "inv-10", number: "F001-10", status: "accepted", issueDate: "2026-12-01", customer: { docType: "6", docNumber: "20131312955", name: "IMPRENTA LUCHO SAC" },
    totalCents: 40000, credit: true, outstandingCents: 40000, firstDueDate: "2026-12-31" },
  { kind: "invoice", id: "inv-11", number: "F001-11", status: "accepted", issueDate: "2026-12-02", customer: { docType: "6", docNumber: "20100070970", name: "SUPERMERCADOS PERUANOS" },
    totalCents: 118000, credit: true, outstandingCents: 100000, firstDueDate: "2027-01-02" },
  { kind: "invoice", id: "inv-12", number: "F001-12", status: "accepted", issueDate: "2026-12-02", customer: { docType: "6", docNumber: "20100070970", name: "SUPERMERCADOS PERUANOS" },
    totalCents: 5000, credit: false, outstandingCents: null, firstDueDate: null },
  { kind: "credit_note", id: "nc-1", number: "FC01-1", status: "accepted", relatedNumber: "F001-11", totalCents: 20000 },
];
now = new Date("2026-12-03T15:00:00Z");
result = await call(2, "overview");
check("the credit sale and the credit invoice come in; the invoice of the sale and the cash one do not", result.data.sync, { added: 2, creditNotes: 1, available: true });
check("the credit note lowered its invoice; the due date comes from its first installment",
  (await pool.query("SELECT document_number, balance_cents::int, due_on::text FROM receivables.debts WHERE source = 'invoice'")).rows,
  [{ document_number: "F001-11", balance_cents: 80000, due_on: "2027-01-02" }]);
check("…and not twice", (await call(2, "overview")).data.sync, { added: 0, creditNotes: 0, available: true });
const sale = await pool.query("SELECT id FROM receivables.debts WHERE source = 'sale'");
await call(2, "record_payment", { debtId: sale.rows[0].id, amountCents: 15000, method: "transferencia", fromCapture: false });
check("paying a credit sale updates Sales Cat's balance", (await pool.query("SELECT balance_cents::int FROM sales.sales WHERE number = 1")).rows[0].balance_cents, 25000);

// Questions.
check("how much and how old", (await call(2, "query", { type: "owed" })).data,
  { totalCents: 15000 + 35000 + 25000 + 80000, buckets: { current: 120000, d1_30: 35000, d31_60: 0, d61: 0 }, customers: 4, lateCount: 1 });
check("who owes the most", (await call(2, "query", { type: "top" })).data.customers.map((c: any) => [c.customer, c.balanceCents]),
  [["SUPERMERCADOS PERUANOS", 80000], ["Bodega Rosita", 35000], ["Imprenta Lucho", 25000], ["Juan Pérez", 15000]]);
check("what came in this month, without credit notes", (await call(2, "query", { type: "paid", period: "month" })).data.totalCents, 15000);

// Portal and «Inicio».
const portal = new PortalCollectionsService(pool, service, () => undefined);
const view = await portal.view("member-2", "org_jd") as any;
check("the portal shows debts with the customer's data to any member",
  [view.collections.enabled, view.collections.owner, view.collections.debts.find((d: any) => d.customer === "SUPERMERCADOS PERUANOS").docNumber],
  [true, false, "20100070970"]);
check("only the owner changes rules from the portal", (await portal.settings("member-2", "org_jd", { maxReminders: 5 })).status, "owner_only");
check("the owner does", ((await portal.settings("owner-1", "org_jd", { maxReminders: 5 })) as any).collections.settings.maxReminders, 5);
check("a stranger sees nothing", (await portal.view("someone", "org_jd")).status, "forbidden");
const weekly = await (new PortalWeeklyService(pool as any, { decrypt: () => "" }, "https://facturaya.invalid", () => undefined, () => now) as any).collections("org_jd", "2026-11-30", "2026-12-03");
check("«Inicio» shows what is owed and who needs the owner", weekly, { enabled: true, owedCents: 155000, lateCount: 1, needsOwner: 2, paidWeekCents: 15000 });

await pool.end();
if (failures) {
  console.log(`${failures} collections checks failed`);
  process.exit(1);
}
console.log("all collections checks passed");
