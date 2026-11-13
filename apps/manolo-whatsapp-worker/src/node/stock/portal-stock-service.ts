import type { PortalCompanyResponse } from "../../bridge/portal-company-contracts";
import type { RoleLog } from "../../roles/contracts";
import type { StockService } from "./stock-service";

type Rows = { rows: Array<Record<string, unknown>> };
export type PortalStockPool = { query(sql: string, values?: readonly unknown[]): Promise<unknown> };

const num = (value: unknown) => Number(value ?? 0);

/**
 * Stock Cat in the portal (ADR-0014, point 19): stock, alerts and recent moves of one
 * company. Any member sees quantities; costs and value only the owner. Documents issued
 * from FacturaYa's website are read first, so the page is current.
 */
export class PortalStockService {
  constructor(
    private readonly pool: PortalStockPool,
    private readonly stock: Pick<StockService, "syncDocuments"> | null,
    private readonly log: RoleLog,
  ) {}

  private async query(sql: string, values: readonly unknown[]): Promise<Rows> {
    return await this.pool.query(sql, values) as Rows;
  }

  async handle(portalUserId: string, tenantId: string): Promise<PortalCompanyResponse> {
    const member = await this.query(
      `SELECT member.role FROM whatsapp.portal_company_members AS member
         JOIN whatsapp.tenants AS tenant ON tenant.id = member.tenant_id AND tenant.status = 'active'
        WHERE member.tenant_id = $1 AND member.portal_user_id = $2`,
      [tenantId, portalUserId],
    );
    if (!member.rows.length) return { status: "forbidden" };
    const owner = member.rows[0].role === "owner";
    const settings = await this.query(
      `SELECT allow_negative FROM stock.settings
        WHERE tenant_id = $1 AND enabled AND (active_until IS NULL OR active_until > CURRENT_TIMESTAMP)`,
      [tenantId],
    );
    if (!settings.rows.length) return { status: "ok", stock: { enabled: false } };
    if (this.stock) {
      try {
        await this.stock.syncDocuments(tenantId);
      } catch {
        this.log("portal_stock_sync_failed");
      }
    }
    const [items, moves, unmatched, value] = await Promise.all([
      this.query(
        `SELECT name, kind, on_hand, min_qty, avg_cost_cents, needs_count FROM stock.items
          WHERE tenant_id = $1 AND active ORDER BY (min_qty IS NOT NULL AND on_hand <= min_qty) DESC, lower(name) LIMIT 500`,
        [tenantId],
      ),
      this.query(
        `SELECT move.created_at, move.kind, move.delta, move.balance_after, move.document_number, item.name
           FROM stock.moves AS move JOIN stock.items AS item ON item.id = move.item_id
          WHERE move.tenant_id = $1 ORDER BY move.created_at DESC LIMIT 60`,
        [tenantId],
      ),
      this.query(
        `SELECT DISTINCT line->>'description' AS description FROM stock.documents, jsonb_array_elements(unmatched) AS line
          WHERE tenant_id = $1 ORDER BY 1 LIMIT 20`,
        [tenantId],
      ),
      owner
        ? this.query(
          `SELECT COALESCE(sum(on_hand * avg_cost_cents) FILTER (WHERE on_hand > 0 AND avg_cost_cents IS NOT NULL), 0) AS value
             FROM stock.items WHERE tenant_id = $1 AND active`,
          [tenantId],
        )
        : Promise.resolve({ rows: [] } as Rows),
    ]);
    return {
      status: "ok",
      stock: {
        enabled: true,
        owner,
        allowNegative: settings.rows[0].allow_negative !== false,
        valueCents: owner ? Math.round(num(value.rows[0]?.value)) : null,
        items: items.rows.map((row) => {
          const minQty = row.min_qty === null ? null : num(row.min_qty);
          return {
            name: String(row.name),
            kind: row.kind === "supply" ? "supply" as const : "product" as const,
            onHand: num(row.on_hand),
            minQty,
            low: minQty !== null && num(row.on_hand) <= minQty,
            needsCount: Boolean(row.needs_count),
            avgCostCents: owner && row.avg_cost_cents !== null ? Math.round(num(row.avg_cost_cents)) : null,
          };
        }),
        moves: moves.rows.map((row) => ({
          at: new Date(row.created_at as string | Date).toISOString(),
          kind: String(row.kind) as "in" | "out" | "count" | "document_out" | "document_in",
          name: String(row.name),
          delta: num(row.delta),
          balance: num(row.balance_after),
          document: (row.document_number as string | null) ?? null,
        })),
        unmatched: unmatched.rows.map((row) => String(row.description)),
      },
    };
  }
}
