import { describe, expect, it, vi } from "vitest";
import {
  PgReadOnlyExecutor,
  type ReadOnlyTransactionPool,
} from "../src/node/postgres/transactional-read-only-executor";
import { advisorConnectionString } from "../src/node/postgres/advisor-connection";

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

describe("advisorConnectionString", () => {
  const platformUrl = "postgresql://manolo_app:owner-secret@postgres:5432/manolo_platform?sslmode=disable";

  it("conserva servidor y base, y cambia solo las credenciales", () => {
    const url = new URL(advisorConnectionString(platformUrl, "manolo_advisor_ro", "a1b2c3"));

    expect(url.username).toBe("manolo_advisor_ro");
    expect(url.password).toBe("a1b2c3");
    expect(`${url.host}${url.pathname}${url.search}`).toBe("postgres:5432/manolo_platform?sslmode=disable");
    expect(url.toString()).not.toContain("owner-secret");
  });

  it("codifica caracteres especiales de la clave", () => {
    const url = new URL(advisorConnectionString(platformUrl, "manolo_advisor_ro", "p@ss:w/rd"));

    expect(decodeURIComponent(url.password)).toBe("p@ss:w/rd");
  });

  it("rechaza reutilizar el rol de la plataforma o una clave vacía", () => {
    expect(() => advisorConnectionString(platformUrl, "manolo_app", "x")).toThrow(/own PostgreSQL role/);
    expect(() => advisorConnectionString(platformUrl, "manolo_advisor_ro", "")).toThrow(/own PostgreSQL role/);
    expect(() => advisorConnectionString(platformUrl, "", "x")).toThrow(/own PostgreSQL role/);
  });
});
