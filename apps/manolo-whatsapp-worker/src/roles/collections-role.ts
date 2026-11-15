import type { RoleHandler, RoleHandlerContext, TenantContext } from "./contracts";
import type { CollectionsSettings, PaymentMethod } from "../collections/bridge-contracts";
import type { CollectionsClient, CollectionsOverview, NewDebt, NewPayment } from "../collections/client";
import { extractCollections, type CollectionsExtraction } from "../collections/extractor";
import {
  bucketLines,
  debtLine,
  formatAnswer,
  hasPaymentOptions,
  methodLabel,
  reminderText,
  shortDate,
  soles,
  whatsappLink,
} from "../collections/messages";
import { limaDate } from "../collections/schedule";

export const COLLECTIONS_ROLE_KEY = "collections";
/** While a Collections Cat conversation is open, the next messages stay with it. */
export const COLLECTIONS_SESSION_MS = 30 * 60_000;

type Pending =
  | { kind: "debt"; debt: NewDebt }
  | { kind: "payment"; payment: NewPayment & { customer: string } }
  /** A capture read from an image whose customer is not known yet. */
  | { kind: "capture"; payment: Omit<NewPayment, "customer" | "debtId"> };

export type CollectionsState = {
  v: 1;
  expiresAt: number;
  companyId: string | null;
  companyName: string | null;
  pending: Pending | null;
  /** The customer whose phone is missing to prepare a reminder. */
  awaitingPhone: string | null;
};

/** `/collections` or `/cobranza` (any case) opens Collections Cat; `/salir` closes it. */
export const isCollectionsCommand = (text: string) => /^\/(collections|cobranzas?|cobrar)\b/i.test(text.trim());
const COMMAND = /^\/(collections|cobranzas?|cobrar)\b/i;
const isExitCommand = (text: string) => /^\/(salir|exit)\b/i.test(text.trim()) || /^salir( de cobranzas?)?$/i.test(text.trim());

export function parseCollectionsState(json: string | null, now = Date.now()): CollectionsState | null {
  if (!json) return null;
  try {
    const state = JSON.parse(json) as CollectionsState;
    return state?.v === 1 && typeof state.expiresAt === "number" && state.expiresAt > now ? state : null;
  } catch {
    return null;
  }
}

const HELP = [
  "Soy Collections Cat: llevo lo que te deben y lo cobro por ti. Puedes escribirme, por ejemplo:",
  "• «Juan me debe 200 de los polos, vence el 30»",
  "• «Recuérdale a Juan» (te preparo el mensaje para enviárselo)",
  "• «Juan pagó 100 por Yape», o reenvíame la captura del pago",
  "• «¿Quién me debe más?» · «¿Cuánto me deben?» · «¿Qué me pagaron esta semana?»",
  "• «Mi Yape es 987654321» · «Dales 15 días para pagar» · «Máximo 4 recordatorios»",
  "Las ventas al crédito de Sales Cat y las facturas a crédito de Invoice Cat entran solas.",
  "Escribe /salir para volver con Manolo.",
].join("\n");

const ERROR_TEXT: Record<string, string> = {
  owner_only: "Eso solo lo puede cambiar la titular de la empresa.",
  forbidden: "No tienes Collections Cat activo para esa empresa.",
  invalid_window: "El horario no cuadra: la hora de inicio tiene que ser antes que la de fin.",
};

function failure(code: string, details: unknown, fallback: string): string {
  const customer = (details as { customer?: string } | undefined)?.customer;
  if (code === "not_found") return customer ? `No encontré a «${customer}» entre tus clientes con deuda.` : "No encontré esa deuda.";
  if (code === "no_debt") return customer ? `${customer} no tiene deudas pendientes. 👍` : "Ese cliente no tiene deudas pendientes.";
  if (code === "no_phone") return `No tengo el WhatsApp de ${customer ?? "ese cliente"}. ¿Me lo pasas? Por ejemplo: «el número de ${customer ?? "Juan"} es 987654321».`;
  if (code === "do_not_contact") return `${customer ?? "Ese cliente"} pidió que no le escribamos, así que no le preparo recordatorios. Si cambia, dime «ya puedes escribirle a ${customer ?? "…"}».`;
  if (code === "duplicate_operation") return `Ese número de operación ya está registrado (${(details as { operationNumber?: string } | undefined)?.operationNumber ?? ""}). No lo vuelvo a sumar.`;
  if (code === "already_decided") return "Ese pago ya fue validado o rechazado.";
  return ERROR_TEXT[code] ?? fallback;
}

