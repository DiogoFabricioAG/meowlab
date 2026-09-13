import type { Pool } from "pg";
import type {
  FacturayaTenant,
  FacturayaTenantAccess,
} from "../../facturaya/contracts";

const SESSION_TTL_MINUTES = 20;

type MembershipRow = {
  id: string;
  name: string;
  legal_name: string | null;
  ruc: string | null;
  address: string | null;
  environment: "beta" | "production";
  permissions: unknown;
};

type ContactChannelRow = { tenant_id: string };

type IntegrationRow = MembershipRow & {
  encrypted_token: string;
};

export type AuthorizedFacturayaIntegration = {
  tenant: FacturayaTenant;
  encryptedToken: string;
};

function permissionsFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function tenantFrom(row: MembershipRow): FacturayaTenant {
  return {
    id: row.id,
    name: row.name,
    legalName: row.legal_name,
    ruc: row.ruc,
    address: row.address,
    environment: row.environment,
    permissions: permissionsFrom(row.permissions),
  };
}

export class PgFacturayaTenantRepository {
  constructor(private readonly pool: Pool) {}

  async resolveAccess(
    channelTenantId: string,
    contactId: number,
  ): Promise<FacturayaTenantAccess> {
    const contact = await this.pool.query<ContactChannelRow>(
      `SELECT tenant_id
       FROM whatsapp.contacts
       WHERE id = $1 AND tenant_id = $2
       LIMIT 1`,
      [contactId, channelTenantId],
    );
    if (!contact.rows[0]) {
      return { status: "unauthorized", tenant: null, tenants: [] };
    }

    const memberships = await this.listMemberships(contactId);
    if (memberships.length === 0) {
      return { status: "unauthorized", tenant: null, tenants: [] };
    }

    const active = await this.pool.query<{ active_tenant_id: string }>(
      `SELECT session.active_tenant_id
       FROM whatsapp.facturaya_sessions AS session
       INNER JOIN whatsapp.tenant_members AS member
         ON member.tenant_id = session.active_tenant_id
        AND member.contact_id = session.contact_id
        AND member.status = 'active'
       INNER JOIN whatsapp.tenants AS tenant
         ON tenant.id = member.tenant_id
        AND tenant.status = 'active'
       INNER JOIN whatsapp.tenant_integrations AS integration
         ON integration.tenant_id = tenant.id
        AND integration.provider = 'facturaya'
        AND integration.status = 'active'
       WHERE session.channel_tenant_id = $1
         AND session.contact_id = $2
         AND session.expires_at > CURRENT_TIMESTAMP
       LIMIT 1`,
      [channelTenantId, contactId],
    );
    const activeTenant = memberships.find(
      (tenant) => tenant.id === active.rows[0]?.active_tenant_id,
    );
    if (activeTenant) {
      await this.touchSession(channelTenantId, contactId, activeTenant.id);
      return { status: "authorized", tenant: activeTenant, tenants: memberships };
    }

    if (memberships.length === 1) {
      await this.touchSession(channelTenantId, contactId, memberships[0].id);
      return {
        status: "authorized",
        tenant: memberships[0],
        tenants: memberships,
      };
    }
    return {
      status: "selection_required",
      tenant: null,
      tenants: memberships,
    };
  }

  async selectTenant(
    tenantId: string,
    contactId: number,
  ): Promise<FacturayaTenantAccess> {
    const channel = await this.pool.query<ContactChannelRow>(
      `SELECT contact.tenant_id
       FROM whatsapp.contacts AS contact
       INNER JOIN whatsapp.tenant_members AS member
         ON member.contact_id = contact.id
        AND member.tenant_id = $1
        AND member.status = 'active'
       INNER JOIN whatsapp.tenants AS tenant
         ON tenant.id = member.tenant_id
        AND tenant.status = 'active'
       INNER JOIN whatsapp.tenant_integrations AS integration
         ON integration.tenant_id = tenant.id
        AND integration.provider = 'facturaya'
        AND integration.status = 'active'
       WHERE contact.id = $2
       LIMIT 1`,
      [tenantId, contactId],
    );
    const channelTenantId = channel.rows[0]?.tenant_id;
    if (!channelTenantId) {
      return { status: "unauthorized", tenant: null, tenants: [] };
    }
    await this.touchSession(channelTenantId, contactId, tenantId);
    return this.resolveAccess(channelTenantId, contactId);
  }

