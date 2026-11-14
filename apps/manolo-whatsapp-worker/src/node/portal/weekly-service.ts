import type { PortalCompanyResponse, WeeklySummary } from "../../bridge/portal-company-contracts";
import type { RoleLog } from "../../roles/contracts";

type Rows = { rows: Array<Record<string, unknown>> };
export type WeeklyPool = { query(sql: string, values?: readonly unknown[]): Promise<unknown> };
export type WeeklyCipher = { decrypt(encrypted: string): string };

const LIMA_OFFSET_MS = 5 * 3_600_000; // Peru has no daylight saving time.
const DAY_MS = 86_400_000;
const MAX_PAGES = 8; // 200 documents a week; beyond that the total is marked partial.

/** Monday 00:00 in Lima of the week containing `now`, as a UTC instant. */
export function limaWeekStart(now: Date): Date {
  const lima = new Date(now.getTime() - LIMA_OFFSET_MS);
  const sinceMonday = (lima.getUTCDay() + 6) % 7;
  const midnight = Date.UTC(lima.getUTCFullYear(), lima.getUTCMonth(), lima.getUTCDate()) - sinceMonday * DAY_MS;
  return new Date(midnight + LIMA_OFFSET_MS);
}

/** 00:00 in Lima of the day containing `now`, as a UTC instant. */
export function limaDayStart(now: Date): Date {
  const lima = new Date(now.getTime() - LIMA_OFFSET_MS);
  return new Date(Date.UTC(lima.getUTCFullYear(), lima.getUTCMonth(), lima.getUTCDate()) + LIMA_OFFSET_MS);
}

const limaDate = (instant: Date) => new Date(instant.getTime() - LIMA_OFFSET_MS).toISOString().slice(0, 10);
const cents = (value: unknown) => Math.round(Number(value ?? 0) * 100) || 0;
const money = (value: number) => (value / 100).toFixed(2);

type Document = { kind?: string; status?: string; currency?: string; total?: string; number?: string; customer?: { name?: string };
  sunat_message?: string | null; issue_date?: string };

/**
 * What the company's agents did this week (ADR-0010 follow-up, «Inicio»). Only real
 * data: FacturaYa documents, messages the team wrote to the agents, and the tenders
 * Tender Cat sent them. People are the company's active members by WhatsApp number.
 */
