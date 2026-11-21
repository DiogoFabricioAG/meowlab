import { describe, expect, it, vi } from "vitest";
import { PortalWeeklyService, limaWeekStart } from "../src/node/portal/weekly-service";
import { isPortalCompanyRequest } from "../src/bridge/portal-company-contracts";

describe("Lima week", () => {
  it("starts on Monday 00:00 Lima (05:00 UTC)", () => {
    // Thursday 13/11/2026 04:00 UTC is still Wednesday night in Lima.
    expect(limaWeekStart(new Date("2026-11-13T04:00:00Z")).toISOString()).toBe("2026-11-09T05:00:00.000Z");
    // Sunday 23:59 Lima belongs to the same week; Monday 00:00 Lima starts the next.
    expect(limaWeekStart(new Date("2026-11-16T04:59:00Z")).toISOString()).toBe("2026-11-09T05:00:00.000Z");
    expect(limaWeekStart(new Date("2026-11-16T05:00:00Z")).toISOString()).toBe("2026-11-16T05:00:00.000Z");
  });
});

function setup(options: { member?: boolean; integration?: boolean; facturaya?: "ok" | "down" } = {}) {
  const pool = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("active_role_key = 'radar'")) return { rows: [{ "?column?": 1 }] };
      if (sql.includes("sales.settings")) return { rows: [{ enabled: true }] };
      if (sql.includes("FROM sales.sales")) return { rows: [{ today_n: 2, today_total: 5000, week_n: 5, week_total: 12500 }] };
      if (sql.includes("FROM sales.quotes")) return { rows: [{ n: 3 }] };
      if (sql.includes("portal_company_members")) return { rows: options.member === false ? [] : [{ "?column?": 1 }] };
      if (sql.includes("tenant_integrations")) return { rows: options.integration === false ? [] : [{ encrypted_token: "enc" }] };
      if (sql.includes("whatsapp.messages")) return { rows: [{ members: 2, messages: 9, active: 2, previous_messages: 4, messages_today: 3 }] };
      if (sql.includes("radar_candidate_snapshots")) {
        return { rows: [
          { ocid: "a", state: "interesting", published_at: "2026-11-13T02:00:00Z", alert: { description: "Impresión de afiches", buyer: "Municipalidad", deadline: "20/11/2026",
            amount: "S/ 12,000", sourceUrl: "https://prod2.seace.gob.pe/x" } },
          { ocid: "b", state: null, published_at: "2026-11-10T15:00:00Z", alert: { description: "Otra", buyer: "B", deadline: "x", amount: "y", sourceUrl: "https://evil.example/" } },
        ] };
      }
      return { rows: [] };
    }),
  };
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (options.facturaya === "down") return new Response(null, { status: 500 });
    const thisWeek = url.includes("from=2026-11-09");
    const data = thisWeek
      ? [
        { kind: "invoice", status: "accepted", currency: "PEN", total: "118.00", number: "F001-1", issue_date: "2026-11-12" },
        { kind: "invoice", status: "accepted", currency: "PEN", total: "59.50", number: "B001-1" },
        { kind: "credit_note", status: "accepted", currency: "PEN", total: "18.00", number: "FC01-1" },
        { kind: "invoice", status: "rejected", currency: "PEN", total: "40.00", number: "F001-2", customer: { name: "Comercial Lima" },
          sunat_message: "RUC no activo", issue_date: "2026-11-12" },
      ]
      : [{ kind: "invoice", status: "accepted", currency: "PEN", total: "100.00" }];
    return Response.json({ data, meta: { total: data.length } });
  });
  const service = new PortalWeeklyService(pool, { decrypt: () => "plain" }, "https://f.example", vi.fn(),
    () => new Date("2026-11-13T04:00:00Z"), fetchImpl as unknown as typeof fetch);
  return { service, urls };
}

