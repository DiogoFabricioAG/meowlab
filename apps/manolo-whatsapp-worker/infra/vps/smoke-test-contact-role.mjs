import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

const { Pool } = pg;
const secret = readFileSync(
  "/run/secrets/vps_bridge_hmac_secret",
  "utf8",
).trim();
const endpoint = process.env.CONTACT_ROLE_SMOKE_URL
  ?? "http://127.0.0.1:3000/v1/control/contacts/resolve-role";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

try {
  const selected = await pool.query(`
    SELECT
      contact.tenant_id,
      number.phone_number_id,
      contact.whatsapp_user_id,
      COALESCE(contact_role.role_key, tenant_role.role_key) AS expected_role
    FROM whatsapp.contacts AS contact
    INNER JOIN whatsapp.whatsapp_numbers AS number
      ON number.tenant_id = contact.tenant_id AND number.active = TRUE
    INNER JOIN whatsapp.bot_configs AS config
      ON config.tenant_id = contact.tenant_id
    LEFT JOIN whatsapp.role_catalog AS contact_role
      ON contact_role.role_key = NULLIF(BTRIM(contact.active_role_key), '')
     AND contact_role.active = TRUE
    LEFT JOIN whatsapp.role_catalog AS tenant_role
      ON tenant_role.role_key = NULLIF(BTRIM(config.role_key), '')
     AND tenant_role.active = TRUE
    ORDER BY COALESCE(contact.last_seen_at, contact.created_at) DESC
    LIMIT 1
  `);
  const contact = selected.rows[0];
  if (!contact?.expected_role) throw new Error("contact_role_smoke_fixture_missing");

  const requestId = `contact-role-smoke-${randomUUID()}`;
  const payload = {
    version: 1,
    requestId,
    tenantId: contact.tenant_id,
    phoneNumberId: contact.phone_number_id,
    whatsappUserId: contact.whatsapp_user_id,
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
  if (!response.ok) throw new Error(`contact_role_http_${response.status}`);
  if (
    result.requestId !== requestId
    || result.roleKey !== contact.expected_role
    || !["contact", "tenant"].includes(result.source)
  ) {
    throw new Error("contact_role_invalid_response");
  }
  console.log(JSON.stringify({
    contact_role_smoke: "ok",
    role: result.roleKey,
    source: result.source,
  }));
} finally {
  await pool.end();
}