  async clearTenant(channelTenantId: string, contactId: number): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM whatsapp.facturaya_sessions AS session
       USING whatsapp.contacts AS contact
       WHERE session.channel_tenant_id = $1
         AND session.contact_id = $2
         AND contact.id = session.contact_id
         AND contact.tenant_id = session.channel_tenant_id`,
      [channelTenantId, contactId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async resolveIntegration(
    tenantId: string,
    contactId: number,
    permission: string,
  ): Promise<AuthorizedFacturayaIntegration | null> {
    const result = await this.pool.query<IntegrationRow>(
      `SELECT
         tenant.id,
         tenant.name,
         tenant.legal_name,
         tenant.ruc,
         tenant.address,
         integration.environment,
         integration.encrypted_token,
         member.permissions
       FROM whatsapp.contacts AS contact
       INNER JOIN whatsapp.facturaya_sessions AS session
         ON session.channel_tenant_id = contact.tenant_id
        AND session.contact_id = contact.id
        AND session.active_tenant_id = $1
        AND session.expires_at > CURRENT_TIMESTAMP
       INNER JOIN whatsapp.tenant_members AS member
         ON member.tenant_id = session.active_tenant_id
        AND member.contact_id = contact.id
        AND member.status = 'active'
       INNER JOIN whatsapp.tenants AS tenant
         ON tenant.id = member.tenant_id
        AND tenant.status = 'active'
       INNER JOIN whatsapp.tenant_integrations AS integration
         ON integration.tenant_id = tenant.id
        AND integration.provider = 'facturaya'
        AND integration.status = 'active'
       WHERE contact.id = $2
         AND member.permissions ? $3
       LIMIT 1`,
      [tenantId, contactId, permission],
    );
    const row = result.rows[0];
    if (!row) return null;
    await this.touchSessionForContact(contactId, tenantId);
    return { tenant: tenantFrom(row), encryptedToken: row.encrypted_token };
  }

  async recordAudit(input: {
    tenantId: string;
    contactId: number;
    operation: string;
    idempotencyKey: string;
    status: "started" | "completed" | "failed";
    resourceType?: string | null;
    resourceId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO whatsapp.facturaya_audit_logs (
         tenant_id,
         contact_id,
         operation,
         resource_type,
         resource_id,
         idempotency_key,
         status,
         metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        input.tenantId,
        input.contactId,
        input.operation,
        input.resourceType ?? null,
        input.resourceId ?? null,
        input.idempotencyKey,
        input.status,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }

  async saveIntegration(input: {
    tenantId: string;
    encryptedToken: string;
    environment: "beta" | "production";
    status: "active" | "inactive";
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO whatsapp.tenant_integrations (
         tenant_id, provider, encrypted_token, environment, status
       ) VALUES ($1, 'facturaya', $2, $3, $4)
       ON CONFLICT (tenant_id, provider)
       DO UPDATE SET encrypted_token = EXCLUDED.encrypted_token,
                     environment = EXCLUDED.environment,
                     status = EXCLUDED.status,
                     last_connection_check = NULL,
                     last_connection_status = NULL,
                     last_connection_error = NULL,
                     updated_at = CURRENT_TIMESTAMP`,
      [input.tenantId, input.encryptedToken, input.environment, input.status],
    );
  }

  async getIntegrationForAdmin(tenantId: string): Promise<{
    encryptedToken: string;
    environment: "beta" | "production";
    status: "active" | "inactive";
  } | null> {
    const result = await this.pool.query<{
      encrypted_token: string;
      environment: "beta" | "production";
      status: "active" | "inactive";
    }>(
      `SELECT encrypted_token, environment, status
       FROM whatsapp.tenant_integrations
       WHERE tenant_id = $1 AND provider = 'facturaya'
       LIMIT 1`,
      [tenantId],
    );
    const row = result.rows[0];
    return row
      ? {
          encryptedToken: row.encrypted_token,
          environment: row.environment,
          status: row.status,
        }
      : null;
  }

  async updateConnectionCheck(
    tenantId: string,
    status: "ok" | "failed",
    error: string | null,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE whatsapp.tenant_integrations
       SET last_connection_check = CURRENT_TIMESTAMP,
           last_connection_status = $2,
           last_connection_error = $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = $1 AND provider = 'facturaya'`,
      [tenantId, status, error?.slice(0, 500) ?? null],
    );
  }

  async setIntegrationStatus(
    tenantId: string,
    status: "active" | "inactive",
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE whatsapp.tenant_integrations
       SET status = $2, updated_at = CURRENT_TIMESTAMP
       WHERE tenant_id = $1 AND provider = 'facturaya'`,
      [tenantId, status],
    );
    return (result.rowCount ?? 0) > 0;
  }

  private async listMemberships(contactId: number): Promise<FacturayaTenant[]> {
    const result = await this.pool.query<MembershipRow>(
      `SELECT
         tenant.id,
         tenant.name,
         tenant.legal_name,
         tenant.ruc,
         tenant.address,
         integration.environment,
         member.permissions
       FROM whatsapp.tenant_members AS member
       INNER JOIN whatsapp.tenants AS tenant
         ON tenant.id = member.tenant_id
        AND tenant.status = 'active'
       INNER JOIN whatsapp.tenant_integrations AS integration
         ON integration.tenant_id = tenant.id
        AND integration.provider = 'facturaya'
        AND integration.status = 'active'
       WHERE member.contact_id = $1
         AND member.status = 'active'
       ORDER BY COALESCE(tenant.legal_name, tenant.name), tenant.id`,
      [contactId],
    );
    return result.rows.map(tenantFrom);
  }

  private async touchSession(
    channelTenantId: string,
    contactId: number,
    activeTenantId: string,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO whatsapp.facturaya_sessions (
         channel_tenant_id, contact_id, active_tenant_id, expires_at
       ) VALUES (
         $1, $2, $3,
         CURRENT_TIMESTAMP + ($4 * INTERVAL '1 minute')
       )
       ON CONFLICT (channel_tenant_id, contact_id)
       DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id,
                     expires_at = EXCLUDED.expires_at,
                     updated_at = CURRENT_TIMESTAMP`,
      [channelTenantId, contactId, activeTenantId, SESSION_TTL_MINUTES],
    );
  }

  private async touchSessionForContact(
    contactId: number,
    activeTenantId: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE whatsapp.facturaya_sessions
       SET expires_at = CURRENT_TIMESTAMP + ($3 * INTERVAL '1 minute'),
           updated_at = CURRENT_TIMESTAMP
       WHERE contact_id = $1
         AND active_tenant_id = $2`,
      [contactId, activeTenantId, SESSION_TTL_MINUTES],
    );
  }
}
