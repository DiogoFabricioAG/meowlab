import type { AiProvider } from "../ai/contracts";
import type { RoleLog, TenantContext } from "../roles/contracts";
import { REORDER_QUERY_TYPES, type ReorderQueryType, type SupplierReply } from "./bridge-contracts";

export const REORDER_INTENTS = [
  "set_max", "set_supplier", "manufacture", "purchase", "set_budget", "change_quantity", "produced", "query", "review", "help", "exit", "other",
] as const;
export type ReorderIntent = (typeof REORDER_INTENTS)[number];

/** What the owner or the team said, structured. Money in soles as said; the role converts. */
export type ReorderExtraction = {
  intent: ReorderIntent;
  item: string | null;
  quantity: number | null;
  supplier: { name: string; phone: string | null; ruc: string | null } | null;
  items: string[];
  budget: number | null;
  removeBudget: boolean;
  queryType: ReorderQueryType | null;
  produced: Array<{ name: string; quantity: number }>;
  reply: string;
};

// Groq's strict mode: no nulls; empty strings and -1 stand for "not said".
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "item", "quantity", "supplier", "items", "budget", "queryType", "produced", "reply"],
  properties: {
    intent: { type: "string", enum: [...REORDER_INTENTS] },
    item: { type: "string" },
    quantity: { type: "number" },
    supplier: {
      type: "object",
      additionalProperties: false,
      required: ["name", "phone", "ruc"],
      properties: { name: { type: "string" }, phone: { type: "string" }, ruc: { type: "string" } },
    },
    items: { type: "array", items: { type: "string" } },
    budget: { type: "number" },
    queryType: { type: "string", enum: [...REORDER_QUERY_TYPES, "none"] },
    produced: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "quantity"],
        properties: { name: { type: "string" }, quantity: { type: "number" } },
      },
    },
    reply: { type: "string" },
  },
};

const SYSTEM = `Eres Reorder Cat, el gato que repone lo que se acaba en una MYPE peruana, dentro del chat de WhatsApp de Manolo.
Te habla la titular o alguien de su equipo. Interpreta su mensaje y devuelve SÓLO el JSON del esquema.
Intenciones:
- "set_max": hasta cuánto llenar un producto al pedirlo ("el máximo de polos blancos es 100", "pide hasta tener 50 tazas"). "item" y "quantity".
- "set_supplier": quién vende algo o el contacto de un proveedor ("los polos me los vende Textiles Lima, 987654321", "el WhatsApp de Textiles Lima es 912345678", "su RUC es 20123456789"). "supplier" con nombre, teléfono y RUC si los dice; "items" con los productos que menciona.
- "manufacture": un producto lo hacen ellos mismos, no se compra ("los polos estampados los hacemos nosotros"). "item".
- "purchase": un producto vuelve a comprarse a un proveedor. "item".
- "set_budget": presupuesto mensual de compras ("mi presupuesto de compras es 3000 al mes"). "budget" en soles; -2 si quiere quitarlo.
- "change_quantity": cambiar la cantidad de un pedido por aprobar ("pide solo 30 polos blancos", "quita las tazas" = cantidad 0). "item" y "quantity".
- "produced": terminaron de producir algo ("ya terminamos 50 polos estampados"). "produced" con nombre y cantidad.
- "query": "queryType" pending (qué está pedido y por llegar) o month (cuánto compré este mes y a quién).
- "review": quiere ver qué hay que pedir o los pedidos por aprobar ("¿qué hay que pedir?", "muéstrame los pedidos").
- "help": pide ayuda. "exit": quiere salir. "other": nada de lo anterior.
Reglas:
- Nombres de productos tal como los dice, sin inventar; usa "products" (la lista que te paso) para escribirlos igual si coinciden.
- Teléfonos sólo con dígitos, como los dice. RUC sólo si tiene 11 dígitos.
- Usa -1 o "" para lo que no aplique; "queryType" "none" si no es consulta.
- "reply": una frase corta en español peruano, de tú: lo que falta o la respuesta a "help"/"other". Sin inventar datos.`;

function clean(value: unknown): ReorderExtraction | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const intent = REORDER_INTENTS.includes(raw.intent as ReorderIntent) ? raw.intent as ReorderIntent : "other";
  const number = (input: unknown) => (typeof input === "number" && Number.isFinite(input) ? input : null);
  const string = (input: unknown, max: number) => (typeof input === "string" && input.trim() ? input.trim().slice(0, max) : null);
  const supplier = raw.supplier && typeof raw.supplier === "object" ? raw.supplier as Record<string, unknown> : null;
  const quantity = number(raw.quantity);
  const budget = number(raw.budget);
  const supplierName = supplier ? string(supplier.name, 200) : null;
  const phone = supplier ? normalizePhone(string(supplier.phone, 30)) : null;
  const ruc = supplier && typeof supplier.ruc === "string" && /^[0-9]{11}$/.test(supplier.ruc.trim()) ? supplier.ruc.trim() : null;
  return {
    intent,
    item: string(raw.item, 200),
    quantity: quantity !== null && quantity >= 0 ? Math.round(quantity * 1000) / 1000 : null,
    supplier: supplierName ? { name: supplierName, phone, ruc } : null,
    items: (Array.isArray(raw.items) ? raw.items : []).flatMap((item) => string(item, 200) ?? []).slice(0, 30),
    budget: budget !== null && budget > 0 ? budget : null,
    removeBudget: budget === -2,
    queryType: REORDER_QUERY_TYPES.includes(raw.queryType as ReorderQueryType) ? raw.queryType as ReorderQueryType : null,
    produced: (Array.isArray(raw.produced) ? raw.produced : []).slice(0, 20).flatMap((line) => {
      const entry = line as Record<string, unknown>;
      const name = string(entry.name, 200);
      const amount = number(entry.quantity);
      return name && amount !== null && amount > 0 ? [{ name, quantity: Math.round(amount * 1000) / 1000 }] : [];
    }),
    reply: string(raw.reply, 600) ?? "",
  };
}

