import type { AgentKey } from "./agents";

export type PlanAgent = {
  key: string;
  name: string;
  description: string;
  priceCents: number;
  available: boolean;
};

export type PlanDiscount = { minAgents: number; percent: number };

export type PlanQuote = {
  selectedKeys: string[];
  subtotalCents: number;
  discountPercent: number;
  savingsCents: number;
  totalCents: number;
};

export type PlanBundle = {
  id: "starter" | "store" | "full";
  name: string;
  tagline: string;
  popular?: boolean;
  keys: (agents: readonly PlanAgent[]) => string[];
};

export const PLAN_BUNDLES: readonly PlanBundle[] = [
  {
    id: "starter",
    name: "Empieza a vender",
    tagline: "Vende por WhatsApp y emite tus comprobantes ante SUNAT.",
    keys: () => ["sales", "invoice"],
  },
  {
    id: "store",
    name: "Tienda al día",
    tagline: "Ventas, facturación, inventario y cobranza en un solo equipo.",
    popular: true,
    keys: () => ["sales", "invoice", "stock", "collections"],
  },
  {
    id: "full",
    name: "Todo el equipo",
    tagline: "Todos los gatos disponibles trabajando juntos para tu negocio.",
    keys: (agents) => agents.filter((agent) => agent.available).map((agent) => agent.key),
  },
];

export const AGENT_PITCH: Record<
  AgentKey,
  { idealIf: string; benefits: readonly [string, string, string] }
> = {
  invoice: {
    idealIf: "Ideal si emites facturas, boletas o guías",
    benefits: [
      "Emite facturas, boletas, notas y guías por WhatsApp.",
      "Envía el PDF y XML directo a tu cliente en segundos.",
      "Valida RUC y DNI al instante antes de emitir.",
    ],
  },
  sales: {
    idealIf: "Ideal si vendes y cotizas por WhatsApp",
    benefits: [
      "Registra ventas al contado o al crédito desde el chat.",
      "Arma cotizaciones formales en PDF con enlace.",
      "Resume lo vendido hoy y en la semana.",
    ],
  },
  stock: {
    idealIf: "Ideal si controlas mercadería o insumos",
    benefits: [
      "Descuenta stock automático con cada venta o factura.",
      "Te avisa cuando un producto llega a su mínimo.",
      "Calcula el costo promedio y valor del inventario.",
    ],
  },
  collections: {
    idealIf: "Ideal si vendes al crédito o fías",
    benefits: [
      "Lleva quién te debe y qué cuotas están vencidas.",
      "Prepara recordatorios con tu Yape, Plin o cuenta.",
      "Registra pagos parciales y valida capturas.",
    ],
  },
  reorder: {
    idealIf: "Ideal si repones mercadería con proveedores",
    benefits: [
      "Propone pedidos cuando el stock baja del mínimo.",
      "Envía la orden al proveedor apenas la apruebas.",
      "Hace seguimiento de entregas y presupuesto del mes.",
    ],
  },
  support: {
    idealIf: "Ideal si recibes consultas de clientes 24/7",
    benefits: [
      "Responde preguntas frecuentes todo el día en tu WhatsApp.",
      "Consulta precios y stock real antes de responder.",
      "Te pasa solo los casos que necesitan tu respuesta.",
    ],
  },
  tender: {
    idealIf: "Ideal si vendes o quieres vender al Estado",
    benefits: [
      "Te avisa licitaciones que encajan con tu rubro.",
      "Resume las bases PDF/DOCX sin leer cientos de páginas.",
      "Arma tu lista de documentos y cotización estimada.",
    ],
  },
};

export const PLAN_FAQS: ReadonlyArray<{ question: string; answer: string }> = [
  {
    question: "¿Puedo cambiar de gatos?",
    answer:
      "Sí. Puedes cancelar la renovación cuando quieras y volver a elegir los gatos que necesites para el siguiente periodo.",
  },
  {
    question: "¿Qué pasa si cancelo?",
    answer:
      "No se te vuelve a cobrar el mes siguiente, pero tu equipo sigue activo hasta el último día que ya pagaste.",
  },
  {
    question: "¿Necesito RUC?",
    answer:
      "No para empezar. Sales, Stock, Collections, Reorder, Support y Tender funcionan sin RUC. Solo Invoice Cat exige RUC y clave SOL para emitir ante SUNAT; puedes agregarlo después en Configuración.",
  },
  {
    question: "¿Cómo se activa cada gato?",
    answer:
      "Sales, Stock, Collections, Reorder y Support se activan solos apenas Mercado Pago confirma el cobro. Invoice Cat requiere conectar tu clave SOL de SUNAT tras el pago.",
  },
];

export function discountFor(count: number, discounts: readonly PlanDiscount[]): number {
  return discounts
    .filter((tier) => tier.minAgents <= count)
    .reduce((best, tier) => Math.max(best, tier.percent), 0);
}

/** Exact same pricing calculation as `server/billing/pricing.ts#quote`. */
export function calculatePlanQuote(
  selectedKeys: readonly string[],
  agents: readonly PlanAgent[],
  discounts: readonly PlanDiscount[],
): PlanQuote {
  const unique = new Set(selectedKeys);
  const chosen = agents.filter((agent) => agent.available && unique.has(agent.key));
  const subtotalCents = chosen.reduce((sum, agent) => sum + agent.priceCents, 0);
  const discountPercent = discountFor(chosen.length, discounts);
  const totalCents = Math.round((subtotalCents * (100 - discountPercent)) / 100);
  return {
    selectedKeys: chosen.map((agent) => agent.key),
    subtotalCents,
    discountPercent,
    savingsCents: subtotalCents - totalCents,
    totalCents,
  };
}

export function nextDiscountNudge(
  currentCount: number,
  discounts: readonly PlanDiscount[],
): { needed: number; nextPercent: number } | null {
  const currentPercent = discountFor(currentCount, discounts);
  const nextTier = [...discounts]
    .filter((tier) => tier.minAgents > currentCount && tier.percent > currentPercent)
    .sort((a, b) => a.minAgents - b.minAgents)[0];
  if (!nextTier) return null;
  return { needed: nextTier.minAgents - currentCount, nextPercent: nextTier.percent };
}
