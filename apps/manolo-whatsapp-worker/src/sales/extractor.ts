import type { AiProvider } from "../ai/contracts";
import type { RoleLog, TenantContext } from "../roles/contracts";
import { PAYMENT_METHODS, SUMMARY_PERIODS, type CatalogProduct, type PaymentMethod, type SummaryPeriod } from "./bridge-contracts";

export const SALES_INTENTS = ["sale", "quote", "query", "product", "cancel_sale", "help", "exit", "other"] as const;
export type SalesIntent = (typeof SALES_INTENTS)[number];

/** What the owner said, structured. Amounts in soles as said; the role converts to céntimos. */
export type SalesExtraction = {
  intent: SalesIntent;
  period: SummaryPeriod | null;
  customer: { name: string | null; docNumber: string | null } | null;
  items: Array<{ description: string; quantity: number; unitPrice: number | null }>;
  replaceItems: boolean;
  paymentMethod: PaymentMethod | null;
  discount: number | null;
  notes: string | null;
  product: { name: string; unitPrice: number } | null;
  saleNumber: number | null;
  reply: string;
};

// Groq's strict mode: no nulls; empty strings, "none" and -1/0 stand for "not said".
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "period", "customer", "items", "replaceItems", "paymentMethod", "discount", "notes", "product", "saleNumber", "reply"],
  properties: {
    intent: { type: "string", enum: [...SALES_INTENTS] },
    period: { type: "string", enum: [...SUMMARY_PERIODS, "none"] },
    customer: {
      type: "object",
      additionalProperties: false,
      required: ["name", "docNumber"],
      properties: { name: { type: "string" }, docNumber: { type: "string" } },
    },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "quantity", "unitPrice"],
        properties: { description: { type: "string" }, quantity: { type: "number" }, unitPrice: { type: "number" } },
      },
    },
    replaceItems: { type: "boolean" },
    paymentMethod: { type: "string", enum: [...PAYMENT_METHODS, "none"] },
    discount: { type: "number" },
    notes: { type: "string" },
    product: {
      type: "object",
      additionalProperties: false,
      required: ["name", "unitPrice"],
      properties: { name: { type: "string" }, unitPrice: { type: "number" } },
    },
    saleNumber: { type: "integer" },
    reply: { type: "string" },
  },
};

const SYSTEM = `Eres Sales Cat, el asistente de ventas de una MYPE peruana, dentro del chat de WhatsApp de Manolo.
Te habla la titular o alguien de su equipo. Interpreta su mensaje y devuelve SÓLO el JSON del esquema.
Intenciones:
- "sale": registrar una venta ya hecha ("vendí 3 polos a Juan a 25").
- "quote": armar una cotización ("cotiza 100 volantes para Comercial Lima").
- "query": preguntas sobre ventas o cotizaciones (cuánto vendí, qué se vende más, quién compra más, cuántas cotizaciones). Pon "period": today, yesterday, week, month o last_month (por defecto today).
- "product": crear o cambiar el precio de un producto del catálogo ("el polo ahora cuesta 30").
- "cancel_sale": anular una venta por su número ("anula la venta 12").
- "help": pide ayuda o qué puedes hacer. "exit": quiere salir de ventas. "other": nada de lo anterior.
Reglas:
- Si ya hay un borrador ("draft") y el mensaje agrega o corrige datos (cliente, pago, descuento, otro producto), usa la misma intención del borrador.
- "items": sólo los productos que el mensaje menciona. Cantidad 1 si no se dice. "unitPrice" en soles por unidad: tómalo del mensaje; si no lo dice, del catálogo ("catalog") por nombre parecido; si no está, -1. Nunca inventes precios. Si el mensaje da un total para varios, divide entre la cantidad.
- "replaceItems": true sólo si el mensaje corrige la lista completa ("no, eran 5 polos").
- "customer": nombre y RUC (11 dígitos) o DNI (8 dígitos) si los dice; cadenas vacías si no menciona cliente.
- "paymentMethod": efectivo, yape, plin, transferencia, tarjeta o credito ("al crédito", "me paga después", "fiado"); "none" si no lo dice.
- "discount": descuento total en soles si lo dice; 0 si no. "notes": "" si no hay. "period": "none" si no es una consulta.
- "product": para "product", el nombre y el precio en soles; si no aplica, nombre "" y precio -1. "saleNumber": 0 si no se menciona.
- "reply": una frase corta en español peruano, de tú, para la titular: qué falta (por ejemplo el precio de un producto) o la respuesta a "help"/"other". Sin inventar datos.`;

