// Prints the SQL Better Auth needs for the portal options against an empty database.
//   SQLite / D1 (migrations/):            node --experimental-strip-types scripts/auth-schema.mjs
//   PostgreSQL / VPS (migrations-postgres/): ... scripts/auth-schema.mjs postgres://user@host/emptydb
import { DatabaseSync } from "node:sqlite";
import pg from "pg";
import { getMigrations } from "better-auth/db/migration";
import { authOptions } from "../server/auth.ts";

const postgresUrl = process.argv[2];
const database = postgresUrl ? new pg.Pool({ connectionString: postgresUrl }) : new DatabaseSync(":memory:");
const options = authOptions(database, {
  BETTER_AUTH_SECRET: "schema-only-secret-not-used-at-runtime",
  BETTER_AUTH_URL: "http://localhost",
  GOOGLE_CLIENT_ID: "schema",
  GOOGLE_CLIENT_SECRET: "schema",
});
const { compileMigrations } = await getMigrations(options);
process.stdout.write(await compileMigrations());
if (postgresUrl) await database.end();
