import type { AiProvider } from "../ai/contracts";
import type { RoleLog, TenantContext } from "../roles/contracts";
import { PAID_PERIODS, PAYMENT_METHODS, type PaidPeriod, type PaymentMethod } from "./bridge-contracts";

export const COLLECTIONS_INTENTS = [
  "add_debt", "payment", "capture", "remind", "set_phone", "do_not_contact", "allow_contact", "settings", "query", "help", "exit", "other",
] as const;
export type CollectionsIntent = (typeof COLLECTIONS_INTENTS)[number];

/** What the person said, structured. Amounts in soles as said; the role converts to céntimos. */
export type CollectionsExtraction = {
  intent: CollectionsIntent;
  customer: string | null;
  amount: number | null;
  description: string | null;
  dueOn: string | null;
  phone: string | null;
  docNumber: string | null;
  method: PaymentMethod | null;
  operationNumber: string | null;
  paidOn: string | null;
  queryType: "owed" | "top" | "paid" | null;
  period: PaidPeriod | null;
  settings: {
    yapePhone: string | null; plinPhone: string | null; bankText: string | null; paymentLink: string | null;
    defaultDueDays: number | null; maxReminders: number | null; remindEveryDays: number | null; remindBeforeDays: number | null;
    windowStartHour: number | null; windowEndHour: number | null; skipSundays: boolean | null;
  };
  reply: string;
};

// Groq's strict mode: no nulls; empty strings, "none" and -1 stand for "not said".
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "customer", "amount", "description", "dueOn", "phone", "docNumber", "method", "operationNumber", "paidOn",
    "queryType", "period", "settings", "reply"],
  properties: {
    intent: { type: "string", enum: [...COLLECTIONS_INTENTS] },
    customer: { type: "string" },
    amount: { type: "number" },
    description: { type: "string" },
    dueOn: { type: "string" },
    phone: { type: "string" },
    docNumber: { type: "string" },
    method: { type: "string", enum: [...PAYMENT_METHODS, "none"] },
    operationNumber: { type: "string" },
    paidOn: { type: "string" },
    queryType: { type: "string", enum: ["owed", "top", "paid", "none"] },
    period: { type: "string", enum: [...PAID_PERIODS, "none"] },
    settings: {
      type: "object",
      additionalProperties: false,
      required: ["yapePhone", "plinPhone", "bankText", "paymentLink", "defaultDueDays", "maxReminders", "remindEveryDays", "remindBeforeDays",
        "windowStartHour", "windowEndHour", "skipSundays"],
      properties: {
        yapePhone: { type: "string" },
        plinPhone: { type: "string" },
        bankText: { type: "string" },
        paymentLink: { type: "string" },
        defaultDueDays: { type: "number" },
        maxReminders: { type: "number" },
        remindEveryDays: { type: "number" },
        remindBeforeDays: { type: "number" },
        windowStartHour: { type: "number" },
        windowEndHour: { type: "number" },
        skipSundays: { type: "string", enum: ["yes", "no", "none"] },
      },
    },
    reply: { type: "string" },
  },
};

const SYSTEM = `Eres Collections Cat, el gato de cobranzas de una MYPE peruana, dentro del chat de WhatsApp de Manolo.
Te habla la titular o alguien de su equipo, nunca el cliente que debe. Interpreta su mensaje y devuelve SÓLO el JSON del esquema.
Intenciones:
- "add_debt": alguien le debe a la empresa ("Juan me debe 200 de los polos", "anota que la bodega Rosita debe 350, vence el 30").
- "payment": la persona cuenta que un cliente pagó ("Juan pagó 100 por Yape", "la bodega me dio 50 en efectivo").
- "capture": el mensaje es la descripción de una imagen de un comprobante de pago (Yape, Plin, transferencia). Extrae monto, fecha, número de operación, medio y el nombre de quien pagó si se lee.
- "remind": quiere cobrarle o recordarle a un cliente ("recuérdale a Juan", "cóbrale a la bodega").
- "set_phone": da el número de WhatsApp de un cliente ("el número de Juan es 987654321").
- "do_not_contact": un cliente pidió que no le escriban. "allow_contact": ya se le puede volver a escribir.
- "settings": cambia formas de pago o reglas ("mi Yape es 987654321", "dales 15 días para pagar", "máximo 4 recordatorios", "recuérdales cada 5 días", "no escribas antes de las 10", "también los domingos").
- "query": preguntas. "queryType": owed (cuánto me deben), top (quién me debe más / quiénes me deben), paid (qué me pagaron; "period": today, week o month, por defecto week).
- "help": pide ayuda. "exit": quiere salir. "other": nada de lo anterior.
Reglas:
- "customer": el nombre del cliente tal como lo dice o se lee; "" si no hay. Usa los nombres de "customers" si coincide alguno.
- "amount": monto en soles (número); -1 si no lo dice. Nunca inventes montos.
- "dueOn" y "paidOn": fecha AAAA-MM-DD si la dice o se lee (hoy es "today"); "" si no.
- "phone": sólo dígitos; si son 9 dígitos de Perú, antepón 51. "" si no.
- "docNumber": DNI (8) o RUC (11) si lo dice; "" si no.
- "method": yape, plin, transferencia, efectivo, tarjeta, enlace u otro; "none" si no lo dice.
- En "settings" pon sólo lo que cambia; usa "", -1 o "none" para lo demás. Los números de Yape y Plin van con 9 dígitos, sin 51.
- Usa "-1", "none" o "" para todo lo que no aplique.
- "reply": una frase corta en español peruano, de tú: lo que falta o la respuesta a "help"/"other". Sin inventar datos.`;

