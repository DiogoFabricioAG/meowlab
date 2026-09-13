import type { PostgresReadOnlyExecutor } from "../../adapters/print-system/postgres-repository";

const DEFAULT_STATEMENT_TIMEOUT_MS = 8_000;

export interface ReadOnlyTransactionClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    statement: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[] }>;
  release(destroy?: boolean): void;
}

export interface ReadOnlyTransactionPool {
  connect(): Promise<ReadOnlyTransactionClient>;
  end(): Promise<void>;
}

export type PgReadOnlyExecutorOptions = {
  statementTimeoutMs?: number;
};

export class PgReadOnlyExecutor implements PostgresReadOnlyExecutor {
  private readonly statementTimeoutMs: number;

  constructor(
    private readonly pool: ReadOnlyTransactionPool,
    options: PgReadOnlyExecutorOptions = {},
  ) {
    const configuredTimeout = options.statementTimeoutMs
      ?? DEFAULT_STATEMENT_TIMEOUT_MS;
    this.statementTimeoutMs = Number.isInteger(configuredTimeout)
      ? Math.min(Math.max(configuredTimeout, 500), 30_000)
      : DEFAULT_STATEMENT_TIMEOUT_MS;
  }

  async executeInReadOnlyTransaction(
    query: string,
  ): Promise<readonly Record<string, unknown>[]> {
    const client = await this.pool.connect();
    let destroyClient = false;

    try {
      await client.query("BEGIN READ ONLY");
      await client.query("SET LOCAL search_path TO print_system, public");
      await client.query(
        "SELECT set_config('statement_timeout', $1, true)",
        [`${this.statementTimeoutMs}ms`],
      );
      const result = await client.query(query);
      await client.query("COMMIT");
      return result.rows;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        destroyClient = true;
      }
      throw error;
    } finally {
      client.release(destroyClient);
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
