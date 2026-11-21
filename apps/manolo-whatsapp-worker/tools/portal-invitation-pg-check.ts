// Integration check of portal invitations against a real PostgreSQL (ADR-0010, phase 2).
// Needs an empty database, e.g. a throwaway container. Never point it at production:
// it creates and deletes rows. Run from apps/manolo-whatsapp-worker:
//   PORTAL_COMPANY_CHECK_DATABASE_URL=postgres://... npx esbuild tools/portal-invitation-pg-check.ts \
//     --bundle --platform=node --format=esm --outfile=node_modules/.cache/portal-invitation-pg-check.mjs \
//     && node node_modules/.cache/portal-invitation-pg-check.mjs
import { readFileSync } from "node:fs";
import pg from "pg";
import { PortalCompanyService } from "../src/node/portal/company-service";
import { PortalInvitationService } from "../src/node/portal/invitation-service";
import { PgPortalLinkStore, PortalLinkService } from "../src/node/portal/link-service";
import type { PortalCompanyResponse } from "../src/bridge/portal-company-contracts";

const url = process.env.PORTAL_COMPANY_CHECK_DATABASE_URL;
if (!url) throw new Error("PORTAL_COMPANY_CHECK_DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: url, max: 8 });

// Minimal shape of the tables these migrations build on (005, 006 and 011 in production).
await pool.query(`CREATE SCHEMA IF NOT EXISTS whatsapp;
  CREATE TABLE whatsapp.tenants (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
    timezone TEXT NOT NULL DEFAULT 'America/Bogota', created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, legal_name TEXT, ruc TEXT, address TEXT, sector TEXT, city TEXT);
  CREATE UNIQUE INDEX whatsapp_tenants_ruc_unique ON whatsapp.tenants (ruc) WHERE ruc IS NOT NULL AND BTRIM(ruc) <> '';
  CREATE TABLE whatsapp.contacts (id BIGSERIAL PRIMARY KEY, tenant_id TEXT, whatsapp_user_id TEXT NOT NULL, display_name TEXT);
  CREATE TABLE whatsapp.tenant_members (
    tenant_id TEXT NOT NULL REFERENCES whatsapp.tenants(id) ON DELETE CASCADE,
    contact_id BIGINT NOT NULL REFERENCES whatsapp.contacts(id) ON DELETE CASCADE,
    display_name TEXT,
    permissions JSONB NOT NULL DEFAULT '["view_invoice","create_invoice","issue_invoice","create_credit_note"]'::jsonb,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, contact_id));
  CREATE TABLE whatsapp.tenant_integrations (tenant_id TEXT, provider TEXT, status TEXT);
  CREATE TABLE whatsapp.portal_whatsapp_links (portal_user_id TEXT PRIMARY KEY, wa_phone TEXT NOT NULL UNIQUE, linked_at TIMESTAMPTZ NOT NULL);
  INSERT INTO whatsapp.tenants (id, name) VALUES ('meowlab', 'MeowLab');
  INSERT INTO whatsapp.contacts (tenant_id, whatsapp_user_id, display_name)
    VALUES ('meowlab', '51911111111', 'Beto'), ('meowlab', '51922222222', 'Carla'), ('meowlab', '51933333333', 'Dan');
  INSERT INTO whatsapp.portal_whatsapp_links VALUES ('beto', '51911111111', now()), ('carla', '51922222222', now()), ('dan', '51933333333', now());`);
for (const file of ["011-portal-whatsapp-links.sql", "012-portal-companies.sql", "013-portal-invitations.sql"]) {
  const sql = readFileSync(`infra/postgres/migrations/${file}`, "utf8");
  await pool.query(sql);
  await pool.query(sql); // must be re-runnable
}

let clock = new Date("2026-11-13T05:00:00Z");
let token = 0;
const invitations = new PortalInvitationService(pool, () => undefined, () => clock,
  () => `Tok${String(++token).padStart(19, "0")}`);
const service = new PortalCompanyService(
  pool,
  { find: async (ruc) => ({ ruc, legalName: `Empresa ${ruc}`, address: null, status: "ACTIVO", condition: null }) },
  () => undefined,
  () => "org_agu",
  invitations,
);
const call = (portalUserId: string, body: Record<string, unknown>) =>
  service.handle({ version: 1, requestId: crypto.randomUUID(), portalUserId, ...body } as never) as Promise<PortalCompanyResponse & Record<string, any>>;

let failures = 0;
function check(name: string, actual: unknown, expected: Record<string, unknown>) {
  const ok = Object.entries(expected).every(([key, value]) => JSON.stringify((actual as Record<string, unknown>)[key]) === JSON.stringify(value));
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` -> ${JSON.stringify(actual)}`}`);
  if (!ok) failures++;
}
const agentAccess = async (phone: string) => (await pool.query(
  `SELECT member.status, member.permissions FROM whatsapp.tenant_members AS member
     JOIN whatsapp.contacts AS contact ON contact.id = member.contact_id
    WHERE member.tenant_id = 'org_agu' AND contact.whatsapp_user_id = $1`, [phone])).rows[0] ?? { status: "none" };

check("ana creates her company", await call("ana", { action: "create", ruc: "20557288016" }), { status: "created" });
const T = { tenantId: "org_agu" };
check("a stranger cannot see the team", await call("beto", { action: "team", ...T }), { status: "forbidden" });
check("a stranger cannot invite", await call("beto", { action: "invite", ...T, access: "full" }), { status: "forbidden" });

const open = await call("ana", { action: "invite", ...T, access: "view" });
const bound = await call("ana", { action: "invite", ...T, access: "full", phone: "911 111 111" });
check("owner creates an open and a bound invitation", { open: open.status, bound: bound.status, mask: bound.invitation?.maskedPhone },
  { open: "invited", bound: "invited", mask: "+51 9•• ••• 111" });
const team = await call("ana", { action: "team", ...T });
check("team lists the owner and both invitations", { members: team.team?.members.length, invitations: team.team?.invitations.length },
  { members: 1, invitations: 2 });
check("the code is not stored", (await pool.query("SELECT count(*)::int AS n FROM whatsapp.portal_company_invitations WHERE token_hash LIKE 'Tok%'")).rows[0], { n: 0 });

check("carla previews the open invitation", await call("carla", { action: "preview", token: open.invitation.token }),
  { status: "ok", invitation: { companyName: "Empresa 20557288016", invitedBy: "ana", expiresAt: "2026-11-20T05:00:00.000Z", maskedPhone: null, alreadyMember: false } });
check("carla joins", await call("carla", { action: "accept", token: open.invitation.token }), { status: "joined" });
check("carla's number can view invoices", await agentAccess("51922222222"), { status: "active", permissions: ["view_invoice"] });
check("the open link works only once", await call("dan", { action: "accept", token: open.invitation.token }), { status: "used" });

check("bound invitation: account without that number", await call("dan", { action: "accept", token: bound.invitation.token }), { status: "phone_mismatch" });
await pool.query("DELETE FROM whatsapp.portal_whatsapp_links WHERE portal_user_id = 'dan'");
check("bound invitation: account without WhatsApp", await call("dan", { action: "accept", token: bound.invitation.token }), { status: "needs_whatsapp" });
check("bound invitation: the right number joins", await call("beto", { action: "accept", token: bound.invitation.token }), { status: "joined" });
check("beto's number gets full access", await agentAccess("51911111111"),
  { status: "active", permissions: ["view_invoice", "create_invoice", "issue_invoice", "create_credit_note"] });

const again = await call("ana", { action: "invite", ...T, access: "view" });
check("a member is not consumed by another link", await call("carla", { action: "accept", token: again.invitation.token }), { status: "already_member" });
check("…and that link still works for someone else", await call("carla", { action: "preview", token: again.invitation.token }),
  { status: "ok" });
check("revoke", await call("ana", { action: "revoke", ...T, invitationId: again.invitation.id }), { status: "revoked" });
check("a revoked link is invalid", await call("dan", { action: "preview", token: again.invitation.token }), { status: "invalid" });
check("an unknown code is invalid", await call("dan", { action: "accept", token: "Zzzzzzzzzzzzzzzzzzzzzz" }), { status: "invalid" });

const late = await call("ana", { action: "invite", ...T, access: "view" });
clock = new Date(clock.getTime() + 8 * 86_400_000);
check("a link expires after 7 days", await call("dan", { action: "accept", token: late.invitation.token }), { status: "expired" });

const race = await call("ana", { action: "invite", ...T, access: "view" });
await pool.query("INSERT INTO whatsapp.portal_whatsapp_links VALUES ('dan', '51933333333', now())");
const results = await Promise.all(["dan", "eva", "fer"].map((user) => call(user, { action: "accept", token: race.invitation.token })));
check("concurrent acceptance: exactly one joins", { statuses: results.map((r) => r.status).sort() }, { statuses: ["joined", "used", "used"] });

check("owner cannot remove herself", await call("ana", { action: "remove", ...T, memberId: "ana" }), { status: "forbidden" });
check("a member cannot remove others", await call("beto", { action: "remove", ...T, memberId: "carla" }), { status: "forbidden" });
check("owner removes carla", await call("ana", { action: "remove", ...T, memberId: "carla" }), { status: "removed" });
check("carla's number stops acting for the company", await agentAccess("51922222222"), { status: "inactive" });
check("carla no longer sees the company", { count: (await call("carla", { action: "mine" })).companies.length }, { count: 0 });
check("beto sees it as member", (await call("beto", { action: "mine" })).companies[0], { id: "org_agu", role: "member" });

for (let i = 0; i < 20; i++) await call("ana", { action: "invite", ...T, access: "view" });
check("at most 20 open invitations", await call("ana", { action: "invite", ...T, access: "view" }), { status: "limit_reached" });

await pool.query(`INSERT INTO whatsapp.tenants (id, name) VALUES ('org_other', 'Other');
  INSERT INTO whatsapp.portal_company_members (tenant_id, portal_user_id, role)
  VALUES ('org_other', 'outsider', 'owner'), ('org_other', 'beto', 'member')`);
check("an outsider cannot receive the company", await call("ana", { action: "transfer", ...T, memberId: "outsider" }), { status: "not_found" });
check("owner cannot leave", await call("ana", { action: "leave", ...T }), { status: "owner_cannot_leave" });
check("owner transfers to a member", await call("ana", { action: "transfer", ...T, memberId: "beto" }), { status: "transferred" });
check("former owner cannot manage the team", await call("ana", { action: "team", ...T }), { status: "forbidden" });
check("former owner remains a member", (await call("ana", { action: "mine" })).companies[0], { id: "org_agu", role: "member" });
const afterTransfer = await call("beto", { action: "mine" });
check("only the selected company changes role", { roles: afterTransfer.companies.map(({ id, role }: { id: string; role: string }) => [id, role]) },
  { roles: [["org_agu", "owner"], ["org_other", "member"]] });

const phone = "12025550132";
await pool.query("INSERT INTO whatsapp.contacts (tenant_id, whatsapp_user_id) VALUES ('meowlab', $1)", [phone]);
await pool.query("UPDATE whatsapp.portal_company_invitations SET revoked_at = now() WHERE accepted_at IS NULL");
const lateJoin = await call("beto", { action: "invite", ...T, access: "view" });
const otherJoin = await call("outsider", { action: "invite", tenantId: "org_other", access: "full" });
check("member joins before linking WhatsApp", await call("eli", { action: "accept", token: lateJoin.invitation.token }), { status: "joined" });
check("member joins a second team", await call("eli", { action: "accept", token: otherJoin.invitation.token }), { status: "joined" });
check("no agent access before linking", await agentAccess(phone), { status: "none" });
const link = new PortalLinkService(new PgPortalLinkStore(pool), { send: async () => true },
  "check-pepper-check-pepper-check-pepper", () => undefined, () => clock, () => "100001");
const identity = { version: 1 as const, requestId: crypto.randomUUID(), portalUserId: "eli" };
const challenge = await link.handle({ ...identity, action: "start", phone });
if (challenge.status !== "code_sent") throw new Error("Expected a test challenge");
check("member verifies WhatsApp after joining", await link.handle({
  ...identity, action: "verify", challengeId: challenge.challengeId, code: "100001",
}), { status: "linked" });
check("the late link grants the first invitation's permissions", await agentAccess(phone), { status: "active", permissions: ["view_invoice"] });
check("member leaves one company", await call("eli", { action: "leave", ...T }), { status: "left" });
check("leaving also disables agent access", await agentAccess(phone), { status: "inactive" });
const otherAccess = async () => (await pool.query(
  `SELECT member.status, member.permissions FROM whatsapp.tenant_members AS member
     JOIN whatsapp.contacts AS contact ON contact.id = member.contact_id
    WHERE member.tenant_id = 'org_other' AND contact.whatsapp_user_id = $1`, [phone])).rows[0];
check("leaving does not affect chat access in another company", await otherAccess(),
  { status: "active", permissions: ["view_invoice", "create_invoice", "issue_invoice", "create_credit_note"] });
check("member can unlink the number", await link.handle({ ...identity, action: "unlink" }), { status: "unlinked" });
check("unlink disables invitation access", await otherAccess(), { status: "inactive" });
clock = new Date(clock.getTime() + 61_000);
const retry = await link.handle({ ...identity, action: "start", phone });
if (retry.status !== "code_sent") throw new Error("Expected a second test challenge");
check("member relinks the number", await link.handle({
  ...identity, action: "verify", challengeId: retry.challengeId, code: "100001",
}), { status: "linked" });
check("relink restores access only where still a member", await otherAccess(), { status: "active" });
check("relink cannot restore access after leaving", await agentAccess(phone), { status: "inactive" });

await pool.query("DROP SCHEMA whatsapp CASCADE");
await pool.end();
console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
