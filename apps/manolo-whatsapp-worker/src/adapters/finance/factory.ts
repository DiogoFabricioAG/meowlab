import type { FinanceRepository } from "../../finance/contracts";
import { NeonFinanceRepository } from "./neon-repository";

type FinanceLogger = (
  event: string,
  details?: Record<string, unknown>,
) => void;

export function createFinanceRepository(
  databaseUrl: string | undefined,
  log: FinanceLogger,
): FinanceRepository | null {
  return databaseUrl?.trim()
    ? new NeonFinanceRepository(databaseUrl, log)
    : null;
}