/**
 * Collections Cat, phase 1 (ADR-0015): the team keeps track of what customers owe, prepares
 * reminders that open in WhatsApp with the customer, forwards captures to validate and asks
 * who owes what. Credit sales and credit invoices come in by themselves.
 */
export class CollectionsRoleHandler implements RoleHandler {
  readonly key = COLLECTIONS_ROLE_KEY;

  constructor(private readonly clientFor: (context: RoleHandlerContext) => CollectionsClient | null) {}

  configure(tenant: TenantContext): TenantContext {
    return { ...tenant, roleKey: COLLECTIONS_ROLE_KEY, temperature: 0 };
  }

  async handle(context: RoleHandlerContext): Promise<void> {
    const client = this.clientFor(context);
    const contactId = context.persisted.contactId;
    if (!client || !context.roleState || contactId === null) {
      await context.reply("Collections Cat no está disponible en este momento. Inténtalo en unos minutos.");
      return;
    }
    const roleState = context.roleState;
    const tenantId = context.tenant.tenantId;
    let state: CollectionsState = parseCollectionsState(await roleState.get(tenantId, contactId, COLLECTIONS_ROLE_KEY)) ?? {
      v: 1, expiresAt: 0, companyId: null, companyName: null, pending: null, awaitingPhone: null,
    };
    const save = async () => {
      state.expiresAt = Date.now() + COLLECTIONS_SESSION_MS;
      await roleState.set(tenantId, contactId, COLLECTIONS_ROLE_KEY, JSON.stringify(state));
    };
    const close = async (text: string) => {
      await roleState.clear(tenantId, contactId, COLLECTIONS_ROLE_KEY);
      await context.reply(text);
    };

    const text = context.message.text.trim();
    const interaction = context.message.interactionId?.startsWith("collections:") ? context.message.interactionId : null;
    if (!interaction && isExitCommand(text)) {
      await close("Listo, saliste de Collections Cat. Escribe /collections cuando quieras volver.");
      return;
    }

    if (interaction?.startsWith("collections:company:")) {
      const companies = await client.companies();
      const chosen = companies.ok ? companies.data.find((company) => company.id === interaction.slice("collections:company:".length)) : null;
      if (chosen) {
        state = { ...state, companyId: chosen.id, companyName: chosen.name, pending: null, awaitingPhone: null };
        await save();
        await this.open(context, client, state, `Trabajemos con ${chosen.name}.`);
        return;
      }
    }
    if (!state.companyId) {
      const companies = await client.companies();
      if (!companies.ok) {
        await context.reply("No pude revisar tus empresas. Inténtalo en unos minutos.");
        return;
      }
      if (companies.data.length === 0) {
        await close("Collections Cat todavía no está activo para tu empresa. Escríbele al equipo de MeowLab para activarlo.");
        return;
      }
      if (companies.data.length > 1) {
        await save();
        await context.sendList?.("¿De qué empresa son las cobranzas?", "Elegir empresa", [{
          title: "Empresas",
          rows: companies.data.slice(0, 10).map((company) => ({ id: `collections:company:${company.id}`, title: company.name.slice(0, 24) })),
        }]);
        return;
      }
      state = { ...state, companyId: companies.data[0].id, companyName: companies.data[0].name };
    }
    const companyId = state.companyId!;

    if (interaction) {
      await save();
      await this.onButton(context, client, state, companyId, interaction, save);
      return;
    }

    const message = text.replace(COMMAND, "").trim();
    const fromImage = Boolean(context.message.hasVisualContext);
    if (!message && !state.pending) {
      await save();
      await this.open(context, client, state, `Hola, soy Collections Cat${state.companyName ? ` de ${state.companyName}` : ""}.`);
      return;
    }
    if (state.pending && state.pending.kind !== "capture" && !fromImage && /^(confirmar|confirmo|s[ií]|guardar|ok|dale)$/i.test(message)) {
      await this.confirm(context, client, state, companyId, save);
      return;
    }
    if (state.pending && !fromImage && /^(cancelar|descartar|no)$/i.test(message)) {
      state.pending = null;
      await save();
      await context.reply("Descartado. ¿Algo más? Escribe /salir para volver con Manolo.");
      return;
    }

    const overview = await client.overview(companyId);
    const extraction = await extractCollections(context.ai, context.tenant, {
      message: message || text,
      fromImage,
      customers: overview.ok ? overview.data.customers : [],
      today: limaDate(new Date()),
    }, context.log);
    if (!extraction) {
      await save();
      await context.reply(fromImage
        ? "No pude leer bien esa captura. ¿Me dices de quién es el pago y cuánto fue?"
        : "No te entendí bien. ¿Me lo dices de otra forma? Por ejemplo: «Juan me debe 200».");
      return;
    }
    // A capture waiting for its customer takes the name from this message.
    if (state.pending?.kind === "capture" && !fromImage && extraction.customer) {
      const payment = { ...state.pending.payment, customer: extraction.customer };
      state.pending = null;
      await save();
      await this.submitCapture(context, client, companyId, payment);
      return;
    }
    await this.onExtraction(context, client, state, companyId, fromImage ? { ...extraction, intent: "capture" } : extraction, save, close);
  }

