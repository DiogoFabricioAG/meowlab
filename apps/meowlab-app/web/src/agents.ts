import type { Membership } from "./auth-client";
import type { IconName } from "./icons";

/** What the bridge reports for one company: this week, and today (Lima). */
export type Weekly = {
  week: { start: string; end: string };
  today: string;
  team: { members: number; messages: number; activePeople: number; previousMessages: number; messagesToday: number };
  tender: {
    enabled: boolean;
    found: number;
    foundToday: number;
    interesting: number;
    highlights: Array<{ description: string; buyer: string; deadline: string; amount: string; sourceUrl: string | null; interesting: boolean }>;
  };
  sales?: { enabled: boolean; todayCount: number; todayTotalCents: number; weekCount: number; weekTotalCents: number; weekQuotes: number };
  invoicing:
    | null
    | { status: "unavailable" }
    | { status: "ok"; documents: number; accepted: number; totalPen: string; previousTotalPen: string; partial: boolean;
        rejected: Array<{ number: string; customer: string; message: string | null }>;
        today: { documents: number; totalPen: string; rejected: number } };
};

/** The plan's catalog (prices in céntimos, IGV included); absent where payments are off. */
export type CatalogAgent = { key: string; name: string; description: string; priceCents: number; available: boolean };

export type AgentKey = "invoice" | "tender" | "sales" | "stock" | "reorder" | "support" | "collections";

/**
 * Every agent works inside the same Manolo chat on WhatsApp; the portal shows what each
 * one did and what it still needs. Order: what the business uses most first.
 */
export const AGENTS: Array<{ key: AgentKey; name: string; does: string; icon: IconName; detail?: string }> = [
  { key: "invoice", name: "Invoice Cat", does: "Emite tus facturas, boletas y guías ante SUNAT cuando se lo pides en el chat.", icon: "invoice", detail: "/agentes/facturas" },
  { key: "tender", name: "Tender Cat", does: "Te avisa de licitaciones del Estado que encajan con tu negocio.", icon: "radar", detail: "/agentes/licitaciones" },
  { key: "sales", name: "Sales Cat", does: "Registra tus ventas y arma cotizaciones con enlace. Escríbele /sales en el chat.", icon: "chart" },
  { key: "stock", name: "Stock Cat", does: "Lleva tu inventario al día con cada venta y compra.", icon: "package" },
  { key: "reorder", name: "Reorder Cat", does: "Te avisa cuando algo se acaba y le escribe a tu proveedor.", icon: "refresh" },
  { key: "support", name: "Support Cat", does: "Responde a tus clientes las preguntas de siempre.", icon: "message" },
  { key: "collections", name: "Collections Cat", does: "Cobra por Yape y confirma los pagos de tus clientes.", icon: "cash" },
];

/** The agent's logo (public/agents): black line art on white, shown on mint tiles. */
export const agentLogo = (key: AgentKey) => `/agents/${key}-cat.webp`;

export type AgentState =
  | { kind: "active"; today: string }
  | { kind: "setup"; step: string }
  | { kind: "available"; priceCents: number | null }
  | { kind: "ask" }
  | { kind: "soon"; priceCents: number | null };

const soles = (cents: number) => `S/ ${(cents / 100).toLocaleString("es-PE", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
export const monthlyPrice = (cents: number | null) => (cents === null ? null : `${soles(cents)} al mes`);
const money = (value: string) => `S/ ${Number(value).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One plain sentence about today, for Inicio and the agent's card. */
export function todayLine(key: AgentKey, weekly: Weekly | null): string {
  if (!weekly) return "Revisando lo de hoy…";
  if (key === "invoice") {
    const invoicing = weekly.invoicing;
    if (!invoicing) return "Todavía no está conectado a SUNAT.";
    if (invoicing.status === "unavailable") return "No pudimos consultar FacturaYa. Vuelve a intentarlo en unos minutos.";
    const today = invoicing.today;
    if (!today.documents) return "Hoy no emitió comprobantes.";
    const rejected = today.rejected ? `, ${plural(today.rejected, "rechazado", "rechazados")} por SUNAT` : "";
    return `Hoy emitió ${plural(today.documents, "comprobante", "comprobantes")} por ${money(today.totalPen)}${rejected}.`;
  }
  if (key === "sales") {
    const sales = weekly.sales;
    if (!sales?.todayCount) return "Hoy no registró ventas.";
    return `Hoy registró ${plural(sales.todayCount, "venta", "ventas")} por ${money(String(sales.todayTotalCents / 100))}.`;
  }
  if (key === "tender") {
    return weekly.tender.foundToday
      ? `Hoy encontró ${plural(weekly.tender.foundToday, "licitación", "licitaciones")} para tu negocio.`
      : "Hoy no encontró licitaciones nuevas.";
  }
  return "";
}

export function agentState(key: AgentKey, company: Membership, weekly: Weekly | null, catalog: CatalogAgent[] | null): AgentState {
  const listed = catalog?.find((agent) => agent.key === key) ?? null;
  if (key === "invoice") {
    return company.invoicing === "active"
      ? { kind: "active", today: todayLine("invoice", weekly) }
      : { kind: "setup", step: "Falta conectar tu clave SOL de SUNAT. Escríbele a Manolo y lo conectamos contigo." };
  }
  if (key === "tender") {
    if (weekly?.tender.enabled) return { kind: "active", today: todayLine("tender", weekly) };
    return listed?.available ? { kind: "available", priceCents: listed.priceCents } : { kind: "ask" };
  }
  if (key === "sales" && weekly?.sales?.enabled) return { kind: "active", today: todayLine("sales", weekly) };
  if (listed?.available) return { kind: "available", priceCents: listed.priceCents };
  return { kind: "soon", priceCents: listed?.priceCents ?? null };
}
