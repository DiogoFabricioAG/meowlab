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
      if (sql.includes("portal_company_members")) return { rows: options.member === false ? [] : [{ "?column?": 1 }] };
      if (sql.includes("tenant_integrations")) return { rows: options.integration === false ? [] : [{ encrypted_token: "enc" }] };
      if (sql.includes("whatsapp.messages")) return { rows: [{ members: 2, messages: 9, active: 2, previous_messages: 4 }] };
      if (sql.includes("radar_candidate_snapshots")) {
        return { rows: [
          { ocid: "a", state: "interesting", alert: { description: "Impresión de afiches", buyer: "Municipalidad", deadline: "20/11/2026",
            amount: "S/ 12,000", sourceUrl: "https://prod2.seace.gob.pe/x" } },
          { ocid: "b", state: null, alert: { description: "Otra", buyer: "B", deadline: "x", amount: "y", sourceUrl: "https://evil.example/" } },
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
        { kind: "invoice", status: "accepted", currency: "PEN", total: "118.00", number: "F001-1" },
        { kind: "invoice", status: "accepted", currency: "PEN", total: "59.50", number: "B001-1" },
        { kind: "credit_note", status: "accepted", currency: "PEN", total: "18.00", number: "FC01-1" },
        { kind: "invoice", status: "rejected", currency: "PEN", total: "40.00", number: "F001-2", customer: { name: "Comercial Lima" },
          sunat_message: "RUC no activo" },
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
      partial: false, rejected: [{ number: "F001-2", customer: "Comercial Lima", message: "RUC no activo" }] });
    expect(urls).toContain("https://f.example/api/issued-documents?from=2026-11-09&to=2026-11-15&page=1");
    expect(urls).toContain("https://f.example/api/issued-documents?from=2026-11-02&to=2026-11-08&page=1");
    expect(result.weekly.team).toEqual({ members: 2, messages: 9, activePeople: 2, previousMessages: 4 });
  });

  it("keeps only SEACE links and counts interesting tenders", async () => {
    const result = await setup().service.handle("u", "org_1") as { weekly: Record<string, any> };
    expect(result.weekly.tender.found).toBe(2);
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
