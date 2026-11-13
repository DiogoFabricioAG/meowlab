import {
  ENTITLED_AGENTS,
  type PortalEntitlementRequest,
  type PortalEntitlementResponse,
} from "../../bridge/portal-entitlement-contracts";
import type { RoleLog } from "../../roles/contracts";

type Rows = { rows: Array<Record<string, unknown>> };
export type EntitlementPool = { query(sql: string, values?: readonly unknown[]): Promise<unknown> };

/**
 * Switches on what a company paid for (Sales Cat today) until the end of the paid period.
 * Idempotent and monotonic: repeating a call or sending an older date never shortens the
 * period. Courtesy activations (set by hand) are never touched.
 */
export class PortalEntitlementService {
  constructor(private readonly pool: EntitlementPool, private readonly log: RoleLog) {}

  async handle(request: PortalEntitlementRequest): Promise<PortalEntitlementResponse> {
    const { rows } = await this.pool.query(
      "SELECT 1 FROM whatsapp.tenants WHERE id = $1 AND status = 'active'",
      [request.tenantId],
    ) as Rows;
    if (!rows.length) return { status: "not_found" };
    const applied: string[] = [];
    const skipped: string[] = [];
    for (const agent of new Set(request.agents)) {
      if (!(ENTITLED_AGENTS as readonly string[]).includes(agent)) {
        skipped.push(agent);
        continue;
      }
      await this.pool.query(
        `INSERT INTO sales.settings (tenant_id, enabled, source, active_until, updated_at)
         VALUES ($1, TRUE, 'subscription', $2, CURRENT_TIMESTAMP)
         ON CONFLICT (tenant_id) DO UPDATE SET
           enabled = CASE WHEN sales.settings.source = 'courtesy' THEN sales.settings.enabled ELSE TRUE END,
           active_until = CASE WHEN sales.settings.source = 'courtesy' THEN sales.settings.active_until
                               ELSE GREATEST(sales.settings.active_until, EXCLUDED.active_until) END,
           updated_at = CURRENT_TIMESTAMP`,
        [request.tenantId, new Date(request.activeUntil)],
      );
      applied.push(agent);
    }
    this.log("portal_entitlement_applied", { applied, skipped });
    return { status: "ok", applied, skipped };
  }
}
