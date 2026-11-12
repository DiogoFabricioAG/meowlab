/** Business metrics of the portal for MeowLab administrators (aggregates only, no personal data). */
export type AdminMetrics = {
  generatedAt: string;
  timeZone: string;
  accounts: {
    total: number;
    newLast7Days: number;
    newLast30Days: number;
    withGoogle: number;
    withPassword: number;
    activeLast7Days: number;
  };
  /** Sign-ups per local day, oldest first, 30 entries including days with zero. */
  signupsByDay: Array<{ day: string; count: number }>;
  /** Null until WhatsApp linking is live in the bridge (phase 2 deployment). */
  whatsappLinked: number | null;
  /** Null where billing is not configured. Amounts in céntimos, IGV included. */
  billing: {
    live: number;
    paying: number;
    monthlyRevenueCents: number;
    paymentsLast30Days: number;
    revenueLast30DaysCents: number;
  } | null;
};

export type AdminMetricsSource = () => Promise<AdminMetrics>;

type Query = (sql: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;

const TIME_ZONE = "America/Lima";

export function postgresAdminMetrics(query: Query, billing?: () => Promise<AdminMetrics["billing"]>): AdminMetricsSource {
  return async () => {
    const [counts, providers, active, days] = await Promise.all([
      query(`SELECT count(*)::int AS total,
                    count(*) FILTER (WHERE "createdAt" >= now() - interval '7 days')::int AS new7,
                    count(*) FILTER (WHERE "createdAt" >= now() - interval '30 days')::int AS new30
               FROM "user"`),
      query(`SELECT "providerId" AS provider, count(DISTINCT "userId")::int AS users FROM account GROUP BY 1`),
      query(`SELECT count(DISTINCT "userId")::int AS users FROM session WHERE "updatedAt" >= now() - interval '7 days'`),
      query(
        `SELECT to_char(day, 'YYYY-MM-DD') AS day, count(u.id)::int AS count
           FROM generate_series((now() AT TIME ZONE $1)::date - 29, (now() AT TIME ZONE $1)::date, interval '1 day') AS day
           LEFT JOIN "user" u ON (u."createdAt" AT TIME ZONE $1)::date = day::date
          GROUP BY day ORDER BY day`,
        [TIME_ZONE],
      ),
    ]);
    const byProvider = new Map(providers.rows.map((row) => [String(row.provider), Number(row.users)]));
    const row = counts.rows[0] ?? {};
    return {
      generatedAt: new Date().toISOString(),
      timeZone: TIME_ZONE,
      accounts: {
        total: Number(row.total ?? 0),
        newLast7Days: Number(row.new7 ?? 0),
        newLast30Days: Number(row.new30 ?? 0),
        withGoogle: byProvider.get("google") ?? 0,
        withPassword: byProvider.get("credential") ?? 0,
        activeLast7Days: Number(active.rows[0]?.users ?? 0),
      },
      signupsByDay: days.rows.map((day) => ({ day: String(day.day), count: Number(day.count) })),
      whatsappLinked: null,
      billing: billing ? await billing() : null,
    };
  };
}
