import type { CollectionsSettings } from "../../collections/bridge-contracts";
import type { PortalCompanyResponse } from "../../bridge/portal-company-contracts";
import type { RoleLog } from "../../roles/contracts";
import type { CollectionsService } from "./collections-service";

type Rows = { rows: Array<Record<string, unknown>> };
export type PortalCollectionsPool = { query(sql: string, values?: readonly unknown[]): Promise<unknown> };

/**
 * Collections Cat in the portal (ADR-0015, points 8 and 17): what the company is owed with
 * each customer's data, the captures to validate and «talk to these customers». Any member
 * sees it; only the owner changes the rules. Sales and FacturaYa are read first.
 */
export class PortalCollectionsService {
  constructor(
    private readonly pool: PortalCollectionsPool,
    private readonly collections: Pick<CollectionsService, "sync" | "snapshot" | "changeSettings">,
    private readonly log: RoleLog,
  ) {}

  private async member(portalUserId: string, tenantId: string): Promise<{ owner: boolean } | null> {
    const { rows } = await this.pool.query(
      `SELECT member.role FROM whatsapp.portal_company_members AS member
         JOIN whatsapp.tenants AS tenant ON tenant.id = member.tenant_id AND tenant.status = 'active'
        WHERE member.tenant_id = $1 AND member.portal_user_id = $2`,
      [tenantId, portalUserId],
    ) as Rows;
    return rows.length ? { owner: rows[0].role === "owner" } : null;
  }

  private async enabled(tenantId: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM receivables.settings
        WHERE tenant_id = $1 AND enabled AND (active_until IS NULL OR active_until > CURRENT_TIMESTAMP)`,
      [tenantId],
    ) as Rows;
    return rows.length > 0;
  }

  async view(portalUserId: string, tenantId: string): Promise<PortalCompanyResponse> {
    const member = await this.member(portalUserId, tenantId);
    if (!member) return { status: "forbidden" };
    if (!await this.enabled(tenantId)) return { status: "ok", collections: { enabled: false } };
    try {
      await this.collections.sync(tenantId);
    } catch {
      this.log("portal_collections_sync_failed");
    }
    const snapshot = await this.collections.snapshot(tenantId);
    return { status: "ok", collections: { enabled: true, owner: member.owner, ...snapshot } };
  }

  async settings(portalUserId: string, tenantId: string, change: Partial<CollectionsSettings>): Promise<PortalCompanyResponse> {
    const member = await this.member(portalUserId, tenantId);
    if (!member) return { status: "forbidden" };
    if (!member.owner) return { status: "owner_only" };
    if (!await this.enabled(tenantId)) return { status: "ok", collections: { enabled: false } };
    try {
      await this.collections.changeSettings(tenantId, { contactId: null, portalUserId }, change);
    } catch (error) {
      if (error instanceof Error && error.message === "invalid_window") return { status: "invalid_settings" };
      throw error;
    }
    return this.view(portalUserId, tenantId);
  }
}
