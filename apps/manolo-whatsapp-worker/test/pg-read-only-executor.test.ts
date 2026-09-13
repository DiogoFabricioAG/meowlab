import { describe, expect, it, vi } from "vitest";
import {
  PgReadOnlyExecutor,
  type ReadOnlyTransactionPool,
} from "../src/node/postgres/transactional-read-only-executor";

describe("PgReadOnlyExecutor", () => {
  it("usa un solo cliente, transacción de lectura y timeout", async () => {
    const release = vi.fn();
    const query = vi.fn(async (statement: string, _values?: readonly unknown[]) => {
      if (statement === "SELECT nombre FROM clientes") {
        return { rows: [{ nombre: "Cliente A" }] };
      }
      return { rows: [] };
    });
    const pool = {
      connect: vi.fn(async () => ({ query, release })),
      end: vi.fn(async () => undefined),
    } as unknown as ReadOnlyTransactionPool;
    const executor = new PgReadOnlyExecutor(pool, {
      statementTimeoutMs: 2_500,
    });

    const rows = await executor.executeInReadOnlyTransaction(
      "SELECT nombre FROM clientes",
    );

    expect(rows).toEqual([{ nombre: "Cliente A" }]);
    expect(query.mock.calls.map(([statement]) => statement)).toEqual([
      "BEGIN READ ONLY",
      "SET LOCAL search_path TO print_system, public",
      "SELECT set_config('statement_timeout', $1, true)",
      "SELECT nombre FROM clientes",
      "COMMIT",
    ]);
    expect(query.mock.calls[2]?.[1]).toEqual(["2500ms"]);
    expect(release).toHaveBeenCalledWith(false);
  });

  it("hace rollback y libera el cliente cuando falla la consulta", async () => {
    const release = vi.fn();
    const query = vi.fn(async (statement: string, _values?: readonly unknown[]) => {
      if (statement === "SELECT broken") throw new Error("query failed");
      return { rows: [] };
    });
    const pool = {
      connect: vi.fn(async () => ({ query, release })),
      end: vi.fn(async () => undefined),
    } as unknown as ReadOnlyTransactionPool;
    const executor = new PgReadOnlyExecutor(pool);

    await expect(
      executor.executeInReadOnlyTransaction("SELECT broken"),
    ).rejects.toThrow("query failed");

    expect(query).toHaveBeenCalledWith("ROLLBACK");
    expect(release).toHaveBeenCalledWith(false);
  });
});