  /** Greets and says what to do today: reminders due, captures to validate, who needs the owner. */
  private async open(context: RoleHandlerContext, client: CollectionsClient, state: CollectionsState, greeting: string) {
    const overview = await client.overview(state.companyId!);
    if (!overview.ok) {
      await context.reply(`${greeting} No pude revisar tus cobranzas ahora. Inténtalo en unos minutos.`);
      return;
    }
    const data = overview.data;
    const notes: string[] = [];
    if (data.sync.added) notes.push(`Anoté ${data.sync.added} ${data.sync.added === 1 ? "deuda nueva" : "deudas nuevas"} de tus ventas y facturas a crédito.`);
    if (data.sync.creditNotes) notes.push(`Apliqué ${data.sync.creditNotes} ${data.sync.creditNotes === 1 ? "nota de crédito" : "notas de crédito"} a sus facturas.`);
    notes.push(data.totalCents ? `*Te deben ${soles(data.totalCents)}.*\n${bucketLines(data.buckets)}` : "Nadie te debe nada por ahora. 👍");
    if (data.escalated.length) {
      notes.push(`🙋 *Intenta hablar tú con estos clientes* (ya no respondieron a mis recordatorios o pidieron que no les escriba):\n${data.escalated.map(debtLine).join("\n")}`);
    }
    if (!hasPaymentOptions(data.settings)) {
      notes.push("Aún no sé cómo te pagan. Dime, por ejemplo: «mi Yape es 987654321» o «mi cuenta BCP es …».");
    }
    await context.reply(`${greeting}\n\n${notes.join("\n\n")}`);
    for (const pending of data.pending.slice(0, 3)) await this.askToValidate(context, pending);
    if (data.toRemind.length) {
      await context.sendList?.(`📬 Hoy toca recordarle a ${data.toRemind.length} ${data.toRemind.length === 1 ? "cliente" : "clientes"}. Elige y te preparo el mensaje.`,
        "Ver clientes", [{
          title: "Por cobrar hoy",
          rows: data.toRemind.slice(0, 10).map((debt) => ({
            id: `collections:remind:${debt.id}`,
            title: debt.customer.slice(0, 24),
            description: `${soles(debt.balanceCents)} · ${debt.daysLate < 0 ? `vence ${shortDate(debt.dueOn)}` : debt.daysLate === 0 ? "vence hoy" : `${debt.daysLate} días de atraso`}`.slice(0, 72),
          })),
        }]);
    }
    const sent = await context.sendButtons?.("¿Qué hacemos?", [
      { id: "collections:query:top", title: "¿Quién me debe?" },
      { id: "collections:query:paid", title: "Pagos de la semana" },
      { id: "collections:help", title: "¿Qué puedo decirte?" },
    ]);
    if (!sent || sent.status !== "sent") await context.reply(HELP);
  }

  private async askToValidate(context: RoleHandlerContext, pending: { id: string; customer: string; amountCents: number; method: PaymentMethod | string; operationNumber: string | null; paidOn: string }) {
    const body = `🧾 Me mandaron esta captura de *${pending.customer}*: ${soles(pending.amountCents)} por ${methodLabel(pending.method)}`
      + `${pending.operationNumber ? `, operación ${pending.operationNumber}` : ""}, del ${shortDate(pending.paidOn)}. ¿La validas?`;
    const sent = await context.sendButtons?.(body, [
      { id: `collections:approve:${pending.id}`, title: "Validar" },
      { id: `collections:reject:${pending.id}`, title: "Rechazar" },
    ]);
    if (!sent || sent.status !== "sent") await context.reply(`${body}\n\nRevísala en tu Yape o banco y escribe /collections para validarla.`);
  }

