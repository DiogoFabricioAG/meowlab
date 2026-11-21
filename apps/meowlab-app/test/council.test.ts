import { describe, expect, it } from "vitest";
import type { ActivityDay, CompanyActivity, Weekly } from "../web/src/agents";
import { councilAdvice, monthProgress, peopleLine, peopleReport, percentChange, weekOverWeek } from "../web/src/council";

const active = { kind: "active", today: "" } as const;

function weekly(overrides: Partial<Weekly> = {}): Weekly {
  return {
    week: { start: "2026-11-16", end: "2026-11-22" },
    today: "2026-11-21",
    team: { members: 3, messages: 10, activePeople: 2, previousMessages: 8, messagesToday: 1 },
    tender: { enabled: true, found: 0, foundToday: 0, interesting: 0, highlights: [] },
    invoicing: null,
    ...overrides,
  };
}

/** 14 days ending 21/11; `before` fills the first 7, `after` the last 7. */
function activity(pick: (day: number) => Partial<ActivityDay>): CompanyActivity {
  const series = Array.from({ length: 14 }, (_, index) => ({
    date: `2026-11-${String(8 + index).padStart(2, "0")}`, invoices: 0, salesCents: 0, collectionsCents: 0, ...pick(index),
  }));
  return { today: "2026-11-21", active: { invoicing: true, sales: true, collections: true }, series, events: [] };
}

const advice = (agent: Parameters<typeof councilAdvice>[0], w: Weekly | null, a: CompanyActivity | null = null) =>
  councilAdvice(agent, "Gato", active, w, a, true);

describe("council helpers", () => {
  it("knows the month and compares the last 7 days with the 7 before", () => {
    expect(monthProgress("2026-11-21")).toEqual({ day: 21, daysInMonth: 30, month: "noviembre" });
    expect(monthProgress("2028-02-10").daysInMonth).toBe(29);
    expect(weekOverWeek(activity((i) => ({ salesCents: i < 7 ? 100 : 300 })).series, (d) => d.salesCents)).toEqual({ current: 2100, previous: 700 });
    expect(percentChange(130, 100)).toBe(30);
    expect(percentChange(5, 0)).toBeNull();
  });
});

describe("Sales Cat at the table", () => {
  it("projects the month against the goal and says how much is missing per day", () => {
    // 21 of 30 days, S/ 2,100 sold of S/ 5,000: projected S/ 3,000 (60 %), missing S/ 2,900 over 10 days.
    const result = advice("sales", weekly({ sales: { enabled: true, todayCount: 0, todayTotalCents: 0, weekCount: 0, weekTotalCents: 0, weekQuotes: 0,
      goalTargetCents: 500_000, monthTotalCents: 210_000 } }));
    expect(result.text).toBe("A este ritmo cierras noviembre en el 60 % de tu meta: te faltan S/ 2,900.00, unos S/ 290.00 por día.");
    expect(result.action).toEqual({ label: "Ver meta", path: "/agentes/ventas" });
  });

  it("celebrates a reached goal and a good pace", () => {
    const base = { enabled: true, todayCount: 0, todayTotalCents: 0, weekCount: 0, weekTotalCents: 0, weekQuotes: 0, goalTargetCents: 300_000 };
    expect(advice("sales", weekly({ sales: { ...base, monthTotalCents: 300_000 } })).text).toContain("¡Ya cumpliste tu meta de noviembre!");
    expect(advice("sales", weekly({ sales: { ...base, monthTotalCents: 280_000 } })).text).toMatch(/^Vas bien 💪: a este ritmo cierras noviembre con S\/ 4,000\.00, el 133 % de tu meta\.$/);
  });

  it("without a goal, comments a weekly change from 15 % and asks for a goal", () => {
    const sales = { enabled: true, todayCount: 0, todayTotalCents: 0, weekCount: 0, weekTotalCents: 0, weekQuotes: 0 };
    const up = advice("sales", weekly({ sales }), activity((i) => ({ salesCents: i < 7 ? 1000 : 1250 })));
    expect(up.text).toBe("En los últimos 7 días vendiste 25 % más que en los 7 anteriores 📈. Escríbeme tu meta del mes en el chat y te digo si vas bien.");
    const flat = advice("sales", weekly({ sales }), activity((i) => ({ salesCents: i < 7 ? 1000 : 1100 })));
    expect(flat).toMatchObject({ tone: "rest", text: "Escríbeme tu meta del mes en el chat y te digo si vas bien." });
    expect(advice("sales", weekly({ sales }), activity(() => ({}))).tone).toBe("nodata");
  });
});

