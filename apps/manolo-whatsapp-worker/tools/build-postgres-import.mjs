import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const profiles = {
  whatsapp: {
    schema: "whatsapp",
    tables: [
      "tenants",
      "whatsapp_numbers",
      "bot_configs",
      "contacts",
      "conversations",
      "messages",
      "quote_configs",
      "quote_sequence_scopes",
      "quote_drafts",
      "quote_items",
      "quote_sequence_members",
      "contact_role_states",
      "store_payment_notifications",
    ],
    booleanColumns: new Set([
      "whatsapp_numbers.active",
      "quote_configs.prices_include_tax",
    ]),
    identityTables: ["contacts", "messages", "quote_items"],
  },
  "print-system": {
    schema: "print_system",
    tables: [
      "clientes",
      "ventas",
      "pagos",
      "compras",
      "activos_fijos",
      "usuarios",
      "variables_negocio",
    ],
    booleanColumns: new Set(),
    identityTables: [
      "clientes",
      "ventas",
      "pagos",
      "compras",
      "activos_fijos",
      "usuarios",
      "variables_negocio",
    ],
  },
};

function readArguments(argumentsList) {
  const values = {};
  for (let index = 0; index < argumentsList.length; index += 1) {
    const name = argumentsList[index];
    if (!name.startsWith("--")) continue;
    values[name.slice(2)] = argumentsList[index + 1];
    index += 1;
  }
  return values;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function quoteLiteral(value, isBoolean) {
  if (value === null || value === undefined) return "NULL";
  if (isBoolean) return Number(value) === 1 ? "TRUE" : "FALSE";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("El respaldo contiene un número no finito");
    return String(value);
  }
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) {
    return `decode('${Buffer.from(value).toString("hex")}', 'hex')`;
  }
  const text = String(value).replaceAll("\u0000", "");
  return `'${text.replaceAll("'", "''")}'`;
}

function tableExists(database, table) {
  const row = database
    .prepare(
      `SELECT 1 AS found
       FROM sqlite_master
       WHERE type = 'table' AND name = ?
       LIMIT 1`,
    )
    .get(table);
  return row?.found === 1;
}

function buildTableStatements(database, profile, table, options = {}) {
  if (!tableExists(database, table)) {
    throw new Error(`No existe la tabla requerida ${table}`);
  }
  const safeTable = quoteIdentifier(table);
  const rows = database.prepare(`SELECT * FROM ${safeTable} ORDER BY rowid`).all();
  const statements = [];

  for (const row of rows) {
    const columns = Object.keys(row).filter((column) =>
      !(options.reconcile && profile.schema === "whatsapp"
        && table === "messages" && column === "id"),
    );
    const values = columns.map((column) =>
      quoteLiteral(
        row[column],
        profile.booleanColumns.has(`${table}.${column}`),
      ),
    );
    statements.push(
      `INSERT INTO ${safeTable} (${columns.map(quoteIdentifier).join(", ")})\n`
      + `VALUES (${values.join(", ")})\n`
      + "ON CONFLICT DO NOTHING;",
    );
  }

  return { statements, rowCount: rows.length };
}

const args = readArguments(process.argv.slice(2));
const profile = profiles[args.profile];
const reconcile = args.reconcile === "true";
if (!profile || !args.source || !args.target) {
  console.error(
    "Uso: node tools/build-postgres-import.mjs "
      + "--profile <whatsapp|print-system> --source <respaldo-d1.sql> "
      + "--target <salida.sql> [--reconcile true]",
  );
  process.exitCode = 1;
} else {
  const sourcePath = resolve(args.source);
  const targetPath = resolve(args.target);
  if (sourcePath === targetPath) {
    throw new Error("El archivo de salida no puede sobrescribir el respaldo D1");
  }

  const sourceBytes = await readFile(sourcePath);
  const database = new DatabaseSync(":memory:");
  const counts = {};

  try {
    database.exec("PRAGMA foreign_keys = OFF");
    database.exec(sourceBytes.toString("utf8"));

    const foreignKeyErrors = database.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyErrors.length > 0) {
      throw new Error(
        `El respaldo D1 contiene ${foreignKeyErrors.length} relaciones inválidas`,
      );
    }

    const body = [
      "-- Generado desde un respaldo D1 verificado.",
      "-- Contiene datos sensibles: no agregar al repositorio.",
      "\\set ON_ERROR_STOP on",
      "BEGIN;",
      `SET LOCAL search_path TO ${quoteIdentifier(profile.schema)}, public;`,
    ];

    for (const table of profile.tables) {
      const result = buildTableStatements(database, profile, table, { reconcile });
      counts[table] = result.rowCount;
      body.push("", `-- ${table}: ${result.rowCount} filas`, ...result.statements);
    }

    for (const table of profile.identityTables) {
      const safeTable = quoteIdentifier(table);
      body.push(
        "",
        `SELECT setval(`,
        `  pg_get_serial_sequence('${profile.schema}.${table}', 'id'),`,
        `  COALESCE((SELECT MAX(id) FROM ${safeTable}), 1),`,
        `  EXISTS (SELECT 1 FROM ${safeTable})`,
        `);`,
      );
    }

    body.push("", "COMMIT;", "");
    const output = body.join("\n");
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, output, { encoding: "utf8", mode: 0o600 });

    console.log(
      JSON.stringify({
        profile: args.profile,
        sourceSha256: createHash("sha256").update(sourceBytes).digest("hex"),
        outputSha256: createHash("sha256").update(output).digest("hex"),
        outputBytes: Buffer.byteLength(output),
        counts,
      }),
    );
  } finally {
    database.close();
  }
}
