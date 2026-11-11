// Prints the SQL Better Auth needs for the portal options, against an empty SQLite
// database (same dialect as D1). Used to write migrations/0001_better_auth.sql.
// Usage: node --experimental-strip-types scripts/auth-schema.mjs
import { DatabaseSync } from "node:sqlite";
import { getMigrations } from "better-auth/db/migration";
import { authOptions } from "../server/auth.ts";

const options = authOptions(new DatabaseSync(":memory:"), {
  BETTER_AUTH_SECRET: "schema-only-secret-not-used-at-runtime",
  BETTER_AUTH_URL: "http://localhost",
  GOOGLE_CLIENT_ID: "schema",
  GOOGLE_CLIENT_SECRET: "schema",
});
const { compileMigrations } = await getMigrations(options);
process.stdout.write(await compileMigrations());
