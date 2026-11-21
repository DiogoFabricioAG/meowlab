import type { AgentKey, Weekly } from "./agents";
import { formatDeadline } from "./tenderDates";

/**
 * What needs the owner today, read from the weekly summary. Each item opens the agent's page;
 * approving still happens in the chat, where the agent asked.
 */
export type AttentionItem = {
  key: string;
  agent: AgentKey;
  title: string;
  text: string;
  tone: "action" | "warning" | "opportunity";
  action: { label: string; path: string } | { label: string; href: string } | null;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function attentionItems(weekly: Weekly | null): AttentionItem[] {
  if (!weekly) return [];
  const items: AttentionItem[] = [];
  const reorder = weekly.reorder?.enabled ? weekly.reorder : null;
  const support = weekly.support?.enabled ? weekly.support : null;
  const collections = weekly.collections?.enabled ? weekly.collections : null;
  const stock = weekly.stock?.enabled ? weekly.stock : null;
  const invoicing = weekly.invoicing && weekly.invoicing.status === "ok" ? weekly.invoicing : null;

  if (reorder?.toApprove) {
    items.push({ key: "reorder-approve", agent: "reorder", tone: "action",
      title: plural(reorder.toApprove, "pedido espera tu aprobación", "pedidos esperan tu aprobación"),
      text: "Reorder Cat te los mandó al chat con «Aprobar».", action: { label: "Ver pedidos", path: "/agentes/reposicion" } });
  }
  if (support?.open) {
    items.push({ key: "support-open", agent: "support", tone: "action",
      title: plural(support.open, "caso de un cliente espera tu respuesta", "casos de clientes esperan tu respuesta"),
      text: "Support Cat no supo responder y te lo pasó.", action: { label: "Ver casos", path: "/agentes/soporte" } });
  }
  if (collections?.needsOwner) {
    items.push({ key: "collections-owner", agent: "collections", tone: "action",
      title: plural(collections.needsOwner, "cliente necesita que le hables tú", "clientes necesitan que les hables tú"),
      text: "No respondieron a los recordatorios.", action: { label: "Ver deudas", path: "/agentes/cobranza" } });
  }
  if (reorder?.escalated) {
    items.push({ key: "reorder-escalated", agent: "reorder", tone: "action",
      title: plural(reorder.escalated, "proveedor no respondió", "proveedores no respondieron"),
      text: "Reorder Cat le insistió y necesita que le escribas tú.", action: { label: "Ver pedidos", path: "/agentes/reposicion" } });
  }
  for (const doc of invoicing?.rejected ?? []) {
    items.push({ key: `doc-${doc.number}`, agent: "invoice", tone: "warning",
      title: `${doc.number} rechazado por SUNAT${doc.customer ? ` · ${doc.customer}` : ""}`,
      text: doc.message ?? "Revisa el comprobante en Invoice Cat.", action: { label: "Ver comprobante", path: "/agentes/facturas" } });
  }
  if (stock?.lowCount) {
    items.push({ key: "stock-low", agent: "stock", tone: "warning",
      title: plural(stock.lowCount, "producto está en su mínimo", "productos están en su mínimo"),
      text: "Stock Cat te avisa antes de que se acaben.", action: { label: "Ver stock", path: "/agentes/stock" } });
  }
  for (const tender of weekly.tender.highlights.filter((item) => item.interesting)) {
    items.push({ key: `tender-${tender.description}-${tender.deadline}`, agent: "tender", tone: "opportunity",
      title: tender.displayTitle || tender.description,
      text: `${tender.buyer}${formatDeadline(tender.deadline) ? ` · cierra ${formatDeadline(tender.deadline)}` : ""}${tender.amount ? ` · ${tender.amount}` : ""}`,
      action: tender.sourceUrl ? { label: "Ver en SEACE", href: tender.sourceUrl } : null });
  }
  return items;
}

/** What each agent looks like right now: it needs the owner, it worked today, or nothing new. */
export type AgentPulse = "needs" | "working" | "quiet";

export function agentPulse(key: AgentKey, weekly: Weekly | null): AgentPulse {
  if (!weekly) return "quiet";
  const invoicing = weekly.invoicing && weekly.invoicing.status === "ok" ? weekly.invoicing : null;
  switch (key) {
    case "invoice":
      if (invoicing?.rejected.length) return "needs";
      return invoicing?.today.documents ? "working" : "quiet";
    case "sales":
      return weekly.sales?.todayCount ? "working" : "quiet";
    case "stock":
      if (weekly.stock?.lowCount) return "needs";
      return weekly.stock?.movesToday ? "working" : "quiet";
    case "reorder":
      if (weekly.reorder?.toApprove || weekly.reorder?.escalated) return "needs";
      return weekly.reorder?.waiting ? "working" : "quiet";
    case "collections":
      if (weekly.collections?.needsOwner) return "needs";
      return weekly.collections?.owedCents ? "working" : "quiet";
    case "support":
      if (weekly.support?.open) return "needs";
      return weekly.support?.customers ? "working" : "quiet";
    case "tender":
      if (weekly.tender.interesting) return "needs";
      return weekly.tender.foundToday ? "working" : "quiet";
  }
}

export const PULSE_LABEL: Record<AgentPulse, string> = {
  needs: "Te necesita",
  working: "Trabajó hoy",
  quiet: "Sin novedades",
};
