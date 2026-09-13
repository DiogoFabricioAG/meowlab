import { Pool, type PoolConfig } from "pg";
import { PrintSystemPostgresRepository } from "../../adapters/print-system/postgres-repository";
import type { RoleLog } from "../../roles/contracts";
import { PgReadOnlyExecutor } from "./transactional-read-only-executor";

export type PrintPostgresConnection = {
  repository: PrintSystemPostgresRepository;
  pool: Pool;
  close: () => Promise<void>;
};

export function createPrintPostgresConnection(
  databaseUrl: string | undefined,
  log: RoleLog,
): PrintPostgresConnection | null {
  const connectionString = databaseUrl?.trim();
  if (!connectionString) return null;

  const poolConfig: PoolConfig = {
    connectionString,
    application_name: "manolo-print-advisor",
    // The business tables live in print_system. Set this at connection level
    // so every model-generated read uses the intended tenant schema without
    // requiring the role to know infrastructure details.
    options: "-c search_path=print_system,public",
    max: 4,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    maxLifetimeSeconds: 300,
  };
  const pool = new Pool(poolConfig);
  pool.on("error", () => {
    log("print_advisor_postgres_pool_error", { reason: "idle_client_error" });
  });

  const executor = new PgReadOnlyExecutor(pool);
  return {
    repository: new PrintSystemPostgresRepository(executor, log),
    pool,
    close: () => executor.close(),
  };
}