describe("portal weekly summary", () => {
  it("is only for members of the company", async () => {
    expect(await setup({ member: false }).service.handle("u", "org_1")).toEqual({ status: "forbidden" });
    expect(isPortalCompanyRequest({ version: 1, requestId: "r", portalUserId: "u", action: "weekly", tenantId: "org_1" })).toBe(true);
  });

  it("sums accepted PEN sales minus credit notes and lists rejections", async () => {
    const { service, urls } = setup();
    const result = await service.handle("u", "org_1") as { weekly: Record<string, any> };
    expect(result.weekly.week).toEqual({ start: "2026-11-09", end: "2026-11-15" });
    expect(result.weekly.invoicing).toEqual({ status: "ok", documents: 4, accepted: 3, totalPen: "159.50", previousTotalPen: "100.00",
      partial: false, rejected: [{ number: "F001-2", customer: "Comercial Lima", message: "RUC no activo" }],
      today: { documents: 2, totalPen: "118.00", rejected: 1 } });
    expect(result.weekly.today).toBe("2026-11-12");
    expect(urls).toContain("https://f.example/api/issued-documents?from=2026-11-09&to=2026-11-15&page=1");
    expect(urls).toContain("https://f.example/api/issued-documents?from=2026-11-02&to=2026-11-08&page=1");
    expect(result.weekly.team).toEqual({ members: 2, messages: 9, activePeople: 2, previousMessages: 4, messagesToday: 3 });
    expect(result.weekly.sales).toEqual({ enabled: true, todayCount: 2, todayTotalCents: 5000, weekCount: 5, weekTotalCents: 12500, weekQuotes: 3 });
  });

  it("keeps only SEACE links and counts interesting tenders", async () => {
    const result = await setup().service.handle("u", "org_1") as { weekly: Record<string, any> };
    expect(result.weekly.tender.found).toBe(2);
    expect(result.weekly.tender.enabled).toBe(true);
    // 13/11 02:00 UTC is still 12/11 in Lima: today; 10/11 is not.
    expect(result.weekly.tender.foundToday).toBe(1);
    expect(result.weekly.tender.interesting).toBe(1);
    expect(result.weekly.tender.highlights[0].sourceUrl).toBe("https://prod2.seace.gob.pe/x");
    expect(result.weekly.tender.highlights[1].sourceUrl).toBeNull();
  });

  it("has no invoicing without Invoice Cat and reports FacturaYa outages", async () => {
    expect(((await setup({ integration: false }).service.handle("u", "o")) as { weekly: Record<string, any> }).weekly.invoicing).toBeNull();
    expect(((await setup({ facturaya: "down" }).service.handle("u", "o")) as { weekly: Record<string, any> }).weekly.invoicing)
      .toEqual({ status: "unavailable" });
  });
});

describe("portal weekly summary: who talked to each cat (council report)", () => {
  function serviceWith(people: (sql: string, values?: readonly unknown[]) => { rows: Array<Record<string, unknown>> }) {
    const pool = {
      query: vi.fn(async (sql: string, values?: readonly unknown[]) => {
        if (sql.includes("portal_company_members")) return { rows: [{ "?column?": 1 }] };
        if (sql.includes("council-people")) return people(sql, values);
        return { rows: [] };
      }),
    };
    const log = vi.fn();
    const service = new PortalWeeklyService(pool, { decrypt: () => "plain" }, "https://f.example", log,
      () => new Date("2026-11-21T15:00:00Z"), (async () => Response.json({ data: [], meta: { total: 0 } })) as unknown as typeof fetch);
    return { service, pool, log };
  }

  it("counts people and requests per cat over the last 30 Lima days, with Support Cat's customers", async () => {
    const { service, pool } = serviceWith(() => ({ rows: [
      { agent: "invoice", team: 2, actions: 14, customers: 0 },
      { agent: "sales", team: 1, actions: 5, customers: 0 },
      { agent: "support", team: 1, actions: 3, customers: 7 },
    ] }));
    const result = await service.handle("u", "org_1");
    if (result.status !== "ok" || !("weekly" in result)) throw new Error("expected weekly");
    expect(result.weekly.people).toEqual({ days: 30, agents: [
      { agent: "invoice", team: 2, actions: 14 },
      { agent: "tender", team: 0, actions: 0 },
      { agent: "sales", team: 1, actions: 5 },
      { agent: "stock", team: 0, actions: 0 },
      { agent: "reorder", team: 0, actions: 0 },
      { agent: "support", team: 1, actions: 3, customers: 7 },
      { agent: "collections", team: 0, actions: 0 },
    ] });
    const call = pool.query.mock.calls.find(([sql]) => String(sql).includes("council-people"))!;
    // 21/11 10:00 Lima → since 23/10 00:00 Lima (29 days before today's midnight).
    expect(call[1]).toEqual(["org_1", new Date("2026-10-23T05:00:00.000Z")]);
    // Every source is filtered by the company.
    expect((String(call[0]).match(/tenant_id = \$1/g) ?? []).length).toBe(9);
  });

  it("leaves the report out, without failing the summary, when the query fails", async () => {
    const { service, log } = serviceWith(() => { throw new Error("relation does not exist"); });
    const result = await service.handle("u", "org_1");
    if (result.status !== "ok" || !("weekly" in result)) throw new Error("expected weekly");
    expect(result.weekly.people).toBeUndefined();
    expect(log).toHaveBeenCalledWith("vps_portal_weekly_people_failed", {});
  });
});
