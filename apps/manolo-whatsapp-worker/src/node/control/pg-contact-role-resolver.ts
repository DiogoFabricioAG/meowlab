import type { Pool } from "pg";
import type { ContactRoleResolutionRequest } from "../../bridge/contracts";
import type { ContactRoleResolver } from "./contact-role-resolver";

type ContactRoleRow = {
  role_key: string | null;
  role_source: "contact" | "tenant" | "not_found";
};

export class PgContactRoleResolver implements ContactRoleResolver {
  constructor(private readonly pool: Pool) {}

  async resolve(request: ContactRoleResolutionRequest): Promise<{
    roleKey: string | null;
    source: ContactRoleRow["role_source"];
  }> {
    const result = await this.pool.query<ContactRoleRow>(
      `WITH valid_tenant AS (
         SELECT tenant.id
         FROM whatsapp.tenants AS tenant
         INNER JOIN whatsapp.whatsapp_numbers AS number
           ON number.tenant_id = tenant.id
         WHERE tenant.id = $1
           AND number.phone_number_id = $2
           AND tenant.status = 'active'
           AND number.active = TRUE
         LIMIT 1
       ), upserted_contact AS (
         INSERT INTO whatsapp.contacts (
           tenant_id,
           whatsapp_user_id,
           display_phone,
           phone_e164,
           last_seen_at,
           updated_at
         )
         SELECT
           id,
           $3,
           $3,
           CASE WHEN $3 ~ '^[1-9][0-9]{7,14}$' THEN '+' || $3 ELSE NULL END,
           CURRENT_TIMESTAMP,
           CURRENT_TIMESTAMP
         FROM valid_tenant
         ON CONFLICT (tenant_id, whatsapp_user_id)
         DO UPDATE SET
           display_phone = EXCLUDED.display_phone,
           phone_e164 = EXCLUDED.phone_e164,
           last_seen_at = EXCLUDED.last_seen_at,
           updated_at = EXCLUDED.updated_at
         RETURNING tenant_id, active_role_key
       )
       SELECT
         COALESCE(contact_role.role_key, tenant_role.role_key) AS role_key,
         CASE
           WHEN contact_role.role_key IS NOT NULL THEN 'contact'
           WHEN tenant_role.role_key IS NOT NULL THEN 'tenant'
           ELSE 'not_found'
         END AS role_source
       FROM upserted_contact AS contact
       INNER JOIN whatsapp.bot_configs AS config
         ON config.tenant_id = contact.tenant_id
       LEFT JOIN whatsapp.role_catalog AS contact_role
         ON contact_role.role_key = NULLIF(BTRIM(contact.active_role_key), '')
        AND contact_role.active = TRUE
       LEFT JOIN whatsapp.role_catalog AS tenant_role
         ON tenant_role.role_key = NULLIF(BTRIM(config.role_key), '')
        AND tenant_role.active = TRUE
       LIMIT 1`,
      [request.tenantId, request.phoneNumberId, request.whatsappUserId],
    );

    const row = result.rows[0];
    if (!row) return { roleKey: null, source: "not_found" };
    return {
      roleKey: row.role_key?.trim() || null,
      source: row.role_source,
    };
  }
}
