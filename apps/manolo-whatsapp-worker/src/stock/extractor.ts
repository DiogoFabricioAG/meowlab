import type { AiProvider } from "../ai/contracts";
import type { RoleLog, TenantContext } from "../roles/contracts";
import { MOVE_PERIODS, QUERY_TYPES, type ItemKind, type MovePeriod, type QueryType } from "./bridge-contracts";

export const STOCK_INTENTS = ["in", "out", "count", "set_min", "query", "negative", "link", "help", "exit", "other"] as const;
export type StockIntent = (typeof STOCK_INTENTS)[number];

/** What the person said, structured. Costs in soles as said; the role converts to céntimos. */
export type StockExtraction = {
  intent: StockIntent;
  items: Array<{ name: string; quantity: number; unitCost: number | null; kind: ItemKind | null }>;
  minQty: number | null;
  queryType: QueryType | null;
  itemName: string | null;
  period: MovePeriod | null;
  allowNegative: boolean | null;
  alias: { description: string; name: string } | null;
  reply: string;
};

// Groq's strict mode: no nulls; empty strings, "none" and -1 stand for "not said".
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "items", "minQty", "queryType", "itemName", "period", "allowNegative", "alias", "reply"],
  properties: {
    intent: { type: "string", enum: [...STOCK_INTENTS] },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "quantity", "unitCost", "kind"],
        properties: {
          name: { type: "string" },
          quantity: { type: "number" },
          unitCost: { type: "number" },
          kind: { type: "string", enum: ["product", "supply", "none"] },
        },
      },
    },
    minQty: { type: "number" },
    queryType: { type: "string", enum: [...QUERY_TYPES, "none"] },
    itemName: { type: "string" },
    period: { type: "string", enum: [...MOVE_PERIODS, "none"] },
    allowNegative: { type: "string", enum: ["yes", "no", "none"] },
    alias: {
      type: "object",
      additionalProperties: false,
      required: ["description", "name"],
      properties: { description: { type: "string" }, name: { type: "string" } },
    },
    reply: { type: "string" },
  },
};

const SYSTEM = `Eres Stock Cat, el asistente de inventario de una MYPE peruana, dentro del chat de WhatsApp de Manolo.
Te habla la titular o alguien de su equipo. Interpreta su mensaje y devuelve SÓLO el JSON del esquema.
Intenciones:
- "in": entró mercadería o insumos ("me llegaron 50 polos a 12 soles", "compré 3 rollos de vinil").
- "out": salió algo que no pasó por una factura o boleta ("salieron 5 polos", "se rompieron 2 tazas", "usé 1 rollo").
- "count": conteo físico, deja la cantidad exacta ("conté 40 polos", "hay 12 tazas", "ajusta los polos a 40").
- "set_min": poner o quitar el stock mínimo de un producto ("avísame cuando queden 10 polos", "el mínimo de tazas es 5"). En "items" va el producto y en "minQty" el mínimo; -1 en "minQty" si quiere quitarlo.
- "query": preguntas. "queryType": item (cuánto queda de algo; "itemName" con el nombre), low (qué se está acabando), slow (qué no se vende), value (cuánto vale el inventario), moves (qué entró y salió; "period": today, yesterday, week, month o last_month, por defecto week).
- "negative": regla de vender sin stock. "allowNegative": "yes" si permite quedar en negativo, "no" si no.
- "link": dice que un nombre de los comprobantes es un producto suyo ("lo que en la factura dice POLO BL M es el polo blanco M"). "alias.description" es el texto del comprobante y "alias.name" el producto.
- "help": pide ayuda. "exit": quiere salir. "other": nada de lo anterior.
Reglas:
- "items": sólo lo que el mensaje menciona, con el nombre tal como lo dice (sin inventar). Cantidad 1 si no se dice y la intención lo necesita.
- "unitCost": costo por unidad en soles si lo dice (si da un total, divide entre la cantidad); -1 si no lo dice. Nunca inventes costos.
- "kind": "supply" si es insumo o materia prima (papel, tinta, vinil, tela, hilo), "product" si es algo que se vende, "none" si no está claro.
- Usa "-1", "none" o "" para todo lo que no aplique.
- "reply": una frase corta en español peruano, de tú: lo que falta o la respuesta a "help"/"other". Sin inventar datos.`;

function clean(value: unknown): StockExtraction | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const intent = STOCK_INTENTS.includes(raw.intent as StockIntent) ? raw.intent as StockIntent : "other";
  const number = (input: unknown) => (typeof input === "number" && Number.isFinite(input) ? input : null);
  const string = (input: unknown, max: number) => (typeof input === "string" && input.trim() ? input.trim().slice(0, max) : null);
  const alias = raw.alias && typeof raw.alias === "object" ? raw.alias as Record<string, unknown> : null;
  const minQty = number(raw.minQty);
  return {
    intent,
    items: (Array.isArray(raw.items) ? raw.items : []).slice(0, 50).flatMap((item) => {
      const entry = item as Record<string, unknown>;
      const name = string(entry.name, 200);
      const quantity = number(entry.quantity);
      const unitCost = number(entry.unitCost);
      return name && quantity !== null && quantity >= 0
        ? [{ name, quantity: Math.round(quantity * 1000) / 1000, unitCost: unitCost !== null && unitCost >= 0 ? unitCost : null,
          kind: entry.kind === "supply" || entry.kind === "product" ? entry.kind : null }]
        : [];
    }),
    minQty: minQty !== null && minQty >= 0 ? minQty : null,
    queryType: QUERY_TYPES.includes(raw.queryType as QueryType) ? raw.queryType as QueryType : null,
    itemName: string(raw.itemName, 200),
    period: MOVE_PERIODS.includes(raw.period as MovePeriod) ? raw.period as MovePeriod : null,
    allowNegative: raw.allowNegative === "yes" ? true : raw.allowNegative === "no" ? false : null,
    alias: alias && string(alias.description, 300) && string(alias.name, 200)
      ? { description: string(alias.description, 300)!, name: string(alias.name, 200)! } : null,
    reply: string(raw.reply, 600) ?? "",
  };
}

export async function extractStock(
  ai: AiProvider | null,
  tenant: TenantContext,
  input: { message: string; pending: unknown; items: string[]; unmatched: string[] },
  log: RoleLog,
): Promise<StockExtraction | null> {
  if (!ai) return null;
  const content = await ai.complete({
    model: tenant.aiModel,
    temperature: 0,
    maxTokens: 900,
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: JSON.stringify({
          pending: input.pending,
          items: input.items.slice(0, 120),
          unmatchedInDocuments: input.unmatched.slice(0, 20),
          message: input.message.slice(0, 2_000),
        }),
      },
    ],
    responseFormat: { type: "json_schema", json_schema: { name: "stock_extraction", strict: true, schema: SCHEMA } },
  }, log);
  if (!content) return null;
  try {
    return clean(JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, "")));
  } catch {
    log("stock_extraction_invalid_json");
    return null;
  }
}
