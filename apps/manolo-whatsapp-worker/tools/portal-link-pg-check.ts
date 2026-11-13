// Integration check of PgPortalLinkStore against a real PostgreSQL (ADR-0006).
// Needs an empty database where the migration can run, e.g. a throwaway cluster:
//   PORTAL_LINK_CHECK_DATABASE_URL=postgres://... npx esbuild tools/portal-link-pg-check.ts \
//     --bundle --platform=node --format=esm --packages=external \
//     --outfile=node_modules/.cache/portal-link-pg-check.mjs && node node_modules/.cache/portal-link-pg-check.mjs
// Never point it at production: it creates and deletes rows.
import { readFileSync } from "node:fs";
import pg from "pg";
import { PgPortalLinkStore, PortalLinkService } from "../src/node/portal/link-service";
import type { PortalLinkResponse } from "../src/bridge/portal-link-contracts";

const url = process.env.PORTAL_LINK_CHECK_DATABASE_URL;
if (!url) throw new Error("PORTAL_LINK_CHECK_DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: url });

await pool.query(`CREATE SCHEMA IF NOT EXISTS whatsapp;
  CREATE TABLE IF NOT EXISTS whatsapp.contacts (id BIGSERIAL PRIMARY KEY, whatsapp_user_id TEXT NOT NULL);`);
// Run from apps/manolo-whatsapp-worker.
await pool.query(readFileSync("infra/postgres/migrations/011-portal-whatsapp-links.sql", "utf8"));
await pool.query("TRUNCATE whatsapp.portal_link_challenges, whatsapp.portal_whatsapp_links, whatsapp.contacts");
await pool.query("INSERT INTO whatsapp.contacts (whatsapp_user_id) VALUES ('51987654321'), ('51911111111')");

let clock = new Date("2026-11-11T12:00:00Z");
const advance = (seconds: number) => { clock = new Date(clock.getTime() + seconds * 1_000); };
const sent: Array<{ to: string; code: string }> = [];
let code = 100000;
const service = new PortalLinkService(
  new PgPortalLinkStore(pool),
  { send: async (to, value) => { sent.push({ to, code: value }); return true; } },
  "check-pepper-check-pepper-check-pepper",
  () => undefined,
  () => clock,
  () => String(++code),
);
const call = (portalUserId: string, body: Record<string, unknown>) =>
  service.handle({ version: 1, requestId: crypto.randomUUID(), portalUserId, ...body } as never) as Promise<PortalLinkResponse>;
let failures = 0;
function check(name: string, actual: unknown, expected: Record<string, unknown>) {
  const ok = Object.entries(expected).every(([key, value]) => (actual as Record<string, unknown>)[key] === value);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` -> ${JSON.stringify(actual)}`}`);
  if (!ok) failures++;
}

const first = await call("alice", { action: "start", phone: "987654321" }) as { challengeId: string };
check("known number gets a code", first, { status: "code_sent" });
check("code delivered to the number", sent.at(-1), { to: "51987654321", code: "100001" });
check("resend before 60 s is limited", await call("alice", { action: "start", phone: "987654321" }), { status: "rate_limited", retryAfterSeconds: 60 });

const parallel = await Promise.all(Array.from({ length: 5 }, () => call("bob", { action: "start", phone: "911111111" })));
check("5 concurrent starts send exactly one code", { sent: parallel.filter((r) => r.status === "code_sent").length }, { sent: 1 });

check("wrong code", await call("alice", { action: "verify", challengeId: first.challengeId, code: "999999" }), { status: "invalid_code", attemptsLeft: 4 });
check("another account cannot use the challenge", await call("mallory", { action: "verify", challengeId: first.challengeId, code: "100001" }), { status: "expired" });
check("right code links", await call("alice", { action: "verify", challengeId: first.challengeId, code: "100001" }), { status: "linked" });
check("a used code cannot link again", await call("alice", { action: "verify", challengeId: first.challengeId, code: "100001" }), { status: "expired" });
check("status shows the link", await call("alice", { action: "status" }), { status: "linked", maskedPhone: "+51 9•• ••• 321" });

advance(61);
const moved = await call("carol", { action: "start", phone: "+51987654321" }) as { challengeId: string };
check("proving the number from another account moves it", await call("carol", { action: "verify", challengeId: moved.challengeId, code: sent.at(-1)!.code }), { status: "linked" });
check("the previous account lost it", await call("alice", { action: "status" }), { status: "not_linked" });

advance(61);
const third = await call("dave", { action: "start", phone: "987654321" });
check("third code for the number in the hour is still allowed", third, { status: "code_sent" });
advance(61);
check("fourth code for the number in the hour is limited", await call("erin", { action: "start", phone: "987654321" }), { status: "rate_limited" });

advance(3_600);
const expiring = await call("frank", { action: "start", phone: "987654321" }) as { challengeId: string };
advance(601);
check("an expired code does not link", await call("frank", { action: "verify", challengeId: expiring.challengeId, code: sent.at(-1)!.code }), { status: "expired" });

advance(61);
const guessing = await call("frank", { action: "start", phone: "987654321" }) as { challengeId: string };
for (let attempt = 0; attempt < 5; attempt++) await call("frank", { action: "verify", challengeId: guessing.challengeId, code: "000000" });
check("after 5 wrong attempts even the right code fails", await call("frank", { action: "verify", challengeId: guessing.challengeId, code: sent.at(-1)!.code }), { status: "expired" });

advance(61);
const before = sent.length;
const unknown = await call("gina", { action: "start", phone: "+1 415 555 0100" }) as { challengeId: string };
check("unknown number: same answer", unknown, { status: "code_sent" });
check("unknown number: nothing sent", { sent: sent.length - before }, { sent: 0 });

const { rows } = await pool.query("SELECT count(*)::int AS n FROM whatsapp.portal_link_challenges WHERE code_hash ~ '^[0-9]{6}$'");
check("no plain codes stored", rows[0], { n: 0 });
check("unlink", await call("carol", { action: "unlink" }), { status: "unlinked" });

await pool.end();
console.log(failures ? `${failures} check(s) failed` : "all checks passed");
process.exitCode = failures ? 1 : 0;
