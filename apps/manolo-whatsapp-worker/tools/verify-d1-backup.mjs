import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { DatabaseSync } from "node:sqlite";

const backupPaths = process.argv.slice(2);

if (backupPaths.length === 0) {
  console.error("Uso: node tools/verify-d1-backup.mjs <respaldo.sql> [...]");
  process.exitCode = 1;
} else {
  for (const backupPath of backupPaths) {
    const bytes = await readFile(backupPath);
    const database = new DatabaseSync(":memory:");

    try {
      // D1 can export a table before another table referenced by its foreign key.
      // Load the dump without enforcing creation order, then validate every
      // relationship once the complete schema and data exist.
      database.exec("PRAGMA foreign_keys = OFF");
      database.exec(bytes.toString("utf8"));
      const foreignKeyErrors = database.prepare("PRAGMA foreign_key_check").all();
      if (foreignKeyErrors.length > 0) {
        throw new Error(`foreign_key_check encontró ${foreignKeyErrors.length} errores`);
      }

      database.exec("PRAGMA foreign_keys = ON");
      const integrity = database.prepare("PRAGMA integrity_check").get();
      if (integrity.integrity_check !== "ok") {
        throw new Error(`integrity_check devolvió: ${integrity.integrity_check}`);
      }

      const tables = database
        .prepare(
          `SELECT name
           FROM sqlite_master
           WHERE type = 'table'
             AND name NOT LIKE 'sqlite_%'
           ORDER BY name`,
        )
        .all()
        .map((row) => row.name);

      const rows = Object.fromEntries(
        tables.map((table) => {
          const safeTable = table.replaceAll('"', '""');
          const result = database.prepare(`SELECT COUNT(*) AS count FROM "${safeTable}"`).get();
          return [table, Number(result.count)];
        }),
      );

      console.log(
        JSON.stringify({
          file: basename(backupPath),
          bytes: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          integrity: "ok",
          rows,
        }),
      );
    } finally {
      database.close();
    }
  }
}