function clean(value: unknown): SalesExtraction | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const intent = SALES_INTENTS.includes(raw.intent as SalesIntent) ? raw.intent as SalesIntent : "other";
  const number = (input: unknown) => (typeof input === "number" && Number.isFinite(input) ? input : null);
  const string = (input: unknown, max: number) => (typeof input === "string" && input.trim() ? input.trim().slice(0, max) : null);
  const rawCustomer = raw.customer && typeof raw.customer === "object" ? raw.customer as Record<string, unknown> : null;
  const customer = rawCustomer && (string(rawCustomer.name, 200) || string(rawCustomer.docNumber, 20)) ? rawCustomer : null;
  const docNumber = string(customer?.docNumber, 20)?.replace(/\D/g, "") ?? null;
  const product = raw.product && typeof raw.product === "object" ? raw.product as Record<string, unknown> : null;
  return {
    intent,
    period: SUMMARY_PERIODS.includes(raw.period as SummaryPeriod) ? raw.period as SummaryPeriod : null,
    customer: customer ? { name: string(customer.name, 200), docNumber: docNumber && /^(\d{8}|\d{11})$/.test(docNumber) ? docNumber : null } : null,
    items: (Array.isArray(raw.items) ? raw.items : []).slice(0, 50).flatMap((item) => {
      const entry = item as Record<string, unknown>;
      const description = string(entry.description, 300);
      const quantity = number(entry.quantity) ?? 1;
      const unitPrice = number(entry.unitPrice);
      return description && quantity > 0 ? [{ description, quantity, unitPrice: unitPrice !== null && unitPrice >= 0 ? unitPrice : null }] : [];
    }),
    replaceItems: raw.replaceItems === true,
    paymentMethod: PAYMENT_METHODS.includes(raw.paymentMethod as PaymentMethod) ? raw.paymentMethod as PaymentMethod : null,
    discount: number(raw.discount) !== null && Number(raw.discount) > 0 ? Number(raw.discount) : null,
    notes: string(raw.notes, 1000),
    product: product && string(product.name, 200) && number(product.unitPrice) !== null && Number(product.unitPrice) >= 0
      ? { name: string(product.name, 200)!, unitPrice: Number(product.unitPrice) } : null,
    saleNumber: Number.isSafeInteger(raw.saleNumber) && Number(raw.saleNumber) > 0 ? Number(raw.saleNumber) : null,
    reply: string(raw.reply, 600) ?? "",
  };
}

export async function extractSales(
  ai: AiProvider | null,
  tenant: TenantContext,
  input: { message: string; draft: unknown; catalog: CatalogProduct[] },
  log: RoleLog,
): Promise<SalesExtraction | null> {
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
          draft: input.draft,
          catalog: input.catalog.slice(0, 80).map((product) => ({ name: product.name, unitPrice: product.unitPriceCents / 100 })),
          message: input.message.slice(0, 2_000),
        }),
      },
    ],
    responseFormat: { type: "json_schema", json_schema: { name: "sales_extraction", strict: true, schema: SCHEMA } },
  }, log);
  if (!content) return null;
  try {
    return clean(JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, "")));
  } catch {
    log("sales_extraction_invalid_json");
    return null;
  }
}
