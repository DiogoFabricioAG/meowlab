import { describe, expect, it } from "vitest";
import { agentPulse, attentionItems } from "../web/src/attention";
import type { Weekly } from "../web/src/agents";

const quiet: Weekly = {
  week: { start: "2026-11-16", end: "2026-11-22" },
  today: "2026-11-19",
  team: { members: 2, messages: 0, activePeople: 0, previousMessages: 0, messagesToday: 0 },
  tender: { enabled: false, found: 0, foundToday: 0, interesting: 0, highlights: [] },
  invoicing: null,
};

describe("Inicio: what needs the owner", () => {
  it("is empty when nothing is pending", () => {
    expect(attentionItems(quiet)).toEqual([]);
    expect(attentionItems(null)).toEqual([]);
  });

  it("lists approvals, cases, customers to call, rejections, low stock and interesting tenders, in that order", () => {
    const weekly: Weekly = {
      ...quiet,
      reorder: { enabled: true, toApprove: 2, waiting: 1, escalated: 1, monthSpentCents: 0 },
      support: { enabled: true, customers: 5, answered: 4, escalated: 1, open: 1 },
      collections: { enabled: true, owedCents: 10000, lateCount: 1, needsOwner: 3, paidWeekCents: 0 },
      stock: { enabled: true, lowCount: 1, movesToday: 0 },
      tender: { enabled: true, found: 2, foundToday: 1, interesting: 1, highlights: [
        { description: "Polos institucionales", buyer: "Entidad de Lima", deadline: "28/11/2026", amount: "", sourceUrl: null, interesting: true },
        { description: "Otra", buyer: "Entidad", deadline: "30/11/2026", amount: "", sourceUrl: null, interesting: false },
      ] },
      invoicing: { status: "ok", documents: 3, accepted: 2, totalPen: "100.00", previousTotalPen: "0", partial: false,
        rejected: [{ number: "F001-00000031", customer: "Distribuidora Rímac", message: null }],
        today: { documents: 1, totalPen: "50.00", rejected: 0 } },
    };
    const items = attentionItems(weekly);
    expect(items.map((item) => item.key)).toEqual([
      "reorder-approve", "support-open", "collections-owner", "reorder-escalated", "doc-F001-00000031", "stock-low",
      "tender-Polos institucionales-28/11/2026",
    ]);
    expect(items[0].title).toBe("2 pedidos esperan tu aprobación");
    expect(items[2].title).toBe("3 clientes necesitan que les hables tú");
    expect(items[6].action).toBeNull();
  });

  it("ignores agents that are not enabled", () => {
    const weekly: Weekly = { ...quiet, reorder: { enabled: false, toApprove: 4, waiting: 0, escalated: 0, monthSpentCents: 0 } };
    expect(attentionItems(weekly)).toEqual([]);
  });
});

describe("Inicio: how each cat is doing", () => {
  it("needs the owner, worked today, or has nothing new", () => {
    const weekly: Weekly = {
      ...quiet,
      sales: { enabled: true, todayCount: 2, todayTotalCents: 5000, weekCount: 2, weekTotalCents: 5000, weekQuotes: 0 },
      support: { enabled: true, customers: 0, answered: 0, escalated: 0, open: 1 },
      stock: { enabled: true, lowCount: 0, movesToday: 0 },
    };
    expect(agentPulse("support", weekly)).toBe("needs");
    expect(agentPulse("sales", weekly)).toBe("working");
    expect(agentPulse("stock", weekly)).toBe("quiet");
    expect(agentPulse("invoice", null)).toBe("quiet");
  });

  it("shows a Tender Cat ISO deadline as a readable Lima date, not the raw timestamp", () => {
    const items = attentionItems({ ...quiet, tender: { enabled: true, found: 1, foundToday: 1, interesting: 1, highlights: [
      { description: "Cemento Portland", displayTitle: null, buyer: "MUNICIPALIDAD DE CANAYRE", deadline: "2026-11-27T04:59:00.000Z", amount: null, interesting: true, sourceUrl: null },
    ] } } as never);
    const text = items.find((item) => item.agent === "tender")?.text ?? "";
    expect(text).not.toContain("T04:59");
    expect(text).toMatch(/^MUNICIPALIDAD DE CANAYRE · cierra \S/);
  });
});