  private async onButton(context: RoleHandlerContext, client: CollectionsClient, state: CollectionsState, companyId: string, interaction: string,
    save: () => Promise<void>) {
    if (interaction === "collections:confirm") {
      await this.confirm(context, client, state, companyId, save);
      return;
    }
    if (interaction === "collections:cancel") {
      state.pending = null;
      await save();
      await context.reply("Descartado. ¿Algo más?");
      return;
    }
    if (interaction === "collections:help") {
      await context.reply(HELP);
      return;
    }
    if (interaction === "collections:query:top" || interaction === "collections:query:paid") {
      const type = interaction === "collections:query:top" ? "top" : "paid";
      const answer = await client.query(companyId, type, type === "paid" ? "week" : undefined);
      await context.reply(answer.ok ? formatAnswer(answer.data) : "No pude consultar tus cobranzas ahora. Inténtalo en unos minutos.");
      return;
    }
    const [, action, id] = interaction.split(":");
    if (action === "remind" && id) {
      await this.remind(context, client, state, companyId, { debtId: id }, save);
      return;
    }
    if ((action === "approve" || action === "reject") && id) {
      const result = await client.decidePayment(companyId, id, action === "approve");
      if (!result.ok) {
        await context.reply(failure(result.code, result.details, "No pude registrar tu decisión. Inténtalo otra vez."));
        return;
      }
      if (!result.data.approved) {
        await context.reply(`Rechazada. No sumé ese pago a ${result.data.customer}.`);
        return;
      }
      await context.reply(this.appliedText(result.data));
      return;
    }
    await context.reply("Ese botón ya no aplica. Escribe /collections para empezar de nuevo.");
  }

  private appliedText(data: { customer: string; applied: Array<{ amountCents: number }>; leftoverCents: number; customerBalanceCents: number }) {
    const paid = data.applied.reduce((total, entry) => total + entry.amountCents, 0);
    return [
      `✅ Registré ${soles(paid)} de ${data.customer}.`,
      data.customerBalanceCents ? `Aún debe ${soles(data.customerBalanceCents)}.` : "Ya no debe nada. 🎉",
      data.leftoverCents ? `Sobran ${soles(data.leftoverCents)} que no correspondían a ninguna deuda; revísalo con el cliente.` : "",
    ].filter(Boolean).join(" ");
  }

