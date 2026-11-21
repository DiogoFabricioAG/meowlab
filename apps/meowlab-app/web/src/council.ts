import type { ActivityDay, AgentKey, AgentState, CompanyActivity, Weekly } from "./agents";

/**
 * The council of cats («Tus agentes», ADR-0010 follow-up, tanda 6 T8 v2). Each cat says
 * one thing about **how the business is going**: trends over weeks and months, never a
 * pending task (that lives in Inicio · Para atender) nor what it did today (Inicio · Tus
 * gatos hoy). Deterministic rules over real data only: if a number is missing, the cat
 * says so instead of claiming everything is fine.
 */

export type CouncilTone = "tip" | "rest" | "nodata" | "free" | "setup";
export type CouncilAction = { label: string; path: string };
export type CouncilAdvice = { agent: AgentKey; tone: CouncilTone; text: string; action?: CouncilAction };

/** Minimum change, in percent, worth commenting between two 7-day windows. */
export const TREND_MIN_PCT = 15;
/** Support Cat asks for more answers when it passes on this share of its customers or more. */
export const SUPPORT_HELP_SHARE = 0.3;
/** Tender Cat suggests refining the profile from this many tenders, if few were interesting. */
export const TENDER_MIN_FOUND = 5;
export const TENDER_LOW_FIT = 0.2;
/** Reorder Cat warns when purchases reach this share of the month's sales. */
export const REORDER_HIGH_SHARE = 70;

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const PITCH: Record<AgentKey, string> = {
  invoice: "emitir tus comprobantes desde el chat",
  tender: "encontrar licitaciones del Estado para tu negocio",
  sales: "registrar tus ventas y seguir tu meta del mes",
  stock: "saber antes de que algo se acabe",
  reorder: "pedir a tus proveedores lo que se acaba",
  support: "atender a tus clientes las 24 horas",
  collections: "cobrar lo que te deben",
};

