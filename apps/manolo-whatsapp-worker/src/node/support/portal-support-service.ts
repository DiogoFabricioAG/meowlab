import type { PortalCompanyResponse, SupportFaqChange } from "../../bridge/portal-company-contracts";
import type { RoleLog } from "../../roles/contracts";
import type { SupportService } from "./support-service";

type Rows = { rows: Array<Record<string, unknown>> };
export type PortalSupportPool = { query(sql: string, values?: readonly unknown[]): Promise<unknown> };

/**
 * Support Cat in the portal (ADR-0017, points 5 and 8): the frequent questions (edited by the
 * owner), the tickets and today's numbers. Answering a ticket happens in the chat, where the
 * message to the customer goes out.
 */
export class PortalSupportService {
  constructor(
    private readonly pool: PortalSupportPool,
    private readonly support: Pick<SupportService, "enabled" | "snapshot" | "saveFaq">,
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
    if (!await this.support.enabled(tenantId)) return { status: "ok", support: { enabled: false } };
    return { status: "ok", support: { enabled: true, owner: member.owner, ...await this.support.snapshot(tenantId) } };
  }

  async faq(portalUserId: string, tenantId: string, faq: SupportFaqChange): Promise<PortalCompanyResponse> {
    const member = await this.member(portalUserId, tenantId);
    if (!member) return { status: "forbidden" };
    if (!member.owner) return { status: "owner_only" };
    if (!await this.support.enabled(tenantId)) return { status: "ok", support: { enabled: false } };
    try {
      await this.support.saveFaq(tenantId, portalUserId, faq);
    } catch (error) {
      if (error instanceof Error && (error.message === "not_found" || error.message === "too_many")) return { status: "invalid_settings" };
      this.log("portal_support_faq_failed");
      throw error;
    }
    return this.view(portalUserId, tenantId);
  }
}