  private async onExtraction(context: RoleHandlerContext, client: CollectionsClient, state: CollectionsState, companyId: string,
    extraction: CollectionsExtraction, save: () => Promise<void>, close: (text: string) => Promise<void>) {
    await save();
    switch (extraction.intent) {
      case "exit":
        await close("Listo, saliste de Collections Cat. Escribe /collections cuando quieras volver.");
        return;
      case "help":
      case "other":
        await context.reply(extraction.intent === "help" ? HELP : extraction.reply || HELP);
        return;
      case "add_debt": {
        if (!extraction.customer || !extraction.amount) {
          await context.reply(extraction.reply || "¿Quién te debe y cuánto?");
          return;
        }
        const debt: NewDebt = {
          customer: extraction.customer, amountCents: Math.round(extraction.amount * 100), description: extraction.description,
          dueOn: extraction.dueOn, phone: extraction.phone, docNumber: extraction.docNumber,
        };
        state.pending = { kind: "debt", debt };
        await save();
        await this.askConfirm(context, [
          "*Nueva deuda*",
          `• ${debt.customer}: ${soles(debt.amountCents)}${debt.description ? ` (${debt.description})` : ""}`,
          debt.dueOn ? `• Vence el ${shortDate(debt.dueOn)}` : "• Vence en los días que das para pagar",
          debt.phone ? `• WhatsApp: ${debt.phone}` : "",
        ]);
        return;
      }
      case "payment": {
        if (!extraction.customer || !extraction.amount) {
          await context.reply(extraction.reply || "¿Quién pagó y cuánto?");
          return;
        }
        const payment = {
          customer: extraction.customer, amountCents: Math.round(extraction.amount * 100), method: extraction.method ?? "efectivo",
          paidOn: extraction.paidOn, operationNumber: extraction.operationNumber, fromCapture: false,
        };
        state.pending = { kind: "payment", payment };
        await save();
        await this.askConfirm(context, [
          "*Pago recibido*",
          `• ${payment.customer}: ${soles(payment.amountCents)} por ${methodLabel(payment.method)}${payment.paidOn ? ` el ${shortDate(payment.paidOn)}` : ""}`,
        ]);
        return;
      }
      case "capture": {
        if (!extraction.amount) {
          await context.reply("No pude leer el monto de esa captura. ¿Cuánto pagó y quién?");
          return;
        }
        const payment = {
          amountCents: Math.round(extraction.amount * 100), method: extraction.method ?? "yape", paidOn: extraction.paidOn,
          operationNumber: extraction.operationNumber, fromCapture: true,
        };
        if (!extraction.customer) {
          state.pending = { kind: "capture", payment };
          await save();
          await context.reply(`Leí un pago de ${soles(payment.amountCents)} por ${methodLabel(payment.method)}. ¿De qué cliente es?`);
          return;
        }
        await this.submitCapture(context, client, companyId, { ...payment, customer: extraction.customer });
        return;
      }
      case "remind": {
        if (!extraction.customer) {
          await context.reply("¿A quién le recuerdo?");
          return;
        }
        await this.remind(context, client, state, companyId, { customer: extraction.customer }, save);
        return;
      }
      case "set_phone": {
        const customer = extraction.customer ?? state.awaitingPhone;
        if (!customer || !extraction.phone) {
          await context.reply("¿De qué cliente es y cuál es su número? Por ejemplo: «el número de Juan es 987654321».");
          return;
        }
        const result = await client.setCustomer(companyId, customer, { phone: extraction.phone });
        if (!result.ok) {
          await context.reply(failure(result.code, result.details, "No pude guardar el número. Inténtalo otra vez."));
          return;
        }
        await context.reply(`Anotado el WhatsApp de ${result.data.customer.name}.`);
        if (state.awaitingPhone) {
          const target = state.awaitingPhone;
          state.awaitingPhone = null;
          await save();
          await this.remind(context, client, state, companyId, { customer: target }, save);
        }
        return;
      }
      case "do_not_contact":
      case "allow_contact": {
        if (!extraction.customer) {
          await context.reply("¿De qué cliente se trata?");
          return;
        }
        const result = await client.setCustomer(companyId, extraction.customer, { doNotContact: extraction.intent === "do_not_contact" });
        await context.reply(!result.ok ? failure(result.code, result.details, "No pude guardarlo. Inténtalo otra vez.")
          : result.data.customer.doNotContact
            ? `Listo: no le prepararé más recordatorios a ${result.data.customer.name}. Te lo dejo en «Intenta hablar con estos clientes».`
            : `Listo: puedo volver a recordarle a ${result.data.customer.name}.`);
        return;
      }
      case "settings": {
        const change = Object.fromEntries(Object.entries(extraction.settings).filter(([, value]) => value !== null)) as Partial<CollectionsSettings>;
        if (!Object.keys(change).length) {
          await context.reply(extraction.reply || "¿Qué quieres cambiar? Por ejemplo: «mi Yape es 987654321» o «dales 15 días para pagar».");
          return;
        }
        const result = await client.settings(companyId, change);
        await context.reply(!result.ok ? failure(result.code, result.details, "No pude guardar el cambio. Inténtalo otra vez.")
          : `Listo. ${settingsSummary(result.data.settings)}`);
        return;
      }
      case "query": {
        const type = extraction.queryType ?? "owed";
        const answer = await client.query(companyId, type, type === "paid" ? extraction.period ?? "week" : undefined);
        await context.reply(answer.ok ? formatAnswer(answer.data) : failure(answer.code, answer.details, "No pude consultar tus cobranzas ahora."));
        return;
      }
    }
  }

  private async askConfirm(context: RoleHandlerContext, lines: string[]) {
    const summary = lines.filter(Boolean).join("\n");
    const sent = await context.sendButtons?.(summary, [
      { id: "collections:confirm", title: "Guardar" },
      { id: "collections:cancel", title: "Cancelar" },
    ]);
    if (!sent || sent.status !== "sent") await context.reply(`${summary}\n\nResponde *confirmar* para guardar o *cancelar*.`);
  }

