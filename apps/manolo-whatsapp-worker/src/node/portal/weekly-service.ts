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

const limaDate = (instant: Date) => new Date(instant.getTime() - LIMA_OFFSET_MS).toISOString().slice(0, 10);
const cents = (value: unknown) => Math.round(Number(value ?? 0) * 100) || 0;
const money = (value: number) => (value / 100).toFixed(2);

type Document = { kind?: string; status?: string; currency?: string; total?: string; number?: string; customer?: { name?: string };
  sunat_message?: string | null };

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

    const start = limaWeekStart(this.now());
    const end = new Date(start.getTime() + 7 * DAY_MS);
    const previous = new Date(start.getTime() - 7 * DAY_MS);
    const [team, tender, invoicing] = await Promise.all([
      this.team(tenantId, previous, start, end),
      this.tender(tenantId, start, end),
      this.invoicing(tenantId, previous, start, end),
    ]);
    const summary: WeeklySummary = {
      week: { start: limaDate(start), end: limaDate(new Date(end.getTime() - 1)) },
      team,
      tender,
      invoicing,
    };
    return { status: "ok", weekly: summary };
  }

  private async team(tenantId: string, previous: Date, start: Date, end: Date): Promise<WeeklySummary["team"]> {
    const { rows } = await this.query(
      `WITH people AS (
         SELECT contact.id FROM whatsapp.tenant_members AS member
           JOIN whatsapp.contacts AS contact ON contact.id = member.contact_id
          WHERE member.tenant_id = $1 AND member.status = 'active'
       )
       SELECT (SELECT count(*)::int FROM people) AS members,
              count(*) FILTER (WHERE message.created_at >= $3)::int AS messages,
              count(DISTINCT conversation.contact_id) FILTER (WHERE message.created_at >= $3)::int AS active,
              count(*) FILTER (WHERE message.created_at < $3)::int AS previous_messages
         FROM whatsapp.messages AS message
         JOIN whatsapp.conversations AS conversation ON conversation.id = message.conversation_id
        WHERE conversation.contact_id IN (SELECT id FROM people)
          AND message.direction = 'inbound'
          AND message.created_at >= $2 AND message.created_at < $4`,
      [tenantId, previous, start, end],
    );
    const row = rows[0] ?? {};
    return {
      members: Number(row.members ?? 0),
      messages: Number(row.messages ?? 0),
      activePeople: Number(row.active ?? 0),
      previousMessages: Number(row.previous_messages ?? 0),
    };
  }

  private async tender(tenantId: string, start: Date, end: Date): Promise<WeeklySummary["tender"]> {
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
      found: rows.length,
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

  private async invoicing(tenantId: string, previous: Date, start: Date, end: Date): Promise<WeeklySummary["invoicing"]> {
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
