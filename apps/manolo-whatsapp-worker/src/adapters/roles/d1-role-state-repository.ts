import type { RoleStateRepository } from "../../roles/state";

export class D1RoleStateRepository implements RoleStateRepository {
  constructor(private readonly database: D1Database | null | undefined) {}

  async get(
    tenantId: string,
    contactId: number,
    roleKey: string,
  ): Promise<string | null> {
    if (!this.database) return null;

    try {
      const row = await this.database
        .prepare(
          `SELECT state_json
           FROM contact_role_states
           WHERE tenant_id = ?1 AND contact_id = ?2 AND role_key = ?3
           LIMIT 1`,
        )
        .bind(tenantId, contactId, roleKey)
        .first<{ state_json: string }>();
      return row?.state_json ?? null;
    } catch {
      return null;
    }
  }

  async set(
    tenantId: string,
    contactId: number,
    roleKey: string,
    stateJson: string,
  ): Promise<boolean> {
    if (!this.database) return false;

    try {
      await this.database
        .prepare(
          `INSERT INTO contact_role_states (
             tenant_id, contact_id, role_key, state_json
           ) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT (tenant_id, contact_id, role_key)
           DO UPDATE SET state_json = excluded.state_json,
                         updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(tenantId, contactId, roleKey, stateJson)
        .run();
      return true;
    } catch {
      return false;
    }
  }

  async clear(
    tenantId: string,
    contactId: number,
    roleKey: string,
  ): Promise<boolean> {
    if (!this.database) return false;

    try {
      const result = await this.database
        .prepare(
          `DELETE FROM contact_role_states
           WHERE tenant_id = ?1 AND contact_id = ?2 AND role_key = ?3`,
        )
        .bind(tenantId, contactId, roleKey)
        .run();
      return result.meta.changes > 0;
    } catch {
      return false;
    }
  }
}
