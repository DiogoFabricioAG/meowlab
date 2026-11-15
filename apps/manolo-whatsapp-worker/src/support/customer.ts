import type { AiProvider } from "../ai/contracts";
import type { RoleLog, TenantContext } from "../roles/contracts";
import type { RoleStateRepository } from "../roles/state";
import type { WhatsAppClient, WhatsAppSendResult } from "../whatsapp/contracts";
import type { CustomerContext, Ticket, TicketKind } from "./bridge-contracts";
import type { SupportClient } from "./client";

export const SUPPORT_CUSTOMER_STATE = "support-customer";
const LIMA_OFFSET_MS = 5 * 60 * 60 * 1000;
const limaDate = (instant: Date) => new Date(instant.getTime() - LIMA_OFFSET_MS).toISOString().slice(0, 10);
export const soles = (cents: number) =>
  `S/ ${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const CUSTOMER_ACTIONS = ["answer", "quote", "ask_team", "complaint", "human", "chat"] as const;
export type CustomerAction = (typeof CUSTOMER_ACTIONS)[number];
export type CustomerDecision = {
  action: CustomerAction;
  reply: string;
  items: Array<{ product: string; quantity: number }>;
  customerName: string | null;
  question: string;
};

type CustomerState = { v: 1; ratedOn: string | null; lastQuestion: string | null };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["action", "reply", "items", "customerName", "question"],
  properties: {
    action: { type: "string", enum: [...CUSTOMER_ACTIONS] },
    reply: { type: "string" },
    items: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["product", "quantity"],
        properties: { product: { type: "string" }, quantity: { type: "number" } } },
    },
    customerName: { type: "string" },
    question: { type: "string" },
  },
};

const SYSTEM = `Eres Support Cat, el asistente de postventa por WhatsApp de una MYPE peruana ("company"). Le hablas a un CLIENTE de esa empresa.
Habla de tú, cercano y breve (máximo 3 frases), en español peruano. Firmas como el asistente de la empresa, nunca como MeowLab.
Sólo puedes usar estos datos: "faqs" (preguntas frecuentes de la empresa), "catalog" (productos y precios con IGV), "quotes" y "sales" (las cotizaciones y compras de este cliente) y "openTickets" (consultas suyas que el equipo aún no responde). Nunca inventes horarios, precios, fechas, stock, descuentos ni políticas.
Devuelve SÓLO el JSON del esquema:
- "answer": la respuesta está en los datos. "reply" es la respuesta.
- "quote": quiere comprar o cotizar productos que están TODOS en "catalog". "items" con el nombre EXACTO del catálogo y la cantidad; "reply" vacío.
- "ask_team": pregunta algo que no está en los datos, o quiere productos que no están en el catálogo, o algo que sólo el equipo puede decidir. "question" resume en una frase qué necesita; "reply" le dice que lo consultas con el equipo y le respondes por aquí.
- "complaint": reclamo o queja (producto malo, demora, mala atención). "question" lo resume; "reply" se disculpa y dice que se lo pasas al equipo ahora mismo.
- "human": pide hablar con una persona. "question" dice para qué si lo sabes; "reply" dice que le avisas al equipo.
- "chat": saludo, gracias o algo sin pregunta. "reply" breve; si saluda, preséntate como el asistente de la empresa y pregunta en qué ayudas.
Si dice su nombre, ponlo en "customerName"; si no, "". Usa "" o [] para lo que no aplique.
"history" son los mensajes anteriores de esta conversación, para entender el contexto.`;

function clean(raw: unknown): CustomerDecision | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const action = CUSTOMER_ACTIONS.includes(value.action as CustomerAction) ? value.action as CustomerAction : "ask_team";
  const text = (input: unknown, max: number) => (typeof input === "string" && input.trim() ? input.trim().slice(0, max) : null);
  return {
    action,
    reply: text(value.reply, 1000) ?? "",
    items: (Array.isArray(value.items) ? value.items : []).slice(0, 30).flatMap((item) => {
      const entry = item as Record<string, unknown>;
      const product = text(entry.product, 200);
      return product && typeof entry.quantity === "number" && entry.quantity > 0 && entry.quantity <= 100_000
        ? [{ product, quantity: Math.round(entry.quantity * 1000) / 1000 }] : [];
    }),
    customerName: text(value.customerName, 200),
    question: text(value.question, 1000) ?? "",
  };
}

export async function decideForCustomer(ai: AiProvider | null, tenant: TenantContext,
  input: { message: string; context: Extract<CustomerContext, { mode: "customer" }>; history: string[] }, log: RoleLog): Promise<CustomerDecision | null> {
  if (!ai) return null;
  const { context } = input;
  const content = await ai.complete({
    model: tenant.aiModel,
    temperature: 0,
    maxTokens: 800,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: JSON.stringify({
        company: context.companyName,
        customerName: context.customer.name,
        faqs: context.faqs,
        catalog: context.catalog.map((product) => ({ name: product.name, price: soles(product.unitPriceCents) })),
        quotes: context.quotes.map((quote) => ({ number: quote.number, total: soles(quote.totalCents), date: quote.createdOn, validUntil: quote.validUntil })),
        sales: context.sales.map((sale) => ({ number: sale.number, total: soles(sale.totalCents), date: sale.soldOn, status: sale.status,
          payment: sale.paymentMethod, pending: sale.balanceCents ? soles(sale.balanceCents) : null })),
        openTickets: context.openTickets,
        history: input.history.slice(-8),
        message: input.message.slice(0, 2_000),
      }) },
    ],
    responseFormat: { type: "json_schema", json_schema: { name: "support_customer", strict: true, schema: SCHEMA } },
  }, log);
  if (!content) return null;
  try {
    return clean(JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, "")));
  } catch {
    log("support_customer_invalid_json");
    return null;
  }
}

const KIND_LABEL: Record<TicketKind, string> = {
  question: "pregunta", complaint: "⚠️ RECLAMO", human: "quiere hablar con una persona", sale: "quiere comprar", unhappy: "no quedó conforme",
};

/** What the owner reads in Manolo (ADR-0017, point 8). */
export const ownerTicketText = (companyName: string, ticket: Ticket) =>
  `🛟 *Support Cat · ${companyName}* — caso #${ticket.number}\n`
  + `${ticket.customerName ?? "Un cliente"} (+${ticket.customerPhone}) ${KIND_LABEL[ticket.kind]}:\n«${ticket.question}»\n\n`
  + "Toca «Responder» y lo que me escribas se lo paso tal cual.";

