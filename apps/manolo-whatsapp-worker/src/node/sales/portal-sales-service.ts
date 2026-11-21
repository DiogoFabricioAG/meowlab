import type { PortalCompanyResponse, SalesSettingsChange, SalesView } from "../../bridge/portal-company-contracts";
import { validateCatName } from "../../sales/cat-name";
import { monthRange } from "./sales-service";

type Rows = { rows: Array<Record<string, unknown>> };
export type PortalSalesPool = { query(sql: string, values?: readonly unknown[]): Promise<unknown> };

const LIMA_OFFSET_MS = 5 * 3_600_000;
const limaMonth = (now: Date) => new Date(now.getTime() - LIMA_OFFSET_MS).toISOString().slice(0, 7);

/**
 * Sales Cat in the portal (ADR-0011, phase 3): monthly goal progress, monthly goal setup
 * and custom cat name per company. All company members have the same access (decision 18).
 */
export class PortalSalesService {
  constructor(
    private readonly pool: PortalSalesPool,
    private readonly now: () => Date = () => new Date(),
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

  private async currentView(tenantId: string, owner: boolean, month: string): Promise<SalesView> {
    const { rows: settings } = await this.pool.query(
      `SELECT enabled AND (active_until IS NULL OR active_until > CURRENT_TIMESTAMP) AS enabled, cat_name
         FROM sales.settings WHERE tenant_id = $1`,
      [tenantId],
    ) as Rows;
    if (!settings[0]?.enabled) return { enabled: false };
    const { from, to, daysInMonth } = monthRange(month);
    const todayLima = new Date(this.now().getTime() - LIMA_OFFSET_MS).toISOString().slice(0, 10);
    const currentDay = month === todayLima.slice(0, 7) ? Number(todayLima.slice(8, 10)) : null;
    const [goalRow, salesRow] = await Promise.all([
      this.pool.query("SELECT target_cents FROM sales.monthly_goals WHERE tenant_id = $1 AND month = $2", [tenantId, month]) as Promise<Rows>,
      this.pool.query(
        `SELECT count(*)::int AS n, COALESCE(sum(total_cents), 0)::bigint AS total
           FROM sales.sales WHERE tenant_id = $1 AND status = 'confirmed' AND sold_at >= $2 AND sold_at < $3`,
        [tenantId, from, to],
      ) as Promise<Rows>,
    ]);
    return {
      enabled: true,
      owner,
      catName: settings[0].cat_name ? String(settings[0].cat_name) : null,
      month,
      goalTargetCents: goalRow.rows[0] ? Number(goalRow.rows[0].target_cents) : null,
      monthTotalCents: Number(salesRow.rows[0]?.total ?? 0),
      monthCount: Number(salesRow.rows[0]?.n ?? 0),
      daysInMonth,
      currentDay,
    };
  }

  async view(portalUserId: string, tenantId: string): Promise<PortalCompanyResponse> {
    const member = await this.member(portalUserId, tenantId);
    if (!member) return { status: "forbidden" };
    const sales = await this.currentView(tenantId, member.owner, limaMonth(this.now()));
    return { status: "ok", sales };
  }

  async settings(portalUserId: string, tenantId: string, change: SalesSettingsChange): Promise<PortalCompanyResponse> {
    const member = await this.member(portalUserId, tenantId);
    if (!member) return { status: "forbidden" };
    const current = await this.currentView(tenantId, member.owner, change.month ?? limaMonth(this.now()));
    if (!current.enabled) return { status: "ok", sales: { enabled: false } };

    if (change.catName !== undefined) {
      if (change.catName === null || change.catName.trim() === "") {
        await this.pool.query("UPDATE sales.settings SET cat_name = NULL, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = $1", [tenantId]);
      } else {
        const check = validateCatName(change.catName);
        if (!check.ok) return { status: "invalid_cat_name" };
        await this.pool.query("UPDATE sales.settings SET cat_name = $2, updated_at = CURRENT_TIMESTAMP WHERE tenant_id = $1", [tenantId, check.name]);
      }
    }
    if (change.goalTargetCents !== undefined) {
      const month = change.month ?? limaMonth(this.now());
      if (change.goalTargetCents === null) {
        await this.pool.query("DELETE FROM sales.monthly_goals WHERE tenant_id = $1 AND month = $2", [tenantId, month]);
      } else {
        await this.pool.query(
          `INSERT INTO sales.monthly_goals (tenant_id, month, target_cents, updated_by_portal_user_id, updated_at)
           VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
           ON CONFLICT (tenant_id, month)
           DO UPDATE SET target_cents = EXCLUDED.target_cents, updated_by_portal_user_id = EXCLUDED.updated_by_portal_user_id, updated_at = CURRENT_TIMESTAMP`,
          [tenantId, month, change.goalTargetCents, portalUserId],
        );
      }
    }
    const sales = await this.currentView(tenantId, member.owner, change.month ?? limaMonth(this.now()));
    return { status: "ok", sales };
  }
}
