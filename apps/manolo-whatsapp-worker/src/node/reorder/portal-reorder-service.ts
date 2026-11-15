import type { ReorderSettings } from "../../reorder/bridge-contracts";
import type { PortalCompanyResponse } from "../../bridge/portal-company-contracts";
import type { RoleLog } from "../../roles/contracts";
import type { ReorderService } from "./reorder-service";

type Rows = { rows: Array<Record<string, unknown>> };
export type PortalReorderPool = { query(sql: string, values?: readonly unknown[]): Promise<unknown> };

/**
 * Reorder Cat in the portal (ADR-0016, point 18): orders to approve and on their way, the
 * suppliers and this month's purchases. Any member sees it; only the owner changes the
 * budget and the waiting times. Approving stays in the chat, where the order is sent.
 */
export class PortalReorderService {
  constructor(
    private readonly pool: PortalReorderPool,
    private readonly reorder: Pick<ReorderService, "enabled" | "snapshot" | "changeSettings">,
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

  async view(portalUserId: string, tenantId: string): Promise<PortalCompanyResponse> {
    const member = await this.member(portalUserId, tenantId);
    if (!member) return { status: "forbidden" };
    if (!await this.reorder.enabled(tenantId)) return { status: "ok", reorder: { enabled: false } };
    const snapshot = await this.reorder.snapshot(tenantId);
    return { status: "ok", reorder: { enabled: true, owner: member.owner, ...snapshot } };
  }

  async settings(portalUserId: string, tenantId: string, change: Partial<ReorderSettings>): Promise<PortalCompanyResponse> {
    const member = await this.member(portalUserId, tenantId);
    if (!member) return { status: "forbidden" };
    if (!member.owner) return { status: "owner_only" };
    if (!await this.reorder.enabled(tenantId)) return { status: "ok", reorder: { enabled: false } };
    try {
      await this.reorder.changeSettings(tenantId, { contactId: null, portalUserId }, change);
    } catch (error) {
      if (error instanceof Error && error.message === "invalid_settings") return { status: "invalid_settings" };
      this.log("portal_reorder_settings_failed");
      throw error;
    }
    return this.view(portalUserId, tenantId);
  }
}