export type CustomerTurn = {
  context: Extract<CustomerContext, { mode: "customer" }>;
  text: string;
  interactionId: string | null;
  messageId: string | null;
  phone: string;
  phoneNumberId: string;
  contactId: number | null;
  tenantId: string;
  history: string[];
  client: SupportClient;
  whatsapp: WhatsAppClient;
  roleState: RoleStateRepository;
  reply: (text: string) => Promise<WhatsAppSendResult>;
  sendButtons: (body: string, buttons: Array<{ id: string; title: string }>) => Promise<WhatsAppSendResult>;
  sendDocument: (pdf: Blob, filename: string, caption: string) => Promise<WhatsAppSendResult>;
  ai: AiProvider | null;
  tenant: TenantContext;
  log: RoleLog;
  now?: Date;
};

/** Tells the owner about a ticket now; outside their 24-hour window it waits in /support and the portal. */
export async function notifyOwner(turn: Pick<CustomerTurn, "client" | "whatsapp" | "phoneNumberId">, companyId: string, companyName: string,
  ticket: Ticket, ownerPhones: string[]): Promise<void> {
  let delivered = false;
  for (const phone of ownerPhones) {
    const sent = await turn.whatsapp.sendButtons(phone, ownerTicketText(companyName, ticket),
      [{ id: `support:answer:${companyId}:${ticket.id}`, title: "Responder" }], turn.phoneNumberId);
    delivered ||= sent.status === "sent";
  }
  if (delivered) await turn.client.markNotified(companyId, [ticket.id]);
}

/**
 * A customer wrote to the company's number (ADR-0017): the cat answers from what it knows,
 * quotes from the catalog, and passes the rest to the owner as a ticket. «¿Te ayudé?» once a
 * day after an answer; a «no» goes to the owner too.
 */
