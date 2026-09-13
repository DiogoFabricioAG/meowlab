export type FinanceProposal = {
  movementType: "Income" | "Expense";
  amount: number;
  description: string;
};

export type FinanceMonthlySummary = {
  income: number;
  expense: number;
};

export interface FinanceRepository {
  saveMovement(
    senderId: string,
    tenantId: string,
    proposal: FinanceProposal,
  ): Promise<number | null>;
  getMonthlySummary(
    senderId: string,
    tenantId: string,
  ): Promise<FinanceMonthlySummary | null>;
}
