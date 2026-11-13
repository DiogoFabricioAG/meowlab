// Signed rejection/replay checks only: no real actor, identity lookup or fiscal call.
import { readFileSync } from "node:fs";
import { createHash, createHmac, randomUUID } from "node:crypto";
import pg from "pg";
const base = process.env.FISCAL_SMOKE_BASE ?? "http://127.0.0.1:3000";
const secret = readFileSync("/run/secrets/vps_bridge_hmac_secret", "utf8").trim();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  const health = await fetch(base + "/health", { signal: AbortSignal.timeout(10000) });
  if (health.status !== 200) throw Error("health_failed");
  const radar = await fetch(base + "/v1/roles/radar/sync", { signal: AbortSignal.timeout(10000) });
  if (radar.status !== 405) throw Error("radar_route_not_preserved");
  const tenant = (await pool.query("SELECT id FROM whatsapp.tenants ORDER BY id LIMIT 1")).rows[0]?.id;
  if (!tenant) throw Error("existing_tenant_missing");
  if ((await pool.query("SELECT 1 FROM whatsapp.contacts WHERE id=2147483647")).rowCount) throw Error("synthetic_contact_collision");
  for (const operation of ["create_despatch", "get_despatch", "issue_despatch", "refresh_despatch", "import_invoice_draft"]) {
    const requestId = `fiscal-contract-smoke:${randomUUID()}`;
    const body = JSON.stringify({ tenant_id: tenant, contact_id: 2147483647, operation, payload: {} });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    const send = (sign) => fetch(base + "/v1/facturaya/execute", { method: "POST", body, signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/json", "X-Manolo-Request-Id": requestId, "X-Manolo-Timestamp": timestamp, "X-Manolo-Signature": sign } });
    if ((await send("sha256=" + "0".repeat(64))).status !== 401) throw Error("signature_not_enforced");
    for (const replayed of [false, true]) {
      const response = await send(signature);
      const result = await response.json();
      if (response.status !== 200 || result.ok !== false || result.error?.code !== "forbidden" || result.replayed !== replayed) {
        throw Error(`scope_or_replay_failed:${operation}`);
      }
    }
  }
  console.log(JSON.stringify({ health: "ok", radar_preserved: true, hmac: "verified", permissions: "enforced", replay: "verified",
    operations: 5, provider_calls: 0, fiscal_issuance: false, real_actor_used: false,
    contract_tag: createHash("sha256").update("credit-gre-category-20261105").digest("hex").slice(0, 12) }));
} finally { await pool.end(); }
