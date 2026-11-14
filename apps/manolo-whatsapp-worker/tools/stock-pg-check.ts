// Integration check of Stock Cat's data service against a real PostgreSQL (ADR-0014).
// Needs an empty database, e.g. a throwaway container. Never point it at production.
//   STOCK_CHECK_DATABASE_URL=postgres://... npx esbuild tools/stock-pg-check.ts --bundle --platform=node --format=esm \
//     --packages=external --outfile=node_modules/.cache/stock-pg-check.mjs && node node_modules/.cache/stock-pg-check.mjs
import { readFileSync } from "node:fs";
import pg from "pg";
import { StockService, type IssuedDocument } from "../src/node/stock/stock-service";
import { PortalStockService } from "../src/node/stock/portal-stock-service";
import { PortalWeeklyService } from "../src/node/portal/weekly-service";
import type { BridgeRequestStore } from "../src/node/bridge/request-store";
import type { StockBridgeRequest } from "../src/stock/bridge-contracts";

const url = process.env.STOCK_CHECK_DATABASE_URL;
if (!url) throw new Error("STOCK_CHECK_DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: url, max: 5 });

await pool.query(`CREATE SCHEMA whatsapp;
  CREATE TABLE whatsapp.tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', legal_name TEXT, ruc TEXT, address TEXT);
  CREATE TABLE whatsapp.contacts (id BIGINT PRIMARY KEY, tenant_id TEXT NOT NULL, whatsapp_user_id TEXT NOT NULL);
  CREATE TABLE whatsapp.tenant_members (tenant_id TEXT, contact_id BIGINT, status TEXT NOT NULL DEFAULT 'active');
  CREATE TABLE whatsapp.portal_company_members (tenant_id TEXT NOT NULL, portal_user_id TEXT NOT NULL, role TEXT NOT NULL);
  CREATE TABLE whatsapp.portal_whatsapp_links (portal_user_id TEXT PRIMARY KEY, wa_phone TEXT NOT NULL UNIQUE, linked_at TIMESTAMPTZ NOT NULL DEFAULT now());
  INSERT INTO whatsapp.tenants (id, name) VALUES ('manolo', 'Manolo'), ('org_jd', 'CREACIONES J&D'), ('org_off', 'Sin Stock');
  INSERT INTO whatsapp.contacts VALUES (1, 'manolo', '51911111111'), (2, 'manolo', '51922222222'), (3, 'manolo', '51933333333');
  INSERT INTO whatsapp.tenant_members VALUES ('org_jd', 1, 'active'), ('org_jd', 2, 'active'), ('org_off', 1, 'active');
  -- Contact 1 is the owner through the portal; contact 2 is a team member.
  INSERT INTO whatsapp.portal_company_members VALUES ('org_jd', 'owner-1', 'owner'), ('org_jd', 'member-2', 'member');
  INSERT INTO whatsapp.portal_whatsapp_links (portal_user_id, wa_phone) VALUES ('owner-1', '51911111111'), ('member-2', '51922222222');`);
const migration = readFileSync("infra/postgres/migrations/018-stock-cat.sql", "utf8");
await pool.query(migration);
await pool.query(migration); // re-runnable
await pool.query("INSERT INTO stock.settings (tenant_id, documents_since) VALUES ('org_jd', '2026-11-01')");

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
let issued: IssuedDocument[] = [];
const service = new StockService(pool, store, () => undefined, { async read() { return issued; } }, () => new Date());
let requests = 0;
const call = async (contactId: number, operation: StockBridgeRequest["operation"], payload: Record<string, unknown> = {}, company: string | undefined = "org_jd", requestId = `req-${++requests}`) => {
  const result = await service.process({ channel_tenant_id: "manolo", contact_id: contactId, operation, ...(company ? { company_id: company } : {}), payload }, requestId, requestId);
  return result.status === "completed" ? result.response as any : { status: result.status };
};

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` -> ${JSON.stringify(actual)}`}`);
  if (!ok) failures++;
}

check("companies: only those with Stock Cat on", (await call(1, "companies", {}, undefined)).data.companies.map((c: any) => c.id), ["org_jd"]);
check("a company without Stock Cat is refused", (await call(1, "items", {}, "org_off")).error.code, "forbidden");
check("a contact outside the company is refused", (await call(3, "items")).error.code, "forbidden");

// Entries with cost: weighted average.
let moved = await call(2, "move", { kind: "in", lines: [{ name: "Polo blanco M", quantity: 10, unitCostCents: 1200 }] });
check("an entry creates the item and sets the stock", moved.data.moved, [{ name: "Polo blanco M", onHand: 10, delta: 10 }]);
await call(2, "move", { kind: "in", lines: [{ name: "polo blanco m", quantity: 10, unitCostCents: 1400 }] });
check("the same name in another case is the same item, average cost 13.00",
  (await pool.query("SELECT count(*)::int AS n, max(on_hand)::float AS q, max(avg_cost_cents)::float AS c FROM stock.items")).rows[0], { n: 1, q: 20, c: 1300 });
await call(2, "move", { kind: "in", lines: [{ name: "Vinil blanco", quantity: 3, kind: "supply" }] });
check("an entry without cost keeps the item without cost", (await pool.query("SELECT kind, avg_cost_cents FROM stock.items WHERE name = 'Vinil blanco'")).rows[0], { kind: "supply", avg_cost_cents: null });

check("a member sees quantities without costs", (await call(2, "items")).data.items.find((i: any) => i.name === "Polo blanco M"),
  { name: "Polo blanco M", kind: "product", onHand: 20, minQty: null, low: false, needsCount: false });
check("the owner sees the average cost", (await call(1, "items")).data.items.find((i: any) => i.name === "Polo blanco M").avgCostCents, 1300);
check("only the owner sets a minimum", (await call(2, "set_min", { name: "Polo blanco M", minQty: 5 })).error.code, "owner_only");
check("the owner sets it", (await call(1, "set_min", { name: "Polo blanco M", minQty: 5 })).data.item, { name: "Polo blanco M", onHand: 20, minQty: 5 });

// Exits, the minimum and the one-time alert.
moved = await call(2, "move", { kind: "out", lines: [{ name: "Polo blanco M", quantity: 16 }] });
check("an exit at the minimum alerts", moved.data.alerts, [{ name: "Polo blanco M", onHand: 4, minQty: 5, needsCount: false }]);
moved = await call(2, "move", { kind: "out", lines: [{ name: "Polo blanco M", quantity: 1 }] });
check("…only once while it stays low", moved.data.alerts, []);
check("an unknown item cannot go out", (await call(2, "move", { kind: "out", lines: [{ name: "Taza roja", quantity: 1 }] })).error,
  { code: "not_found", details: { name: "Taza roja" } });
moved = await call(2, "move", { kind: "out", lines: [{ name: "Polo blanco M", quantity: 5 }] });
check("negatives are allowed by default", moved.data.moved[0].onHand, -2);
check("only the owner changes the negative rule", (await call(2, "settings", { allowNegative: false })).error.code, "owner_only");
await call(1, "settings", { allowNegative: false });
check("with no negatives, an exit beyond stock is refused", (await call(2, "move", { kind: "in", lines: [{ name: "Taza", quantity: 2 }] }),
  (await call(2, "move", { kind: "out", lines: [{ name: "Taza", quantity: 3 }] })).error), { code: "insufficient", details: { name: "Taza", onHand: 2 } });

// A count sets the quantity and re-arms the alert.
moved = await call(2, "move", { kind: "count", lines: [{ name: "Polo blanco M", quantity: 30 }] });
check("a count sets the quantity and records the difference", moved.data.moved, [{ name: "Polo blanco M", onHand: 30, delta: 32 }]);

// Documents from FacturaYa.
issued = [
  { id: "doc-2", kind: "credit_note", number: "FC01-1", status: "accepted", items: [{ description: "POLO BLANCO M", quantity: 1 }] },
  { id: "doc-1", kind: "invoice", number: "F001-26", status: "accepted", items: [{ description: "Polo blanco M", quantity: 27 }, { description: "TAZA PERSONALIZADA", quantity: 1 }] },
  { id: "doc-0", kind: "invoice", number: "F001-25", status: "rejected", items: [{ description: "Polo blanco M", quantity: 100 }] },
];
let sync = (await call(2, "sync_documents")).data;
check("accepted documents move stock once: invoice out, credit note back", { processed: sync.processed, unmatched: sync.unmatched,
  onHand: Number((await pool.query("SELECT on_hand FROM stock.items WHERE name = 'Polo blanco M'")).rows[0].on_hand) },
  { processed: 2, unmatched: ["TAZA PERSONALIZADA"], onHand: 4 });
check("…and the drop below the minimum alerts again", sync.alerts, [{ name: "Polo blanco M", onHand: 4, minQty: 5, needsCount: false }]);
sync = (await call(2, "sync_documents")).data;
check("syncing again changes nothing", { processed: sync.processed, alerts: sync.alerts }, { processed: 0, alerts: [] });
check("a document line records its document number",
  (await pool.query("SELECT kind, delta::float AS d, document_number FROM stock.moves WHERE document_number IS NOT NULL ORDER BY created_at")).rows,
  [{ kind: "document_out", d: -27, document_number: "F001-26" }, { kind: "document_in", d: 1, document_number: "FC01-1" }]);

// With «no negatives», an accepted invoice still counts and asks for a count.
issued = [{ id: "doc-3", kind: "invoice", number: "B001-9", status: "accepted", items: [{ description: "Taza", quantity: 5 }] }];
await call(2, "sync_documents");
check("an invoice beyond stock is applied and flags a count", (await pool.query("SELECT on_hand::float AS q, needs_count FROM stock.items WHERE name = 'Taza'")).rows[0],
  { q: -3, needs_count: true });

// Linking an unknown description applies the pending lines.
await call(2, "move", { kind: "in", lines: [{ name: "Taza personalizada", quantity: 10 }] });
const linked = (await call(2, "link_alias", { description: "TAZA PERSONALIZADA", name: "Taza personalizada" })).data;
check("linking a description applies its pending line", { applied: linked.applied, onHand: linked.item.onHand }, { applied: 1, onHand: 9 });
check("…and nothing is left unmatched", (await call(2, "sync_documents")).data.unmatched, []);

// Queries.
check("query item, by part of the name", (await call(2, "query", { type: "item", name: "polo" })).data.items.map((i: any) => [i.name, i.onHand]), [["Polo blanco M", 4]]);
check("query low", (await call(2, "query", { type: "low" })).data.items.map((i: any) => i.name), ["Polo blanco M", "Taza"]);
check("query value is for the owner only", (await call(2, "query", { type: "value" })).error.code, "owner_only");
check("query value at average cost (4 × 13.00; no cost for the rest)", (await call(1, "query", { type: "value" })).data, { valueCents: 5200, withoutCost: 2, withStock: 3 });
const weekMoves = (await call(2, "query", { type: "moves", period: "week" })).data.items.find((i: any) => i.name === "Polo blanco M");
check("query moves of the week", weekMoves, { name: "Polo blanco M", entered: 21, left: 49, countDifference: 32 });
check("query slow: in stock and not sold for 30 days", (await call(2, "query", { type: "slow" })).data.items.map((i: any) => i.name), ["Vinil blanco"]);

// Idempotent writes.
const once = await call(2, "move", { kind: "in", lines: [{ name: "Vinil blanco", quantity: 1 }] }, "org_jd", "same");
const twice = await call(2, "move", { kind: "in", lines: [{ name: "Vinil blanco", quantity: 1 }] }, "org_jd", "same");
check("a repeated request does not move stock twice", { first: once.data.moved[0].onHand, replayed: twice.replayed, now: (await call(2, "items")).data.items.find((i: any) => i.name === "Vinil blanco").onHand },
  { first: 4, replayed: true, now: 4 });

// Portal and «Inicio».
const portal = new PortalStockService(pool, service, () => undefined);
const asOwner = (await portal.handle("owner-1", "org_jd")) as any;
const asMember = (await portal.handle("member-2", "org_jd")) as any;
check("portal: the owner sees value and costs", { value: asOwner.stock.valueCents, cost: asOwner.stock.items.find((i: any) => i.name === "Polo blanco M").avgCostCents }, { value: 5200, cost: 1300 });
check("portal: a member sees no costs", { value: asMember.stock.valueCents, cost: asMember.stock.items.find((i: any) => i.name === "Polo blanco M").avgCostCents }, { value: null, cost: null });
check("portal: a stranger is refused", await portal.handle("nobody", "org_jd"), { status: "forbidden" });
check("portal: moves are listed newest first", asMember.stock.moves[0].name, "Vinil blanco");
check("portal: a company without Stock Cat says so", (await portal.handle("owner-1", "org_off")) as any, { status: "forbidden" });
const weekly = new PortalWeeklyService(pool, { decrypt: () => "" }, "http://facturaya.invalid", () => undefined);
// Only Stock Cat's part of «Inicio» (the rest needs the message tables).
const line = await (weekly as any).stock("org_jd", new Date(Date.now() - 86_400_000));
check("«Inicio» shows how many items are low", { enabled: line.enabled, low: line.lowCount, moved: line.movesToday > 0 }, { enabled: true, low: 1, moved: true }); // only items under their minimum
check("«Inicio» says Stock Cat is off where it is", (await (weekly as any).stock("org_off", new Date())).enabled, false);

await pool.query("DROP SCHEMA whatsapp, stock CASCADE");
await pool.end();
console.log(failures ? `${failures} failed` : "all stock checks passed");
process.exit(failures ? 1 : 0);
