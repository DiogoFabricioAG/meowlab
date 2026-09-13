import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

const { Pool } = pg;
const secret = readFileSync(
  "/run/secrets/vps_bridge_hmac_secret",
  "utf8",
).trim();
const endpoint = process.env.FACTURAYA_SMOKE_URL
  ?? "http://127.0.0.1:3000/v1/facturaya/execute";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

try {
  const selected = await pool.query(`
    SELECT contact.id AS contact_id, contact.tenant_id
    FROM whatsapp.contacts AS contact
    LEFT JOIN whatsapp.tenant_members AS member
      ON member.contact_id = contact.id
     AND member.status = 'active'
    ORDER BY (member.contact_id IS NOT NULL) DESC,
             COALESCE(contact.last_seen_at, contact.created_at) DESC
    LIMIT 1
  `);
  const contact = selected.rows[0];
  if (!contact?.contact_id || !contact?.tenant_id) {
    throw new Error("facturaya_smoke_fixture_missing");
  }

  const requestId = `facturaya-smoke-${randomUUID()}`;
  const payload = {
    tenant_id: contact.tenant_id,
    contact_id: Number(contact.contact_id),
    operation: "resolve_tenant",
  };
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`, "utf8")
    .digest("hex");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Manolo-Request-Id": requestId,
      "X-Manolo-Timestamp": timestamp,
      "X-Manolo-Signature": `sha256=${signature}`,
    },
    body,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`facturaya_http_${response.status}`);
  if (
    result.request_id !== requestId
    || result.ok !== true
    || !result.data
    || !["authorized", "selection_required", "unauthorized", "unavailable"]
      .includes(result.data.status)
  ) {
    throw new Error("facturaya_invalid_response");
  }
  console.log(JSON.stringify({
    facturaya_multitenancy_smoke: "ok",
    access_status: result.data.status,
  }));
} finally {
  await pool.end();
}