describe("the other cats", () => {
  it("Invoice Cat compares comprobantes week over week and never says «todo en orden» without data", () => {
    expect(advice("invoice", weekly(), activity((i) => ({ invoices: i < 7 ? 2 : 1 }))).text)
      .toBe("En los últimos 7 días emitiste 7 comprobantes, 50 % menos que en los 7 anteriores.");
    expect(advice("invoice", weekly(), activity(() => ({}))).text).toContain("No emitiste comprobantes en 14 días");
    expect(advice("invoice", weekly(), null)).toMatchObject({ tone: "nodata" });
  });

  it("Collections Cat sets what was collected against what is owed, and suggests a deposit when debts run late", () => {
    const w = weekly({ collections: { enabled: true, owedCents: 250_000, lateCount: 2, needsOwner: 0, paidWeekCents: 0 } });
    expect(advice("collections", w, activity((i) => ({ collectionsCents: i < 7 ? 0 : 10_000 }))).text)
      .toBe("En los últimos 7 días cobraste S/ 700.00; todavía te deben S/ 2,500.00. Algunas deudas se te atrasan: a los clientes nuevos pídeles un adelanto.");
    expect(advice("collections", weekly({ collections: { enabled: true, owedCents: 0, lateCount: 0, needsOwner: 0, paidWeekCents: 0 } }), activity(() => ({}))).tone).toBe("rest");
  });

  it("Reorder Cat compares the month's purchases with the month's sales", () => {
    const w = weekly({
      reorder: { enabled: true, toApprove: 0, waiting: 0, escalated: 0, monthSpentCents: 160_000 },
      sales: { enabled: true, todayCount: 0, todayTotalCents: 0, weekCount: 0, weekTotalCents: 0, weekQuotes: 0, monthTotalCents: 200_000 },
    });
    expect(advice("reorder", w).text).toBe("En noviembre tus compras a proveedores suman S/ 1,600.00, el 80 % de lo que vendiste. Compara precios: pide cotización a otro proveedor.");
  });

  it("Support Cat asks for more answers when it passes on 30 % or more", () => {
    const w = weekly({ support: { enabled: true, customers: 10, answered: 12, escalated: 3, open: 1 } });
    expect(advice("support", w).text).toBe("Esta semana te escribieron 10 clientes y te pasé 3 casos; el resto lo resolví solo. Suma a tus respuestas lo que más te preguntan y podré resolver más solo.");
    expect(advice("support", weekly({ support: { enabled: true, customers: 10, answered: 9, escalated: 2, open: 0 } })).text).not.toContain("Suma a tus respuestas");
  });

  it("Tender Cat suggests refining the profile when few tenders fit", () => {
    expect(advice("tender", weekly({ tender: { enabled: true, found: 14, foundToday: 0, interesting: 2, highlights: [] } })).text)
      .toBe("Esta semana te mostré 14 licitaciones y solo te interesaron 2. Cuéntame mejor qué vendes y afino la búsqueda.");
    expect(advice("tender", weekly({ tender: { enabled: true, found: 4, foundToday: 0, interesting: 0, highlights: [] } })).text)
      .toBe("Esta semana te mostré 4 licitaciones y te interesaron 0.");
  });

  it("Stock Cat says it has no data yet instead of inventing one", () => {
    expect(advice("stock", weekly())).toMatchObject({ tone: "nodata" });
  });
});

describe("seats that are not taken", () => {
  it("an available cat is an empty chair that leads to Plan; setup keeps its step", () => {
    expect(councilAdvice("reorder", "Reorder Cat", { kind: "available", priceCents: 2500 }, weekly(), null, true))
      .toEqual({ agent: "reorder", tone: "free", action: { label: "Ver en Plan", path: "/plan" },
        text: "Este puesto está libre: suma a Reorder Cat para pedir a tus proveedores lo que se acaba." });
    expect(councilAdvice("invoice", "Invoice Cat", { kind: "setup", step: "Agrega tu RUC." }, weekly(), null, false))
      .toEqual({ agent: "invoice", tone: "setup", text: "Agrega tu RUC.", action: { label: "Agregar RUC", path: "/ajustes" } });
  });
});

describe("who talks to your cats", () => {
  it("lists only seated cats, busiest first, with Support Cat's customers", () => {
    const w = weekly({ people: { days: 30, agents: [
      { agent: "invoice", team: 2, actions: 14 },
      { agent: "sales", team: 1, actions: 5 },
      { agent: "stock", team: 0, actions: 0 },
      { agent: "support", team: 1, actions: 3, customers: 7 },
      { agent: "reorder", team: 3, actions: 9 },
    ] } });
    const report = peopleReport(w, ["invoice", "sales", "stock", "support"]);
    expect(report?.rows.map((row) => row.agent)).toEqual(["support", "invoice", "sales", "stock"]);
    expect(peopleLine(report!.rows[0])).toBe("1 persona de tu equipo · 3 pedidos · 7 clientes");
    expect(peopleLine(report!.rows[3])).toBe("Nadie de tu equipo");
    expect(peopleReport(weekly(), ["invoice"])).toBeNull();
  });
});
