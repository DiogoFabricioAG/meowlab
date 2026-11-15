import type { RoleHandler, RoleHandlerContext, TenantContext } from "./contracts";
import type { SupportClient } from "../support/client";
import type { Ticket } from "../support/bridge-contracts";
import type { WhatsAppSendResult } from "../whatsapp/contracts";

export const SUPPORT_ROLE_KEY = "support";
/** While the owner is writing an answer, the next message is that answer. */
export const SUPPORT_SESSION_MS = 30 * 60_000;

export type SupportState = {
  v: 1;
  expiresAt: number;
  companyId: string | null;
  companyName: string | null;
  /** The ticket whose answer the owner is writing. */
  answering: string | null;
};

/** Writes to the customer, who is not in this chat, from the company's number. */
export type SupportOutbound = { sendText(to: string, body: string): Promise<WhatsAppSendResult> };

/** `/support` or `/soporte` (any case) opens the pending cases; `/salir` closes it. */
export const isSupportCommand = (text: string) => /^\/(support|soporte)\b/i.test(text.trim());
const isExitCommand = (text: string) => /^\/(salir|exit)\b/i.test(text.trim()) || /^salir$/i.test(text.trim());
/** The owner's buttons; «support:rate:*» belongs to customers. */
export const isSupportOwnerInteraction = (id: string | null | undefined) => Boolean(id && /^support:(answer|close|open):/.test(id));

export function parseSupportState(json: string | null, now = Date.now()): SupportState | null {
  if (!json) return null;
  try {
    const state = JSON.parse(json) as SupportState;
    return state?.v === 1 && typeof state.expiresAt === "number" && state.expiresAt > now ? state : null;
  } catch {
    return null;
  }
}

const ERROR_TEXT: Record<string, string> = {
  owner_only: "Los casos de Support Cat los responde la titular de la empresa.",
  forbidden: "No tienes Support Cat activo para esa empresa.",
  closed: "Ese caso ya está cerrado.",
  not_found: "No encuentro ese caso.",
};

const ticketLine = (ticket: Ticket) =>
  `#${ticket.number} ${ticket.priority === "high" ? "⚠️ " : ""}${ticket.customerName ?? `+${ticket.customerPhone}`}: «${ticket.question}»`;

/**
 * Support Cat, the owner's side (ADR-0017, points 6–8): the cases the cat could not solve,
 * answered with «Responder»; the answer goes to the customer as written.
 */
export class SupportRoleHandler implements RoleHandler {
  readonly key = SUPPORT_ROLE_KEY;

  constructor(
    private readonly clientFor: (context: RoleHandlerContext) => SupportClient | null,
    private readonly outboundFor: (context: RoleHandlerContext) => SupportOutbound | null,
  ) {}

  configure(tenant: TenantContext): TenantContext {
    return { ...tenant, roleKey: SUPPORT_ROLE_KEY, temperature: 0 };
  }