export async function handleCustomerMessage(turn: CustomerTurn): Promise<void> {
  const { context, client } = turn;
  const companyId = context.companyId;
  const now = turn.now ?? new Date();
  const stateKey = SUPPORT_CUSTOMER_STATE;
  let state: CustomerState = { v: 1, ratedOn: null, lastQuestion: null };
  if (turn.contactId !== null) {
    try {
      const saved = JSON.parse(await turn.roleState.get(turn.tenantId, turn.contactId, stateKey) ?? "null") as CustomerState | null;
      if (saved?.v === 1) state = saved;
    } catch {
      // A broken state starts over.
    }
  }
  const save = async () => {
    if (turn.contactId !== null) await turn.roleState.set(turn.tenantId, turn.contactId, stateKey, JSON.stringify(state)).catch(() => false);
  };
  const ticket = async (kind: TicketKind, question: string, customerName: string | null) => {
    const opened = await client.openTicket(companyId, { phone: turn.phone, kind, question, customerName, sourceRef: turn.messageId ?? undefined });
    if (opened.ok) await notifyOwner(turn, companyId, opened.data.companyName, opened.data.ticket, opened.data.ownerPhones);
    else turn.log("support_ticket_failed", { code: opened.code });
    return opened.ok;
  };

  if (turn.interactionId?.startsWith("support:rate:")) {
    const happy = turn.interactionId === "support:rate:yes";
    await client.event(companyId, turn.phone, happy ? "rated_yes" : "rated_no", turn.messageId ?? undefined);
    if (happy) {
      await turn.reply("¡Qué bueno! Aquí estoy si necesitas algo más.");
      return;
    }
    await ticket("unhappy", state.lastQuestion ?? "No quedó conforme con la respuesta del asistente.", context.customer.name);
    await turn.reply(`Lo siento. Le paso tu caso al equipo de ${context.companyName} para que te ayuden directamente.`);
    return;
  }

  const decision = await decideForCustomer(turn.ai, turn.tenant, { message: turn.text, context, history: turn.history }, turn.log);
  if (!decision) {
    await ticket("question", turn.text.slice(0, 1000) || "Mensaje sin texto", context.customer.name);
    await turn.reply(`Déjame consultarlo con el equipo de ${context.companyName}; te respondo por aquí apenas me digan.`);
    return;
  }
  const name = decision.customerName ?? context.customer.name;
  switch (decision.action) {
    case "chat":
      await turn.reply(decision.reply || `Hola, soy el asistente de ${context.companyName}. ¿En qué te ayudo?`);
      return;
    case "answer": {
      await turn.reply(decision.reply);
      await client.event(companyId, turn.phone, "answered", turn.messageId ?? undefined);
      state.lastQuestion = turn.text.slice(0, 500);
      const today = limaDate(now);
      if (state.ratedOn !== today) {
        state.ratedOn = today;
        await turn.sendButtons("¿Te ayudé?", [{ id: "support:rate:yes", title: "Sí, gracias" }, { id: "support:rate:no", title: "No" }]);
      }
      await save();
      return;
    }
    case "quote": {
      const quoted = await client.customerQuote(companyId, { phone: turn.phone, customerName: name, items: decision.items, sourceRef: turn.messageId ?? undefined });
      if (!quoted.ok) {
        const missing = quoted.code === "unknown_products" ? ((quoted.details as { products?: string[] } | undefined)?.products ?? []) : [];
        await ticket("sale", `Quiere comprar: ${decision.items.map((item) => `${item.quantity} ${item.product}`).join(", ")}`
          + (missing.length ? ` (no están en el catálogo: ${missing.join(", ")})` : ""), name);
        await turn.reply(`Le paso tu pedido al equipo de ${context.companyName} para que te confirme precios y disponibilidad. Te respondo por aquí.`);
        return;
      }
      const quote = quoted.data.quote;
      const caption = `Tu cotización N.° ${quote.number} de ${context.companyName}: ${soles(quote.totalCents)} con IGV, válida hasta el `
        + `${quote.validUntil.slice(8, 10)}/${quote.validUntil.slice(5, 7)}. Si quieres confirmarla, dímelo por aquí.`;
      const pdf = await client.quotePdf(companyId, quote.number);
      const sent = pdf.ok ? await turn.sendDocument(new Blob([pdf.data.bytes], { type: "application/pdf" }), pdf.data.filename, caption) : null;
      if (!sent || sent.status !== "sent") await turn.reply(caption);
      return;
    }
    case "ask_team":
    case "complaint":
    case "human": {
      const kind: TicketKind = decision.action === "ask_team" ? "question" : decision.action;
      await ticket(kind, decision.question || turn.text.slice(0, 1000), name);
      await turn.reply(decision.reply || `Le aviso al equipo de ${context.companyName}; te responden por aquí.`);
      return;
    }
  }
}
