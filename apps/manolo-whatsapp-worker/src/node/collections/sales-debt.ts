import { randomUUID } from "node:crypto";
import { addDays, limaDate } from "../../collections/schedule";

type Rows = { rows: Array<Record<string, unknown>> };
export type SalesDebtClient = { query(sql: string, values?: readonly unknown[]): Promise<Rows> };

export type CreateSaleDebtInput = {
  companyId: string;
  saleId: string;
  saleNumber: number;
  customerId: string | null;
  customerName: string;
  amountCents: number;
  soldAt: Date;
  dueDate?: string | null;
  invoiceNumber?: string | null;
  contactId: number | null;
};

/**
 * Creates a single Collections Cat debt for a confirmed credit sale when the company has
 * Collections Cat active (ADR-0011, decision 9). Idempotent per sale (`sale:<id>`).
 */
export async function createSaleDebt(
  client: SalesDebtClient,
  input: CreateSaleDebtInput,
): Promise<{ created: boolean; dueOn: string | null }> {
  if (input.amountCents <= 0) return { created: false, dueOn: null };
  const settings = await client.query(
    `SELECT default_due_days FROM receivables.settings
      WHERE tenant_id = $1 AND enabled AND (active_until IS NULL OR active_until > CURRENT_TIMESTAMP)`,
    [input.companyId],
  );
  if (!settings.rows.length) return { created: false, dueOn: null };

  let customerId = input.customerId;
  if (!customerId) {
    const fallbackName = input.customerName.trim().slice(0, 200) || "Cliente varios";
    const { rows } = await client.query(
      `INSERT INTO commerce.customers (id, tenant_id, doc_type, doc_number, name, created_by_contact_id)
       VALUES ($1, $2, '0', NULL, $3, $4)
       ON CONFLICT (tenant_id, lower(name)) WHERE doc_number IS NULL
       DO UPDATE SET updated_at = CURRENT_TIMESTAMP RETURNING id`,
      [randomUUID(), input.companyId, fallbackName, input.contactId],
    );
    customerId = String(rows[0].id);
  }

  const issuedOn = limaDate(input.soldAt);
  const defaultDueDays = Number(settings.rows[0].default_due_days ?? 30);
  const dueOn = input.dueDate ?? addDays(issuedOn, defaultDueDays);
  const { rows } = await client.query(
    `INSERT INTO receivables.debts
       (id, tenant_id, customer_id, sale_id, source, source_ref, document_number, description, amount_cents, balance_cents, issued_on, due_on, created_by_contact_id)
     VALUES ($1, $2, $3, $4, 'sale', $5, $6, $7, $8, $8, $9, $10, $11)
     ON CONFLICT (tenant_id, source_ref) WHERE source_ref IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      randomUUID(),
      input.companyId,
      customerId,
      input.saleId,
      `sale:${input.saleId}`,
      input.invoiceNumber ?? null,
      `Venta N° ${input.saleNumber}`,
      input.amountCents,
      issuedOn,
      dueOn,
      input.contactId,
    ],
  );
  return { created: rows.length > 0, dueOn };
}

export type CancelSaleDebtResult = { status: "none" | "cancelled" | "has_payments" };

/**
 * Cancels the Collections Cat debt linked to a cancelled sale if it has no confirmed payments.
 * If payments already exist, leaves the debt untouched so the owner can review it.
 */
export async function cancelSaleDebt(
  client: SalesDebtClient,
  companyId: string,
  saleId: string,
): Promise<CancelSaleDebtResult> {
  const { rows } = await client.query(
    `SELECT id FROM receivables.debts
      WHERE tenant_id = $1 AND (sale_id = $2 OR source_ref = $3) AND status <> 'cancelled'
      LIMIT 1`,
    [companyId, saleId, `sale:${saleId}`],
  );
  if (!rows.length) return { status: "none" };
  const debtId = String(rows[0].id);
  const payments = await client.query(
    `SELECT 1 FROM receivables.payments
      WHERE tenant_id = $1 AND debt_id = $2 AND status = 'confirmed'
      LIMIT 1`,
    [companyId, debtId],
  );
  if (payments.rows.length) return { status: "has_payments" };
  await client.query(
    `UPDATE receivables.debts SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = $1 AND id = $2 AND status <> 'cancelled'`,
    [companyId, debtId],
  );
  return { status: "cancelled" };
}