  /** A capture is registered as pending and someone validates it (ADR-0015, point 10). */
  private async submitCapture(context: RoleHandlerContext, client: CollectionsClient, companyId: string, payment: NewPayment & { customer: string }) {
    const result = await client.recordPayment(companyId, payment);
    if (!result.ok) {
      await context.reply(failure(result.code, result.details, "No pude registrar la captura. Inténtalo otra vez."));
      return;
    }
    if ("pending" in result.data) await this.askToValidate(context, result.data.pending);
  }

  /** Prepares the reminder and a button that opens WhatsApp with the customer (phase 1). */
  private async remind(context: RoleHandlerContext, client: CollectionsClient, state: CollectionsState, companyId: string,
    target: { debtId?: string; customer?: string }, save: () => Promise<void>) {
    const result = await client.remind(companyId, target);
    if (!result.ok) {
      if (result.code === "no_phone") {
        state.awaitingPhone = (result.details as { customer?: string } | undefined)?.customer ?? target.customer ?? null;
        await save();
      }
      await context.reply(failure(result.code, result.details, "No pude preparar el recordatorio. Inténtalo otra vez."));
      return;
    }
    const reminder = result.data;
    const text = reminderText(reminder);
    const notes = [
      reminder.outsideWindow ? "Ahora está fuera de tu horario de cobranza: mejor envíalo mañana en la mañana." : "",
      reminder.lastReminder ? "Es el último recordatorio que preparo para esta deuda; si no responde, te lo paso a ti." : "",
    ].filter(Boolean).join(" ");
    const body = `Este es el mensaje para ${reminder.debt.customer}:\n\n${text}${notes ? `\n\n${notes}` : ""}`.slice(0, 1024);
    const link = whatsappLink(reminder.debt.phone!, text);
    const sent = await context.sendCtaUrl?.(body, "Enviar por WhatsApp", link);
    if (!sent || sent.status !== "sent") await context.reply(`${body}\n\nÁbrelo aquí para enviarlo: ${link}`);
  }

  private async confirm(context: RoleHandlerContext, client: CollectionsClient, state: CollectionsState, companyId: string, save: () => Promise<void>) {
    const pending = state.pending;
    if (!pending || pending.kind === "capture") {
      await context.reply("No hay nada pendiente de guardar. Cuéntame quién te debe o quién pagó.");
      return;
    }
    if (pending.kind === "debt") {
      const result = await client.addDebt(companyId, pending.debt);
      if (!result.ok) {
        await context.reply(failure(result.code, result.details, "No pude guardarla. Inténtalo otra vez."));
        return;
      }
      state.pending = null;
      await save();
      const debt = result.data.debt;
      await context.reply(`Guardado: ${debt.customer} te debe ${soles(debt.balanceCents)}, vence el ${shortDate(debt.dueOn)}.`
        + `${result.data.customerBalanceCents > debt.balanceCents ? ` En total te debe ${soles(result.data.customerBalanceCents)}.` : ""}`
        + `${debt.phone ? "" : ` Si me pasas su WhatsApp, le preparo los recordatorios.`}`);
      return;
    }
    const result = await client.recordPayment(companyId, pending.payment);
    if (!result.ok) {
      await context.reply(failure(result.code, result.details, "No pude guardar el pago. Inténtalo otra vez."));
      return;
    }
    state.pending = null;
    await save();
    if ("applied" in result.data) await context.reply(this.appliedText(result.data));
  }
}

function settingsSummary(settings: CollectionsSettings): string {
  const methods = [
    settings.yapePhone ? `Yape ${settings.yapePhone}` : "", settings.plinPhone ? `Plin ${settings.plinPhone}` : "",
    settings.bankText ? "transferencia" : "", settings.paymentLink ? "enlace de pago" : "",
  ].filter(Boolean);
  return [
    `Formas de pago: ${methods.length ? methods.join(", ") : "ninguna todavía"}.`,
    `Doy ${settings.defaultDueDays} días para pagar, recuerdo ${settings.remindBeforeDays} días antes, el día que vence y cada ${settings.remindEveryDays} días, hasta ${settings.maxReminders} veces,`,
    `de ${settings.windowStartHour}:00 a ${settings.windowEndHour}:00${settings.skipSundays ? " y nunca los domingos" : ""}.`,
  ].join(" ");
}