/** Peruvian mobiles come as 9 digits; WhatsApp wants the country code (51987654321). */
export function normalizePhone(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (/^9\d{8}$/.test(digits)) return `51${digits}`;
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

export async function extractReorder(
  ai: AiProvider | null,
  tenant: TenantContext,
  input: { message: string; products: string[] },
  log: RoleLog,
): Promise<ReorderExtraction | null> {
  if (!ai) return null;
  const content = await ai.complete({
    model: tenant.aiModel,
    temperature: 0,
    maxTokens: 700,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: JSON.stringify({ products: input.products.slice(0, 120), message: input.message.slice(0, 2_000) }) },
    ],
    responseFormat: { type: "json_schema", json_schema: { name: "reorder_extraction", strict: true, schema: SCHEMA } },
  }, log);
  if (!content) return null;
  try {
    return clean(JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, "")));
  } catch {
    log("reorder_extraction_invalid_json");
    return null;
  }
}

const REPLY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["outcome", "deliverBy", "total", "unitPrices", "note"],
  properties: {
    outcome: { type: "string", enum: ["accepted", "declined", "other"] },
    deliverBy: { type: "string" },
    total: { type: "number" },
    unitPrices: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item", "price"],
        properties: { item: { type: "string" }, price: { type: "number" } },
      },
    },
    note: { type: "string" },
  },
};

const REPLY_SYSTEM = `Lees la respuesta de un proveedor a un pedido de reposición que le envió una MYPE peruana por WhatsApp.
Devuelve SÓLO el JSON del esquema.
- "outcome": "accepted" si acepta o confirma el pedido (aunque sea con otra fecha o precio, o parcial); "declined" si no puede atenderlo; "other" si pregunta algo o no queda claro.
- "deliverBy": fecha de entrega que ofrece, en formato AAAA-MM-DD, calculada desde "today" (por ejemplo «el lunes», «mañana», «en 3 días»); "" si no la dice.
- "total": total del pedido en soles si lo dice; -1 si no.
- "unitPrices": precio por unidad en soles de cada producto que mencione, con el nombre del pedido ("order"); vacío si no da precios.
- "note": en una frase corta, lo importante de su mensaje (condiciones, parciales, preguntas); "" si sólo confirma.
Nunca inventes fechas ni precios.`;

/** The supplier's message, read against the order (ADR-0016, point 9). */
export async function extractSupplierReply(
  ai: AiProvider | null,
  tenant: TenantContext,
  input: { message: string; order: string[]; today: string },
  log: RoleLog,
): Promise<SupplierReply | null> {
  if (!ai) return null;
  const content = await ai.complete({
    model: tenant.aiModel,
    temperature: 0,
    maxTokens: 500,
    messages: [
      { role: "system", content: REPLY_SYSTEM },
      { role: "user", content: JSON.stringify({ today: input.today, order: input.order.slice(0, 50), message: input.message.slice(0, 2_000) }) },
    ],
    responseFormat: { type: "json_schema", json_schema: { name: "supplier_reply", strict: true, schema: REPLY_SCHEMA } },
  }, log);
  if (!content) return null;
  try {
    const raw = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, "")) as Record<string, unknown>;
    const outcome = raw.outcome === "accepted" || raw.outcome === "declined" ? raw.outcome : "other";
    const deliverBy = typeof raw.deliverBy === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.deliverBy) ? raw.deliverBy : null;
    const total = typeof raw.total === "number" && raw.total > 0 ? Math.round(raw.total * 100) : null;
    const unitPrices = (Array.isArray(raw.unitPrices) ? raw.unitPrices : []).slice(0, 50).flatMap((line) => {
      const entry = line as Record<string, unknown>;
      return typeof entry.item === "string" && entry.item.trim() && typeof entry.price === "number" && entry.price >= 0
        ? [{ item: entry.item.trim().slice(0, 200), unitPriceCents: Math.round(entry.price * 100) }] : [];
    });
    const note = typeof raw.note === "string" && raw.note.trim() ? raw.note.trim().slice(0, 500) : null;
    return { outcome, deliverBy, totalCents: total, unitPrices, note };
  } catch {
    log("reorder_supplier_reply_invalid_json");
    return null;
  }
}