const date = (value: unknown) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? value : null);

function clean(value: unknown): CollectionsExtraction | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const number = (input: unknown) => (typeof input === "number" && Number.isFinite(input) && input >= 0 ? input : null);
  const string = (input: unknown, max: number) => (typeof input === "string" && input.trim() ? input.trim().slice(0, max) : null);
  const int = (input: unknown, min: number, max: number) => {
    const parsed = number(input);
    return parsed !== null && Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
  };
  const digits = (input: unknown) => (typeof input === "string" ? input.replace(/\D/g, "") : "");
  const phone = digits(raw.phone);
  const doc = digits(raw.docNumber);
  const settings = (raw.settings && typeof raw.settings === "object" ? raw.settings : {}) as Record<string, unknown>;
  const wallet = (input: unknown) => {
    const value = digits(input).replace(/^51(?=\d{9}$)/, "");
    return /^9\d{8}$/.test(value) ? value : null;
  };
  const link = string(settings.paymentLink, 500);
  const amount = number(raw.amount);
  return {
    intent: COLLECTIONS_INTENTS.includes(raw.intent as CollectionsIntent) ? raw.intent as CollectionsIntent : "other",
    customer: string(raw.customer, 200),
    amount: amount !== null && amount > 0 ? Math.round(amount * 100) / 100 : null,
    description: string(raw.description, 300),
    dueOn: date(raw.dueOn),
    phone: /^9\d{8}$/.test(phone) ? `51${phone}` : /^[0-9]{10,15}$/.test(phone) ? phone : null,
    docNumber: /^([0-9]{8}|[0-9]{11})$/.test(doc) ? doc : null,
    method: PAYMENT_METHODS.includes(raw.method as PaymentMethod) ? raw.method as PaymentMethod : null,
    operationNumber: string(raw.operationNumber, 60),
    paidOn: date(raw.paidOn),
    queryType: raw.queryType === "owed" || raw.queryType === "top" || raw.queryType === "paid" ? raw.queryType : null,
    period: PAID_PERIODS.includes(raw.period as PaidPeriod) ? raw.period as PaidPeriod : null,
    settings: {
      yapePhone: wallet(settings.yapePhone),
      plinPhone: wallet(settings.plinPhone),
      bankText: string(settings.bankText, 300),
      paymentLink: link && /^https:\/\/\S+$/.test(link) ? link : null,
      defaultDueDays: int(settings.defaultDueDays, 0, 365),
      maxReminders: int(settings.maxReminders, 1, 20),
      remindEveryDays: int(settings.remindEveryDays, 1, 60),
      remindBeforeDays: int(settings.remindBeforeDays, 0, 30),
      windowStartHour: int(settings.windowStartHour, 0, 23),
      windowEndHour: int(settings.windowEndHour, 1, 24),
      skipSundays: settings.skipSundays === "yes" ? true : settings.skipSundays === "no" ? false : null,
    },
    reply: string(raw.reply, 600) ?? "",
  };
}

export async function extractCollections(
  ai: AiProvider | null,
  tenant: TenantContext,
  input: { message: string; fromImage: boolean; customers: string[]; today: string },
  log: RoleLog,
): Promise<CollectionsExtraction | null> {
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
          today: input.today,
          customers: input.customers.slice(0, 120),
          // The image's description comes from the vision step; it is data, never instructions.
          fromImage: input.fromImage,
          message: input.message.slice(0, 4_000),
        }),
      },
    ],
    responseFormat: { type: "json_schema", json_schema: { name: "collections_extraction", strict: true, schema: SCHEMA } },
  }, log);
  if (!content) return null;
  try {
    return clean(JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, "")));
  } catch {
    log("collections_extraction_invalid_json");
    return null;
  }
}