export class PortalWeeklyService {
  constructor(
    private readonly pool: WeeklyPool,
    private readonly cipher: WeeklyCipher,
    private readonly facturayaBaseUrl: string,
    private readonly log: RoleLog,
    private readonly now: () => Date = () => new Date(),
    // Wrapped: a stored `fetch` called as a method can lose its binding.
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  private async query(sql: string, values: readonly unknown[]): Promise<Rows> {
    return await this.pool.query(sql, values) as Rows;
  }

  async handle(portalUserId: string, tenantId: string): Promise<PortalCompanyResponse> {
    const member = await this.query(
      `SELECT 1 FROM whatsapp.portal_company_members AS member
         JOIN whatsapp.tenants AS tenant ON tenant.id = member.tenant_id AND tenant.status = 'active'
        WHERE member.tenant_id = $1 AND member.portal_user_id = $2`,
      [tenantId, portalUserId],
    );
    if (!member.rows.length) return { status: "forbidden" };

    const now = this.now();
    const start = limaWeekStart(now);
    const end = new Date(start.getTime() + 7 * DAY_MS);
    const previous = new Date(start.getTime() - 7 * DAY_MS);
    const day = limaDayStart(now);
    const [team, tender, invoicing, sales, stock] = await Promise.all([
      this.team(tenantId, previous, start, end, day),
      this.tender(tenantId, start, end, day),
      this.invoicing(tenantId, previous, start, end, limaDate(day)),
      this.sales(tenantId, start, end, day),
      this.stock(tenantId, day),
    ]);
    const summary: WeeklySummary = {
      week: { start: limaDate(start), end: limaDate(new Date(end.getTime() - 1)) },
      today: limaDate(day),
      team,
      tender,
      invoicing,
      sales,
      stock,
    };
    return { status: "ok", weekly: summary };
  }

  private async team(tenantId: string, previous: Date, start: Date, end: Date, day: Date): Promise<WeeklySummary["team"]> {
    const { rows } = await this.query(
      `WITH people AS (
         SELECT contact.id FROM whatsapp.tenant_members AS member
           JOIN whatsapp.contacts AS contact ON contact.id = member.contact_id
          WHERE member.tenant_id = $1 AND member.status = 'active'
       )
       SELECT (SELECT count(*)::int FROM people) AS members,
              count(*) FILTER (WHERE message.created_at >= $3)::int AS messages,
              count(DISTINCT conversation.contact_id) FILTER (WHERE message.created_at >= $3)::int AS active,
              count(*) FILTER (WHERE message.created_at < $3)::int AS previous_messages,
              count(*) FILTER (WHERE message.created_at >= $5)::int AS messages_today
         FROM whatsapp.messages AS message
         JOIN whatsapp.conversations AS conversation ON conversation.id = message.conversation_id
        WHERE conversation.contact_id IN (SELECT id FROM people)
          AND message.direction = 'inbound'
          AND message.created_at >= $2 AND message.created_at < $4`,
      [tenantId, previous, start, end, day],
    );
    const row = rows[0] ?? {};
    return {
      members: Number(row.members ?? 0),
      messages: Number(row.messages ?? 0),
      activePeople: Number(row.active ?? 0),
      previousMessages: Number(row.previous_messages ?? 0),
      messagesToday: Number(row.messages_today ?? 0),
    };
  }

  private async sales(tenantId: string, start: Date, end: Date, day: Date): Promise<WeeklySummary["sales"]> {
    const off = { enabled: false, todayCount: 0, todayTotalCents: 0, weekCount: 0, weekTotalCents: 0, weekQuotes: 0 };
    try {
      const settings = await this.query(
        `SELECT enabled AND (active_until IS NULL OR active_until > CURRENT_TIMESTAMP) AS enabled
           FROM sales.settings WHERE tenant_id = $1`,
        [tenantId],
      );
      if (!settings.rows[0]?.enabled) return off;
      const [sales, quotes] = await Promise.all([
        this.query(
          `SELECT count(*) FILTER (WHERE sold_at >= $4)::int AS today_n,
                  COALESCE(sum(total_cents) FILTER (WHERE sold_at >= $4), 0)::bigint AS today_total,
                  count(*)::int AS week_n, COALESCE(sum(total_cents), 0)::bigint AS week_total
             FROM sales.sales WHERE tenant_id = $1 AND status = 'confirmed' AND sold_at >= $2 AND sold_at < $3`,
          [tenantId, start, end, day],
        ),
        this.query(
          `SELECT count(*)::int AS n FROM sales.quotes
            WHERE tenant_id = $1 AND status <> 'cancelled' AND created_at >= $2 AND created_at < $3`,
          [tenantId, start, end],
        ),
      ]);
      const row = sales.rows[0] ?? {};
      return {
        enabled: true,
        todayCount: Number(row.today_n ?? 0),
        todayTotalCents: Number(row.today_total ?? 0),
        weekCount: Number(row.week_n ?? 0),
        weekTotalCents: Number(row.week_total ?? 0),
        weekQuotes: Number(quotes.rows[0]?.n ?? 0),
      };
    } catch {
      // Before migration 014 the schema does not exist: Sales Cat is simply off.
      return off;
    }
  }

  private async stock(tenantId: string, day: Date): Promise<WeeklySummary["stock"]> {
    const off = { enabled: false, lowCount: 0, movesToday: 0 };
    try {
      const { rows } = await this.query(
        `SELECT (SELECT count(*) FROM stock.items WHERE tenant_id = $1 AND active AND min_qty IS NOT NULL AND on_hand <= min_qty)::int AS low,
                (SELECT count(*) FROM stock.moves WHERE tenant_id = $1 AND created_at >= $2)::int AS moves
           FROM stock.settings
          WHERE tenant_id = $1 AND enabled AND (active_until IS NULL OR active_until > CURRENT_TIMESTAMP)`,
        [tenantId, day],
      );
      if (!rows.length) return off;
      return { enabled: true, lowCount: Number(rows[0].low ?? 0), movesToday: Number(rows[0].moves ?? 0) };
    } catch {
      // Before migration 018 the schema does not exist: Stock Cat is simply off.
      return off;
    }
  }

  private async tender(tenantId: string, start: Date, end: Date, day: Date): Promise<WeeklySummary["tender"]> {
    const enabled = await this.query(
      `SELECT 1 FROM whatsapp.tenant_members AS member
         JOIN whatsapp.contacts AS contact ON contact.id = member.contact_id
        WHERE member.tenant_id = $1 AND member.status = 'active' AND contact.active_role_key = 'radar'
        LIMIT 1`,
      [tenantId],
    );
    const { rows } = await this.query(
      `WITH people AS (
         SELECT member.contact_id FROM whatsapp.tenant_members AS member
          WHERE member.tenant_id = $1 AND member.status = 'active'
       ), sent AS (
         SELECT DISTINCT ON (snapshot.ocid) snapshot.ocid, snapshot.candidate, snapshot.published_at, selection.state
           FROM whatsapp.radar_candidate_snapshots AS snapshot
           LEFT JOIN whatsapp.radar_current_selections AS selection
             ON selection.contact_id = snapshot.contact_id AND selection.ocid = snapshot.ocid
          WHERE snapshot.contact_id IN (SELECT contact_id FROM people)
            AND snapshot.published_at >= $2 AND snapshot.published_at < $3
          ORDER BY snapshot.ocid, selection.state = 'interesting' DESC NULLS LAST, snapshot.published_at DESC
       )
       SELECT ocid, candidate->'alert' AS alert, published_at, state FROM sent
        ORDER BY state = 'interesting' DESC NULLS LAST, published_at DESC`,
      [tenantId, start, end],
    );
    const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
    return {
      enabled: enabled.rows.length > 0,
      found: rows.length,
      foundToday: rows.filter((row) => new Date(row.published_at as string | Date).getTime() >= day.getTime()).length,
      interesting: rows.filter((row) => row.state === "interesting").length,
      highlights: rows.slice(0, 5).map((row) => {
        const alert = (row.alert ?? {}) as Record<string, unknown>;
        const url = text(alert.sourceUrl, 1000);
        return {
          description: text(alert.description, 240),
          buyer: text(alert.buyer, 160),
          deadline: text(alert.deadline, 100),
          amount: text(alert.amount, 60),
          // Only links to the public SEACE register leave the bridge.
          sourceUrl: url.startsWith("https://prod2.seace.gob.pe/") ? url : null,
          interesting: row.state === "interesting",
        };
      }),
    };
  }

  private async invoicing(tenantId: string, previous: Date, start: Date, end: Date, today: string): Promise<WeeklySummary["invoicing"]> {
    const { rows } = await this.query(
      `SELECT encrypted_token FROM whatsapp.tenant_integrations
        WHERE tenant_id = $1 AND provider = 'facturaya' AND status = 'active' LIMIT 1`,
      [tenantId],
    );
    if (!rows.length) return null;
    let token: string;
    try {
      token = this.cipher.decrypt(String(rows[0].encrypted_token));
    } catch {
      this.log("portal_weekly_token_unreadable");
      return { status: "unavailable" };
    }
    const lastDay = new Date(end.getTime() - 1);
    const [current, before] = await Promise.all([
      this.documents(token, limaDate(start), limaDate(lastDay)),
      this.documents(token, limaDate(previous), limaDate(new Date(start.getTime() - 1))),
    ]);
    if (!current || !before) return { status: "unavailable" };
    const total = (documents: Document[]) => documents
      .filter((doc) => doc.status === "accepted" && (doc.currency ?? "PEN") === "PEN")
      .reduce((sum, doc) => sum + (doc.kind === "credit_note" ? -cents(doc.total) : cents(doc.total)), 0);
    const rejected = current.documents.filter((doc) => doc.status === "rejected");
    const ofToday = current.documents.filter((doc) => doc.issue_date === today);
    return {
      status: "ok",
      documents: current.count,
      accepted: current.documents.filter((doc) => doc.status === "accepted").length,
      totalPen: money(total(current.documents)),
      previousTotalPen: money(total(before.documents)),
      partial: current.partial || before.partial,
      rejected: rejected.slice(0, 5).map((doc) => ({
        number: String(doc.number ?? ""),
        customer: String(doc.customer?.name ?? "").slice(0, 160),
        message: doc.sunat_message ? String(doc.sunat_message).slice(0, 240) : null,
      })),
      today: {
        documents: ofToday.length,
        totalPen: money(total(ofToday)),
        rejected: ofToday.filter((doc) => doc.status === "rejected").length,
      },
    };
  }

  private async documents(token: string, from: string, to: string): Promise<{ documents: Document[]; count: number; partial: boolean } | null> {
    const documents: Document[] = [];
    let count = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.facturayaBaseUrl}/api/issued-documents?from=${from}&to=${to}&page=${page}`, {
          signal: AbortSignal.timeout(15_000),
          headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
        });
      } catch {
        this.log("portal_weekly_facturaya_unreachable");
        return null;
      }
      if (!response.ok) {
        this.log("portal_weekly_facturaya_error", { status: response.status });
        return null;
      }
      const body = await response.json() as { data?: Document[]; meta?: { total?: number; last_page?: number } };
      documents.push(...(body.data ?? []));
      count = Number(body.meta?.total ?? documents.length);
      if (!body.data?.length || documents.length >= count || page >= Number(body.meta?.last_page ?? page)) {
        return { documents, count, partial: false };
      }
    }
    return { documents, count, partial: documents.length < count };
  }
}
