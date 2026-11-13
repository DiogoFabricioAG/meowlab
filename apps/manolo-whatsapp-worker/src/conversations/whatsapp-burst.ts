import { DurableObject } from "cloudflare:workers";
import type { IncomingMessage } from "../roles/contracts";
import { processConversationTurn } from "../index";
import { burstKey, planBurst, type BurstEntry } from "./burst-policy";
import type { BurstReview } from "./burst-admin";

type InboxRow = { seq: number; received: number; body: string };
const RETENTION_MS = 24 * 60 * 60 * 1000;

export class WhatsAppBurst extends DurableObject<Env> {
  private running = false;
  private reviewing = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS inbox (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
      tenant TEXT NOT NULL, received INTEGER NOT NULL, body TEXT,
      status TEXT NOT NULL DEFAULT 'pending')`);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS safety (id INTEGER PRIMARY KEY CHECK(id = 1), blocked INTEGER NOT NULL)");
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS reviews (
      request_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, reviewed_at INTEGER NOT NULL,
      reference TEXT NOT NULL, result TEXT NOT NULL)`);
  }

  async enqueue(tenantId: string, message: IncomingMessage): Promise<{ accepted: boolean }> {
    if (this.reviewing) return { accepted: false };
    if (!message.id || message.text.length > 4000
      || !this.ctx.id.equals(this.env.WHATSAPP_BURSTS.idFromName(burstKey(tenantId, message)))) {
      return { accepted: false };
    }
    const sql = this.ctx.storage.sql;
    const now = Date.now();
    if (sql.exec("SELECT seq FROM inbox WHERE id = ?", message.id).toArray().length) {
      await this.schedule();
      return { accepted: true };
    }
    // Never drop a pending item to make room: webhook must fail for Meta retry.
    if (sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM inbox WHERE status = 'pending'").one().n >= 100) {
      return { accepted: false };
    }
    sql.exec("DELETE FROM inbox WHERE received < ? AND status IN ('done', 'uncertain')", now - RETENTION_MS);
    sql.exec("INSERT OR IGNORE INTO inbox(id, tenant, received, body) VALUES (?, ?, ?, ?)",
      message.id, tenantId, now, JSON.stringify(message));
    await this.schedule();
    return { accepted: true };
  }

  async review(input: BurstReview): Promise<{ ok: boolean; error?: string; fingerprint?: string;
    blocked?: boolean; counts?: Record<string, number>; phase?: string; replayed?: boolean }> {
    if (this.running || this.reviewing) return { ok: false, error: "busy" };
    this.reviewing = true;
    const sql = this.ctx.storage.sql;
    const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest(
      "SHA-256", new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, "0")).join("");
    try {
      const hash = await digest(JSON.stringify(input));
      const previous = sql.exec<{ request_hash: string; result: string }>(
        "SELECT request_hash, result FROM reviews WHERE request_id = ?", input.requestId).toArray()[0];
      if (previous) return previous.request_hash === hash
        ? { ...JSON.parse(previous.result), replayed: true } : { ok: false, error: "request_conflict" };
      const record = await this.env.DB.prepare(`SELECT state_json FROM contact_role_states
        WHERE tenant_id = ? AND contact_id = ? AND role_key = 'enterprise-advisor'`)
        .bind(input.tenantId, input.contactId).first<{ state_json: string }>();
      const state = record ? JSON.parse(record.state_json) : null;
      const rows = sql.exec<{ seq: number; status: string }>("SELECT seq, status FROM inbox ORDER BY seq").toArray();
      const counts: Record<string, number> = {};
      for (const row of rows) counts[row.status] = (counts[row.status] || 0) + 1;
      const blocked = sql.exec<{ blocked: number }>("SELECT blocked FROM safety WHERE id = 1").toArray()[0]?.blocked === 1;
      const fingerprint = await digest(JSON.stringify([rows, blocked, record?.state_json || null]));
      if (input.action === "inspect") return { ok: true, counts, blocked, fingerprint,
        phase: typeof state?.phase === "string" ? state.phase : "none" };
      if (input.expected !== fingerprint || !input.verifiedFacturaya || !input.reviewRef) return { ok: false, error: "review_stale" };
      if (counts.pending || counts.executing) return { ok: false, error: "queue_not_drained" };
      if (state?.phase === "issuing") return { ok: false, error: "issuance_requires_reconciliation" };
      // Operator has verified FacturaYa. Invalidate old fiscal buttons, preserve
      // all commercial data; never import, issue, retry or fabricate a result.
      if (record) {
        const next = { ...state, confirmation: undefined, revision: Number(state.revision || 0) + 1 };
        const updated = await this.env.DB.prepare(`UPDATE contact_role_states SET state_json = ?, updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ? AND contact_id = ? AND role_key = 'enterprise-advisor' AND state_json = ?`)
          .bind(JSON.stringify(next), input.tenantId, input.contactId, record.state_json).run();
        if (updated.meta.changes !== 1) return { ok: false, error: "checkpoint_conflict" };
      }
      const result = { ok: true, blocked: false };
      // Synchronous SQLite writes commit together; audit survives payload TTL.
      sql.exec("INSERT OR REPLACE INTO safety(id, blocked) VALUES (1, 0)");
      sql.exec("INSERT INTO reviews VALUES (?, ?, ?, ?, ?)", input.requestId, hash, Date.now(), input.reviewRef, JSON.stringify(result));
      console.log(JSON.stringify({ event: "whatsapp_burst_reviewed", requestId: input.requestId }));
      return result;
    } finally { this.reviewing = false; }
  }

  private pending(): BurstEntry[] {
    return this.ctx.storage.sql.exec<InboxRow>(
      "SELECT seq, received, body FROM inbox WHERE status = 'pending' ORDER BY seq LIMIT 100",
    ).toArray().map(row => ({ seq: row.seq, received: row.received, message: JSON.parse(row.body) as IncomingMessage }));
  }

  private async schedule(): Promise<void> {
    const plan = planBurst(this.pending(), Date.now());
    if (plan) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, plan.due));
    else {
      const expiry = this.ctx.storage.sql.exec<{ expiry: number | null }>(
        "SELECT MIN(received) + ? AS expiry FROM inbox WHERE status IN ('done', 'uncertain')", RETENTION_MS,
      ).one().expiry;
      if (expiry) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, expiry));
    }
  }

  async alarm(): Promise<void> {
    if (this.running || this.reviewing) { await this.ctx.storage.setAlarm(Date.now() + 1000); return; }
    const sql = this.ctx.storage.sql;
    // An interrupted fiscal turn cannot be retried safely. Keep a tombstone,
    // retain the payload for bounded operational recovery; never auto-replay it.
    const interrupted = sql.exec("UPDATE inbox SET status = 'uncertain' WHERE status = 'executing'").rowsWritten;
    if (interrupted) {
      sql.exec("INSERT OR REPLACE INTO safety(id, blocked) VALUES (1, 1)");
      console.log(JSON.stringify({ event: "whatsapp_burst_uncertain", count: interrupted }));
    }
    sql.exec("DELETE FROM inbox WHERE received < ? AND status IN ('done', 'uncertain')", Date.now() - RETENTION_MS);
    const plan = planBurst(this.pending(), Date.now());
    if (!plan) { await this.schedule(); return; }
    if (plan.due > Date.now()) { await this.ctx.storage.setAlarm(plan.due); return; }
    const tenantId = sql.exec<{ tenant: string }>("SELECT tenant FROM inbox WHERE seq = ?", plan.entries[0].seq).one().tenant;
    this.running = true;
    for (const entry of plan.entries) sql.exec("UPDATE inbox SET status = 'executing' WHERE seq = ?", entry.seq);
    try {
      await this.ctx.storage.setAlarm(Date.now() + 60000);
      const blocked = sql.exec<{ blocked: number }>("SELECT blocked FROM safety WHERE id = 1").toArray()[0]?.blocked === 1;
      await processConversationTurn(plan.entries.map(entry => entry.message), this.env, tenantId, blocked);
      for (const entry of plan.entries) sql.exec("UPDATE inbox SET status = 'done', body = NULL WHERE seq = ?", entry.seq);
      console.log(JSON.stringify({ event: "whatsapp_burst_processed", count: plan.entries.length }));
    } catch {
      sql.exec("INSERT OR REPLACE INTO safety(id, blocked) VALUES (1, 1)");
      for (const entry of plan.entries) sql.exec("UPDATE inbox SET status = 'uncertain' WHERE seq = ?", entry.seq);
      console.log(JSON.stringify({ event: "whatsapp_burst_uncertain", count: plan.entries.length }));
    } finally {
      this.running = false;
      await this.schedule();
    }
  }
}
