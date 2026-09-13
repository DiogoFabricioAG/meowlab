export type ReadOnlyQueryResult = {
  rows: readonly Record<string, unknown>[];
  error?: string;
};

export type BusinessSqlDialect = "sqlite" | "postgres";

export interface BusinessDataRepository {
  readonly dialect?: BusinessSqlDialect;
  executeReadOnlyQuery(query: string): Promise<ReadOnlyQueryResult>;
}
