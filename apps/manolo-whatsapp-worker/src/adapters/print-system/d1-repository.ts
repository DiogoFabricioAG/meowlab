import type {
  BusinessDataRepository,
  ReadOnlyQueryResult,
} from "../../business/contracts";
import { validateReadOnlySelect } from "../../business/read-only-query";

const MAX_RESULT_ROWS = 100;
export { validateReadOnlySelect } from "../../business/read-only-query";

export class PrintSystemD1Repository implements BusinessDataRepository {
  readonly dialect = "sqlite" as const;

  constructor(
    private readonly database: D1Database | null | undefined,
    private readonly log: (
      event: string,
      details?: Record<string, unknown>,
    ) => void,
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

    if (!this.database) {
      this.log("print_advisor_query_failed", {
        reason: "missing_database_binding",
      });
      return { rows: [], error: "La base de datos del negocio no está conectada." };
    }

    try {
      const result = await this.database
        .prepare(validation.query)
        .all<Record<string, unknown>>();
      return { rows: (result.results ?? []).slice(0, MAX_RESULT_ROWS) };
    } catch {
      this.log("print_advisor_query_failed", { reason: "database_error" });
      return { rows: [], error: "No pude consultar los datos del negocio." };
    }
  }
}
