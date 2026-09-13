import type {
  BusinessDataRepository,
  ReadOnlyQueryResult,
} from "../../business/contracts";
import { validateReadOnlySelect } from "../../business/read-only-query";
import type { RoleLog } from "../../roles/contracts";

const MAX_RESULT_ROWS = 100;

export interface PostgresReadOnlyExecutor {
  executeInReadOnlyTransaction(
    query: string,
  ): Promise<readonly Record<string, unknown>[]>;
}

export class PrintSystemPostgresRepository implements BusinessDataRepository {
  readonly dialect = "postgres" as const;

  constructor(
    private readonly executor: PostgresReadOnlyExecutor | null | undefined,
    private readonly log: RoleLog,
  ) {}

  async executeReadOnlyQuery(query: string): Promise<ReadOnlyQueryResult> {
    const validation = validateReadOnlySelect(query);
    if (!validation.valid) {
      this.log("print_advisor_query_rejected", { reason: validation.reason });
      return {
        rows: [],
        error: "Solo se permiten consultas SELECT de lectura.",
      };
    }

    if (!this.executor) {
      this.log("print_advisor_query_failed", {
        reason: "missing_postgres_connection",
      });
      return { rows: [], error: "La base de datos del negocio no está conectada." };
    }

    try {
      const rows = await this.executor.executeInReadOnlyTransaction(
        validation.query,
      );
      return { rows: rows.slice(0, MAX_RESULT_ROWS) };
    } catch {
      this.log("print_advisor_query_failed", {
        reason: "postgres_database_error",
      });
      return { rows: [], error: "No pude consultar los datos del negocio." };
    }
  }
}
