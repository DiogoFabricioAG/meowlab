import { describe, expect, it, vi } from "vitest";
import {
  PrintSystemPostgresRepository,
  type PostgresReadOnlyExecutor,
} from "../src/adapters/print-system/postgres-repository";

describe("PrintSystemPostgresRepository", () => {
  it("ejecuta un SELECT dentro del executor de solo lectura", async () => {
    const executeInReadOnlyTransaction = vi.fn(async () => [
      { cliente: "Cliente A", total: 150 },
    ]);
    const repository = new PrintSystemPostgresRepository(
      { executeInReadOnlyTransaction },
      vi.fn(),
    );

    const result = await repository.executeReadOnlyQuery(
      "SELECT nombre AS cliente, SUM(pago) AS total FROM ventas GROUP BY nombre;",
    );

    expect(repository.dialect).toBe("postgres");
    expect(executeInReadOnlyTransaction).toHaveBeenCalledWith(
      "SELECT nombre AS cliente, SUM(pago) AS total FROM ventas GROUP BY nombre",
    );
    expect(result).toEqual({
      rows: [{ cliente: "Cliente A", total: 150 }],
    });
  });

  it("rechaza SQL inseguro antes de llamar PostgreSQL", async () => {
    const executor: PostgresReadOnlyExecutor = {
      executeInReadOnlyTransaction: vi.fn(async () => []),
    };
    const log = vi.fn();
    const repository = new PrintSystemPostgresRepository(executor, log);

    const result = await repository.executeReadOnlyQuery(
      "SELECT 1; DROP TABLE ventas",
    );

    expect(executor.executeInReadOnlyTransaction).not.toHaveBeenCalled();
    expect(result.error).toContain("SELECT");
    expect(log).toHaveBeenCalledWith("print_advisor_query_rejected", {
      reason: "multiple_statements_not_allowed",
    });
  });

  it("limita la respuesta a cien filas", async () => {
    const rows = Array.from({ length: 120 }, (_, index) => ({ index }));
    const repository = new PrintSystemPostgresRepository(
      { executeInReadOnlyTransaction: async () => rows },
      vi.fn(),
    );

    const result = await repository.executeReadOnlyQuery("SELECT * FROM ventas");

    expect(result.rows).toHaveLength(100);
  });
});
