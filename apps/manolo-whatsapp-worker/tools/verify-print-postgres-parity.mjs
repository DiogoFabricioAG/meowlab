import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import pg from "pg";

const { Client } = pg;
const sourceIndex = process.argv.indexOf("--source");
const sourcePath = sourceIndex >= 0 ? process.argv[sourceIndex + 1] : undefined;
const databaseUrl = process.env.PRINT_POSTGRES_URL?.trim();

if (!sourcePath || !databaseUrl) {
  console.error(
    "Uso: define PRINT_POSTGRES_URL y ejecuta node tools/verify-print-postgres-parity.mjs --source <gamarra_db.sql>",
  );
  process.exitCode = 1;
} else {
  const tables = [
    "clientes",
    "ventas",
    "pagos",
    "compras",
    "activos_fijos",
    "usuarios",
    "variables_negocio",
  ];
  const checks = [
    ...tables.map((table) => ({
      name: `${table}_count`,
      query: `SELECT COUNT(*) AS total FROM ${table}`,
    })),
    {
      name: "ventas_summary",
      query:
        "SELECT COUNT(*) AS operaciones, COALESCE(SUM(pago), 0) AS monto, "
        + "COUNT(DISTINCT cliente_id) AS clientes FROM ventas",
    },
    {
      name: "pagos_summary",
      query:
        "SELECT COUNT(*) AS operaciones, COALESCE(SUM(pago), 0) AS monto, "
        + "COUNT(DISTINCT cliente_id) AS clientes FROM pagos",
    },
    {
      name: "compras_summary",
      query:
        "SELECT COUNT(*) AS operaciones, COALESCE(SUM(monto), 0) AS monto "
        + "FROM compras",
    },
  ];

  const sqlite = new DatabaseSync(":memory:");
  const postgres = new Client({ connectionString: databaseUrl });

  function normalizeRow(row) {
    const normalizeNumber = (value) =>
      Number.isInteger(value) ? value : Math.round(value * 1_000_000) / 1_000_000;
    return Object.fromEntries(
      Object.entries(row).map(([key, value]) => {
        if (typeof value === "number") return [key, normalizeNumber(value)];
        if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value)) {
          return [key, normalizeNumber(Number(value))];
        }
        return [key, value];
      }),
    );
  }

  try {
    sqlite.exec("PRAGMA foreign_keys = OFF");
    sqlite.exec(await readFile(sourcePath, "utf8"));
    await postgres.connect();
    await postgres.query("BEGIN READ ONLY");
    await postgres.query("SET LOCAL search_path TO print_system, public");

    for (const check of checks) {
      const sqliteRow = normalizeRow(sqlite.prepare(check.query).get());
      const postgresResult = await postgres.query(check.query);
      const postgresRow = normalizeRow(postgresResult.rows[0] ?? {});
      if (JSON.stringify(sqliteRow) !== JSON.stringify(postgresRow)) {
        throw new Error(`La verificación ${check.name} no coincide`);
      }
    }

    await postgres.query("COMMIT");
    console.log(JSON.stringify({ parity: "ok", checks: checks.map(({ name }) => name) }));
  } catch (error) {
    try {
      await postgres.query("ROLLBACK");
    } catch {
      // The connection might not have reached PostgreSQL.
    }
    throw error;
  } finally {
    sqlite.close();
    await postgres.end().catch(() => undefined);
  }
}