  async handle(context: RoleHandlerContext): Promise<void> {
    const client = this.clientFor(context);
    const contactId = context.persisted.contactId;
    if (!client || !context.roleState || contactId === null) {
      await context.reply("Support Cat no está disponible en este momento. Inténtalo en unos minutos.");
      return;
    }
    const roleState = context.roleState;
    const tenantId = context.tenant.tenantId;
    let state: SupportState = parseSupportState(await roleState.get(tenantId, contactId, SUPPORT_ROLE_KEY)) ?? {
      v: 1, expiresAt: 0, companyId: null, companyName: null, answering: null,
    };
    const save = async () => {
      state.expiresAt = Date.now() + SUPPORT_SESSION_MS;
      await roleState.set(tenantId, contactId, SUPPORT_ROLE_KEY, JSON.stringify(state));
    };
    const close = async (text: string) => {
      await roleState.clear(tenantId, contactId, SUPPORT_ROLE_KEY);
      await context.reply(text);
    };
    const text = context.message.text.trim();
    const interaction = isSupportOwnerInteraction(context.message.interactionId) ? context.message.interactionId! : null;
    if (!interaction && isExitCommand(text)) {
      await close("Listo, saliste de Support Cat. Escribe /support cuando quieras ver los casos.");
      return;
    }

    if (interaction) {
      const [, action, companyId, ticketId] = interaction.split(":");
      const companies = await client.companies();
      const company = companies.ok ? companies.data.find((candidate) => candidate.id === companyId) : null;
      if (!company) {
        await context.reply(ERROR_TEXT.forbidden);
        return;
      }
      state = { ...state, companyId: company.id, companyName: company.name };
      if (action === "answer") {
        state.answering = ticketId;
        await save();
        await context.reply("Escríbeme la respuesta para el cliente y se la paso tal cual. Escribe /salir para dejarlo para después.");
        return;
      }
      if (action === "close") {
        const closed = await client.closeTicket(company.id, ticketId);
        state.answering = null;
        await save();
        await context.reply(closed.ok ? `Cerré el caso #${closed.data.ticket.number}.` : ERROR_TEXT[closed.code] ?? "No pude cerrarlo. Inténtalo otra vez.");
        return;
      }
      await save();
      await this.open(context, client, state);
      return;
    }

    if (state.answering && state.companyId && text && !isSupportCommand(text)) {
      await this.relay(context, client, state, text);
      state.answering = null;
      await save();
      return;
    }

    if (!state.companyId) {
      const companies = await client.companies();
      if (!companies.ok || !companies.data.length) {
        await close(companies.ok ? "Support Cat todavía no está activo para tu empresa. Escríbele al equipo de MeowLab para activarlo."
          : "No pude revisar tus empresas. Inténtalo en unos minutos.");
        return;
      }
      if (companies.data.length > 1) {
        await save();
        await context.sendList?.("¿De qué empresa quieres ver los casos?", "Elegir empresa", [{
          title: "Empresas",
          rows: companies.data.slice(0, 10).map((company) => ({ id: `support:open:${company.id}`, title: company.name.slice(0, 24) })),
        }]);
        return;
      }
      state = { ...state, companyId: companies.data[0].id, companyName: companies.data[0].name };
    }
    await save();
    await this.open(context, client, state);
  }

  /** The pending cases, the urgent ones first, each with «Responder» and «Cerrar». */
  private async open(context: RoleHandlerContext, client: SupportClient, state: SupportState) {
    const pending = await client.pending(state.companyId!);
    if (!pending.ok) {
      await context.reply(ERROR_TEXT[pending.code] ?? "No pude revisar los casos ahora. Inténtalo en unos minutos.");
      return;
    }
    const open = pending.data.open;
    if (!open.length) {
      await context.reply(`Hola, soy Support Cat de ${pending.data.companyName}. No hay casos pendientes: todo lo que escribieron los clientes quedó atendido.`);
      return;
    }
    await context.reply(`Hola, soy Support Cat de ${pending.data.companyName}. Hay ${open.length} ${open.length === 1 ? "caso pendiente" : "casos pendientes"}:`);
    for (const ticket of open.slice(0, 5)) {
      const body = ticketLine(ticket);
      if (!pending.data.owner) {
        await context.reply(`${body}\n(Los responde la titular.)`);
        continue;
      }
      const sent = await context.sendButtons?.(body, [
        { id: `support:answer:${state.companyId}:${ticket.id}`, title: "Responder" },
        { id: `support:close:${state.companyId}:${ticket.id}`, title: "Cerrar" },
      ]);
      if (!sent || sent.status !== "sent") await context.reply(body);
    }
    if (open.length > 5) await context.reply(`Y ${open.length - 5} más en el portal, en Support Cat.`);
  }

  /** Saves the owner's answer and passes it to the customer as written (point 6). */
  private async relay(context: RoleHandlerContext, client: SupportClient, state: SupportState, answer: string) {
    const saved = await client.answerTicket(state.companyId!, state.answering!, answer);
    if (!saved.ok) {
      await context.reply(ERROR_TEXT[saved.code] ?? "No pude guardar la respuesta. Inténtalo otra vez.");
      return;
    }
    const ticket = saved.data.ticket;
    const outbound = this.outboundFor(context);
    const sent = outbound ? await outbound.sendText(ticket.customerPhone, `De parte del equipo de ${saved.data.companyName}: ${answer}`) : null;
    const relayed = sent?.status === "sent";
    await client.markRelayed(state.companyId!, ticket.id, relayed);
    await context.reply(relayed
      ? `Listo, le pasé tu respuesta a ${ticket.customerName ?? `+${ticket.customerPhone}`} (caso #${ticket.number}).`
      : `Guardé tu respuesta, pero WhatsApp no me deja escribirle a ${ticket.customerName ?? "ese cliente"} porque pasaron más de 24 horas desde su último mensaje. `
        + `Escríbele tú: wa.me/${ticket.customerPhone}`);
  }
}
