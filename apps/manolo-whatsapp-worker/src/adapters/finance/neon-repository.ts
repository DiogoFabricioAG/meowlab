import { neon } from "@neondatabase/serverless";
import type {
  FinanceMonthlySummary,
  FinanceProposal,
  FinanceRepository,
} from "../../finance/contracts";

type FinanceLogger = (
  event: string,
  details?: Record<string, unknown>,
) => void;

export class NeonFinanceRepository implements FinanceRepository {
  constructor(
    private readonly databaseUrl: string | undefined,
    private readonly log: FinanceLogger,
  ) {}

  async saveMovement(
    senderId: string,
    tenantId: string,
    proposal: FinanceProposal,
  ): Promise<number | null> {
    if (!this.databaseUrl?.trim()) {
      this.log("whatsapp_finance_save_failed", {
        reason: "missing_neon_configuration",
      });
      return null;
    }

    try {
      const sql = neon(this.databaseUrl);
      const userRows = await sql`
        INSERT INTO public.authenticatedusers (tenant_id, number)
        VALUES (${tenantId}, ${senderId})
        ON CONFLICT (tenant_id, number)
        DO UPDATE SET number = EXCLUDED.number
        RETURNING id
      `;
      const userId = userRows[0]?.id;

      if (typeof userId !== "number") {
        this.log("whatsapp_finance_save_failed", {
          reason: "neon_user_upsert_missing_id",
        });
        return null;
      }

      const invoiceRows = await sql`
        INSERT INTO public.invoices (
          tenant_id,
          amount,
          description,
          created_at,
          user_id,
          movement_type
        )
        VALUES (
          ${tenantId},
          ${proposal.amount},
          ${proposal.description},
          NOW(),
          ${userId},
          ${proposal.movementType}
        )
        RETURNING id
      `;
      const invoiceId = invoiceRows[0]?.id;

      if (typeof invoiceId !== "number") {
        this.log("whatsapp_finance_save_failed", {
          reason: "neon_invoice_insert_missing_id",
        });
        return null;
      }

      this.log("whatsapp_finance_saved", { invoiceId });
      return invoiceId;
    } catch {
      this.log("whatsapp_finance_save_failed", {
        reason: "neon_database_error",
      });
      return null;
    }
  }

  async getMonthlySummary(
    senderId: string,
    tenantId: string,
  ): Promise<FinanceMonthlySummary | null> {
    if (!this.databaseUrl?.trim()) {
      return null;
    }

    try {
      const sql = neon(this.databaseUrl);
      const rows = (await sql`
        SELECT i.movement_type, COALESCE(SUM(i.amount), 0) AS total
        FROM public.invoices i
        INNER JOIN public.authenticatedusers u ON u.id = i.user_id
        WHERE i.tenant_id = ${tenantId}
          AND u.tenant_id = ${tenantId}
          AND u.number = ${senderId}
          AND i.created_at >= date_trunc('month', CURRENT_DATE)
        GROUP BY i.movement_type
      `) as Array<Record<string, unknown>>;

      let income = 0;
      let expense = 0;
      for (const row of rows) {
        const total = Number(row.total);
        if (!Number.isFinite(total)) {
          continue;
        }
        if (row.movement_type === "Income") {
          income += total;
        } else if (row.movement_type === "Expense") {
          expense += total;
        }
      }

      return { income, expense };
    } catch {
      this.log("whatsapp_finance_summary_failed", {
        reason: "neon_database_error",
      });
      return null;
    }
  }
}
