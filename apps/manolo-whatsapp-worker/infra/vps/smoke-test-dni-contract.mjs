// Verify the deployed DNI operation without querying a real identity or issuing.
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

const secret = readFileSync("/run/secrets/vps_bridge_hmac_secret", "utf8").trim();
const endpoint = process.env.FACTURAYA_SMOKE_URL
  ?? "http://127.0.0.1:3000/v1/facturaya/execute";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  const selected = await pool.query(`
    SELECT session.active_tenant_id AS tenant_id, session.contact_id
    FROM whatsapp.facturaya_sessions AS session
    JOIN whatsapp.tenant_members AS member
      ON member.tenant_id = session.active_tenant_id
      AND member.contact_id = session.contact_id
      AND member.status = 'active'
    WHERE session.expires_at > CURRENT_TIMESTAMP
      AND member.permissions ? 'create_invoice'
    LIMIT 1
  `);
  const actor = selected.rows[0];
  if (!actor) throw new Error("dni_smoke_authorized_fixture_missing");
  const body = JSON.stringify({ tenant_id: actor.tenant_id,
    contact_id: Number(actor.contact_id), operation: "lookup_customer_dni",
    payload: { dni: "invalid" } });
  const requestId = `dni-contract-smoke-${randomUUID()}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  const send = (signatureValue) => fetch(endpoint, {
    method: "POST", signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/json", "X-Manolo-Request-Id": requestId,
      "X-Manolo-Timestamp": timestamp, "X-Manolo-Signature": `sha256=${signatureValue}` }, body,
  });
  const unsigned = await send("0".repeat(64));
  if (unsigned.status !== 401) throw new Error("dni_smoke_bad_signature_accepted");
  for (const replayed of [false, true]) {
    const response = await send(signature);
    const result = await response.json();
    if (!response.ok || result.request_id !== requestId || result.ok !== false
      || result.error?.code !== "invalid_request" || result.replayed !== replayed) {
      throw new Error("dni_smoke_contract_or_replay_failed");
    }
  }
  console.log(JSON.stringify({ dni_contract_smoke: "ok", signature: "verified",
    invalid_input: "rejected", replay: "verified", identity_query: false, emission: false }));
} finally {
  await pool.end();
}