export function soles(cents: number): string {
  return `S/ ${(cents / 100).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Day of the month, days in the month and the month's name for a Lima date `YYYY-MM-DD`. */
export function monthProgress(today: string): { day: number; daysInMonth: number; month: string } {
  const [year, month, day] = today.split("-").map(Number);
  return { day, daysInMonth: new Date(Date.UTC(year, month, 0)).getUTCDate(), month: MONTHS[month - 1] };
}

/** The last 7 days against the 7 before them (the series ends today, Lima). */
export function weekOverWeek(series: readonly ActivityDay[], pick: (day: ActivityDay) => number): { current: number; previous: number } {
  const values = series.map(pick);
  const current = values.slice(-7).reduce((sum, value) => sum + value, 0);
  const previous = values.slice(-14, -7).reduce((sum, value) => sum + value, 0);
  return { current, previous };
}

/** Rounded percent change, or null when there is nothing to compare with. */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function trendWords(change: number): string {
  return `${Math.abs(change)} % ${change > 0 ? "más" : "menos"}`;
}

function salesAdvice(weekly: Weekly, activity: CompanyActivity | null): CouncilAdvice {
  const action = { label: "Ver ventas", path: "/agentes/ventas" };
  const sales = weekly.sales;
  const goal = sales?.goalTargetCents ?? 0;
  if (goal > 0) {
    const achieved = sales?.monthTotalCents ?? 0;
    const { day, daysInMonth, month } = monthProgress(weekly.today);
    const goalAction = { label: "Ver meta", path: "/agentes/ventas" };
    if (achieved >= goal) {
      return { agent: "sales", tone: "tip", action: goalAction,
        text: `¡Ya cumpliste tu meta de ${month}! 🎉 Llevas ${soles(achieved)} de ${soles(goal)}.` };
    }
    const projected = Math.round((achieved / day) * daysInMonth);
    const pct = Math.round((projected / goal) * 100);
    if (projected >= goal) {
      return { agent: "sales", tone: "tip", action: goalAction,
        text: `Vas bien 💪: a este ritmo cierras ${month} con ${soles(projected)}, el ${pct} % de tu meta.` };
    }
    const missing = goal - achieved;
    const perDay = Math.ceil(missing / (daysInMonth - day + 1));
    return { agent: "sales", tone: "tip", action: goalAction,
      text: `A este ritmo cierras ${month} en el ${pct} % de tu meta: te faltan ${soles(missing)}, unos ${soles(perDay)} por día.` };
  }
  const { current, previous } = activity ? weekOverWeek(activity.series, (d) => d.salesCents) : { current: 0, previous: 0 };
  if (!current && !previous) {
    return { agent: "sales", tone: "nodata", action,
      text: "Todavía no registras ventas conmigo. Cuéntame cada venta en el chat y te diré cómo va tu mes." };
  }
  const change = percentChange(current, previous);
  const trend = change !== null && Math.abs(change) >= TREND_MIN_PCT
    ? `En los últimos 7 días vendiste ${trendWords(change)} que en los 7 anteriores ${change > 0 ? "📈" : "📉"}. `
    : "";
  return { agent: "sales", tone: trend ? "tip" : "rest", action,
    text: `${trend}Escríbeme tu meta del mes en el chat y te digo si vas bien.` };
}

function invoiceAdvice(activity: CompanyActivity | null): CouncilAdvice {
  const action = { label: "Ver comprobantes", path: "/agentes/facturas" };
  if (!activity) return { agent: "invoice", tone: "nodata", action, text: "Todavía no tengo suficientes datos para aconsejarte." };
  const { current, previous } = weekOverWeek(activity.series, (d) => d.invoices);
  if (!current && !previous) {
    return { agent: "invoice", tone: "tip", action,
      text: "No emitiste comprobantes en 14 días. ¿Facturas por otro lado? Pídemelo en el chat y te ahorro el trámite." };
  }
  if (!previous) {
    return { agent: "invoice", tone: "tip", action,
      text: `Retomaste la facturación: ${plural(current, "comprobante", "comprobantes")} en los últimos 7 días.` };
  }
  const change = percentChange(current, previous)!;
  if (Math.abs(change) >= TREND_MIN_PCT) {
    return { agent: "invoice", tone: "tip", action,
      text: `En los últimos 7 días emitiste ${plural(current, "comprobante", "comprobantes")}, ${trendWords(change)} que en los 7 anteriores.` };
  }
  return { agent: "invoice", tone: "rest", action, text: "Facturas al mismo ritmo que la semana anterior. Me guardo el maullido 😺" };
}

function collectionsAdvice(weekly: Weekly, activity: CompanyActivity | null): CouncilAdvice {
  const action = { label: "Ver cobranza", path: "/agentes/cobranza" };
  const owed = weekly.collections?.owedCents ?? 0;
  const collected = activity ? weekOverWeek(activity.series, (d) => d.collectionsCents).current : 0;
  if (!owed && !collected) return { agent: "collections", tone: "rest", action, text: "Nadie te debe nada. Así da gusto 😺" };
  const habit = weekly.collections?.lateCount
    ? " Algunas deudas se te atrasan: a los clientes nuevos pídeles un adelanto."
    : "";
  if (!owed) {
    return { agent: "collections", tone: "tip", action, text: `En los últimos 7 días cobraste ${soles(collected)} y ya nadie te debe nada. 🎉` };
  }
  return { agent: "collections", tone: "tip", action,
    text: `En los últimos 7 días cobraste ${soles(collected)}; todavía te deben ${soles(owed)}.${habit}` };
}

function reorderAdvice(weekly: Weekly): CouncilAdvice {
  const action = { label: "Ver pedidos", path: "/agentes/reposicion" };
  const spent = weekly.reorder?.monthSpentCents ?? 0;
  const { month } = monthProgress(weekly.today);
  if (!spent) {
    return { agent: "reorder", tone: "rest", action,
      text: `En ${month} todavía no hubo compras a proveedores. Cuando algo se acabe, te propongo el pedido.` };
  }
  const sold = weekly.sales?.enabled ? weekly.sales.monthTotalCents ?? 0 : 0;
  if (sold > 0) {
    const share = Math.round((spent / sold) * 100);
    const tip = share >= REORDER_HIGH_SHARE ? " Compara precios: pide cotización a otro proveedor." : "";
    return { agent: "reorder", tone: "tip", action,
      text: `En ${month} tus compras a proveedores suman ${soles(spent)}, el ${share} % de lo que vendiste.${tip}` };
  }
  return { agent: "reorder", tone: "tip", action, text: `En ${month} compraste ${soles(spent)} a tus proveedores.` };
}

function supportAdvice(weekly: Weekly): CouncilAdvice {
  const action = { label: "Ver respuestas", path: "/agentes/soporte" };
  const support = weekly.support;
  const customers = support?.customers ?? 0;
  if (!customers) {
    return { agent: "support", tone: "rest", action,
      text: "Esta semana ningún cliente escribió. Buen momento para completar tus respuestas frecuentes." };
  }
  const passed = support?.escalated ?? 0;
  const tip = passed / customers >= SUPPORT_HELP_SHARE
    ? " Suma a tus respuestas lo que más te preguntan y podré resolver más solo."
    : "";
  return { agent: "support", tone: "tip", action,
    text: `Esta semana te ${customers === 1 ? "escribió 1 cliente" : `escribieron ${customers} clientes`} y te pasé ${plural(passed, "caso", "casos")}; el resto lo resolví solo.${tip}` };
}

function tenderAdvice(weekly: Weekly): CouncilAdvice {
  const action = { label: "Ver licitaciones", path: "/agentes/licitaciones" };
  const { found, interesting } = weekly.tender;
  if (!found) return { agent: "tender", tone: "rest", action, text: "Esta semana no salieron licitaciones para tu rubro. Sigo atento 👀" };
  if (found >= TENDER_MIN_FOUND && interesting / found < TENDER_LOW_FIT) {
    return { agent: "tender", tone: "tip", action,
      text: `Esta semana te mostré ${found} licitaciones y solo te ${interesting === 1 ? "interesó 1" : `interesaron ${interesting}`}. Cuéntame mejor qué vendes y afino la búsqueda.` };
  }
  return { agent: "tender", tone: "tip", action,
    text: `Esta semana te mostré ${plural(found, "licitación", "licitaciones")} y te ${interesting === 1 ? "interesó 1" : `interesaron ${interesting}`}.` };
}

function stockAdvice(): CouncilAdvice {
  return { agent: "stock", tone: "nodata", action: { label: "Ver productos", path: "/agentes/stock" },
    text: "Pronto te diré qué productos no se mueven y cuánto dinero tienes parado ahí. Todavía estoy juntando datos 📦" };
}

/** What one cat says at the table, given its state for the company. */
export function councilAdvice(agent: AgentKey, name: string, state: AgentState, weekly: Weekly | null,
  activity: CompanyActivity | null, hasRuc: boolean): CouncilAdvice {
  if (state.kind === "available") {
    return { agent, tone: "free", action: { label: "Ver en Plan", path: "/plan" }, text: `Este puesto está libre: suma a ${name} para ${PITCH[agent]}.` };
  }
  if (state.kind === "setup") {
    return { agent, tone: "setup", text: state.step,
      ...(agent === "invoice" && !hasRuc ? { action: { label: "Agregar RUC", path: "/ajustes" } } : {}) };
  }
  if (state.kind === "ask" || state.kind === "soon") {
    return { agent, tone: "free", text: `${name} se sumará pronto a la mesa.` };
  }
  if (!weekly) return { agent, tone: "nodata", text: "Todavía no tengo suficientes datos para aconsejarte." };
  switch (agent) {
    case "sales": return salesAdvice(weekly, activity);
    case "invoice": return invoiceAdvice(activity);
    case "collections": return collectionsAdvice(weekly, activity);
    case "reorder": return reorderAdvice(weekly);
    case "support": return supportAdvice(weekly);
    case "tender": return tenderAdvice(weekly);
    case "stock": return stockAdvice();
  }
}

export type PeopleRow = { agent: AgentKey; team: number; actions: number; customers?: number };

/** The «who talks to your cats» report, only for the cats at the table, busiest first. */
export function peopleReport(weekly: Weekly | null, seated: readonly AgentKey[]): { days: number; rows: PeopleRow[] } | null {
  const people = weekly?.people;
  if (!people) return null;
  const rows = people.agents
    .filter((row) => seated.includes(row.agent))
    .map((row) => ({ agent: row.agent, team: row.team, actions: row.actions, ...(row.agent === "support" ? { customers: row.customers ?? 0 } : {}) }))
    .sort((a, b) => (b.team + (b.customers ?? 0)) - (a.team + (a.customers ?? 0)) || b.actions - a.actions);
  return { days: people.days, rows };
}

/** «2 personas de tu equipo · 14 pedidos», plus customers for Support Cat. */
export function peopleLine(row: PeopleRow): string {
  const team = row.team ? plural(row.team, "persona de tu equipo", "personas de tu equipo") : "Nadie de tu equipo";
  const actions = row.team ? ` · ${plural(row.actions, "pedido", "pedidos")}` : "";
  const customers = row.customers !== undefined ? ` · ${plural(row.customers, "cliente", "clientes")}` : "";
  return `${team}${actions}${customers}`;
}
