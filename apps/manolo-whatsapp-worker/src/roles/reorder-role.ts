import type { RoleHandler, RoleHandlerContext, TenantContext } from "./contracts";
import type { OrderSummary, ReorderSettings } from "../reorder/bridge-contracts";
import type { ReorderAnswer, ReorderClient, ReorderOverview } from "../reorder/client";
import { extractReorder, type ReorderExtraction } from "../reorder/extractor";
import { SUPPLIER_TEMPLATE, openLine, orderCode, orderText, quantityText, soles, supplierTemplateParameters } from "../reorder/messages";
import type { StockClient } from "../stock/client";
import type { WhatsAppSendResult } from "../whatsapp/contracts";

export const REORDER_ROLE_KEY = "reorder";
/** While a Reorder Cat conversation is open, the next messages stay with it. */
export const REORDER_SESSION_MS = 30 * 60_000;

export type ReorderState = {
  v: 1;
  expiresAt: number;
  companyId: string | null;
  companyName: string | null;
  /** The proposal whose quantities the owner is changing. */
  editing: string | null;
};

/** Writes to someone who is not in this chat: the supplier, from MeowLab's number (ADR-0016, point 7). */
export type ReorderOutbound = {
  phoneNumberId: string;
  sendTemplate(to: string, template: string, language: string, parameters: readonly string[]): Promise<WhatsAppSendResult>;
};

const HELP = [
  "Soy Reorder Cat: cuando algo baja de su mínimo te propongo el pedido; tú lo apruebas y yo se lo pido al proveedor, insisto si no responde y te aviso.",
  "Puedes decirme, por ejemplo:",
  "• «El máximo de polos blancos es 100»",
  "• «Los polos me los vende Textiles Lima, 987654321»",
  "• «Los polos estampados los hacemos nosotros»",
  "• «Mi presupuesto de compras es 3000 al mes»",
  "• «¿Qué está por llegar?» o «¿Cuánto compré este mes?»",
  "Lo que llega lo registras en /stock y yo lo cruzo con el pedido.",
  "Escribe /salir para volver con Manolo.",
].join("\n");

const ERROR_TEXT: Record<string, string> = {
  owner_only: "Eso solo lo puede decidir la titular de la empresa.",
  forbidden: "No tienes Reorder Cat activo para esa empresa.",
  not_proposed: "Ese pedido ya no está por aprobar.",
  item_not_found: "No encuentro ese producto en el inventario de Stock Cat.",
  line_not_found: "No encuentro ese producto en el pedido.",
  invalid_settings: "La hora de escalar tiene que ser mayor que la de insistir.",
};

/** `/reorder`, `/reposicion` or `/pedidos` (any case) opens Reorder Cat; `/salir` closes it. */
export const isReorderCommand = (text: string) => /^\/(reorder|reposici[oó]n|pedidos)\b/i.test(text.trim());
const isExitCommand = (text: string) => /^\/(salir|exit)\b/i.test(text.trim()) || /^salir$/i.test(text.trim());

export function parseReorderState(json: string | null, now = Date.now()): ReorderState | null {
  if (!json) return null;
  try {
    const state = JSON.parse(json) as ReorderState;
    return state?.v === 1 && typeof state.expiresAt === "number" && state.expiresAt > now ? state : null;
  } catch {
    return null;
  }
}

function answerText(answer: ReorderAnswer): string {
  if ("pending" in answer) {
    return answer.pending.length ? `*Pedido y por llegar:*\n${answer.pending.map(openLine).join("\n")}` : "No hay nada pedido por llegar.";
  }
  if (!answer.month.length) return "Este mes todavía no se aprobó ninguna compra.";
  return [
    `*Compras de este mes: ${soles(answer.totalCents)}*${answer.budgetCents ? ` de ${soles(answer.budgetCents)} de presupuesto` : ""}`,
    ...answer.month.map((row) => `• ${row.supplier}: ${soles(row.totalCents)} (${row.orders} ${row.orders === 1 ? "pedido" : "pedidos"})`),
  ].join("\n");
}

/**
 * Reorder Cat, phase 1 (ADR-0016): proposes what to order when something runs low, the
 * owner approves, and the order goes to the supplier with MeowLab's template. The supplier's
 * answers and the follow-ups are handled outside this chat (reorder/supplier.ts, the cron).
 */
export class ReorderRoleHandler implements RoleHandler {
  readonly key = REORDER_ROLE_KEY;

  constructor(
    private readonly clientFor: (context: RoleHandlerContext) => ReorderClient | null,
    private readonly outboundFor: (context: RoleHandlerContext) => ReorderOutbound | null,
    /** Production finished goes into Stock Cat as an entry (ADR-0016, point 14). */
    private readonly stockFor: (context: RoleHandlerContext) => StockClient | null = () => null,
  ) {}

  configure(tenant: TenantContext): TenantContext {
    return { ...tenant, roleKey: REORDER_ROLE_KEY, temperature: 0 };
  }

  async handle(context: RoleHandlerContext): Promise<void> {
    const client = this.clientFor(context);
    const contactId = context.persisted.contactId;
    if (!client || !context.roleState || contactId === null) {
      await context.reply("Reorder Cat no está disponible en este momento. Inténtalo en unos minutos.");
      return;
    }
    const roleState = context.roleState;
    const tenantId = context.tenant.tenantId;
    let state: ReorderState = parseReorderState(await roleState.get(tenantId, contactId, REORDER_ROLE_KEY)) ?? {
      v: 1, expiresAt: 0, companyId: null, companyName: null, editing: null,
    };
    const save = async () => {
      state.expiresAt = Date.now() + REORDER_SESSION_MS;
      await roleState.set(tenantId, contactId, REORDER_ROLE_KEY, JSON.stringify(state));
    };
    const close = async (text: string) => {
      await roleState.clear(tenantId, contactId, REORDER_ROLE_KEY);
      await context.reply(text);
    };

    const text = context.message.text.trim();
    const interaction = context.message.interactionId?.startsWith("reorder:") ? context.message.interactionId : null;
    if (!interaction && isExitCommand(text)) {
      await close("Listo, saliste de Reorder Cat. Escribe /reorder cuando quieras volver.");
      return;
    }

    if (interaction?.startsWith("reorder:company:")) {
      const companies = await client.companies();
      const chosen = companies.ok ? companies.data.find((company) => company.id === interaction.slice("reorder:company:".length)) : null;
      if (chosen) {
        state = { ...state, companyId: chosen.id, companyName: chosen.name, editing: null };
        await save();
        await this.open(context, client, state);
        return;
      }
    }
    // The Stock Cat alert's button names the company it came from.
    const fromAlert = interaction?.startsWith("reorder:open:") ? interaction.slice("reorder:open:".length) : null;
    if (!state.companyId || (fromAlert && fromAlert !== state.companyId)) {
      const companies = await client.companies();
      if (!companies.ok) {
        await context.reply("No pude revisar tus empresas. Inténtalo en unos minutos.");
        return;
      }
      const preferred = fromAlert ? companies.data.find((company) => company.id === fromAlert) : null;
      if (!preferred && companies.data.length === 0) {
        await close("Reorder Cat todavía no está activo para tu empresa. Escríbele al equipo de MeowLab para activarlo.");
        return;
      }
      if (!preferred && companies.data.length > 1) {
        await save();
        await context.sendList?.("¿Para qué empresa son los pedidos?", "Elegir empresa", [{
          title: "Empresas",
          rows: companies.data.slice(0, 10).map((company) => ({ id: `reorder:company:${company.id}`, title: company.name.slice(0, 24) })),
        }]);
        return;
      }
      const company = preferred ?? companies.data[0];
      state = { ...state, companyId: company.id, companyName: company.name, editing: null };
    }
    const companyId = state.companyId!;

    if (interaction) {
      await save();
      await this.onButton(context, client, state, companyId, interaction, save);
      return;
    }

    const message = text.replace(/^\/(reorder|reposici[oó]n|pedidos)\b/i, "").trim();
    if (!message) {
      state.editing = null;
      await save();
      await this.open(context, client, state);
      return;
    }

    const overview = await client.overview(companyId);
    const products = overview.ok ? [...new Set([...overview.data.proposals, ...overview.data.open].flatMap((order) => order.lines.map((line) => line.item))
      .concat(overview.data.needsMax, overview.data.needsSupplier))] : [];
    const extraction = await extractReorder(context.ai, context.tenant, { message, products }, context.log);
    await save();
    if (!extraction) {
      await context.reply("No te entendí bien. ¿Me lo dices de otra forma? Por ejemplo: «el máximo de polos blancos es 100».");
      return;
    }
    await this.onExtraction(context, client, state, companyId, extraction, save, close);
  }

  /** What needs the owner now: notices, proposals to approve, missing data and what is on its way. */
  private async open(context: RoleHandlerContext, client: ReorderClient, state: ReorderState) {
    const companyId = state.companyId!;
    const result = await client.overview(companyId);
    if (!result.ok) {
      await context.reply(ERROR_TEXT[result.code] ?? "No pude revisar los pedidos ahora. Inténtalo en unos minutos.");
      return;
    }
    const overview = result.data;
    const header = `Hola, soy Reorder Cat${state.companyName ? ` de ${state.companyName}` : ""}.`;
    const notes: string[] = [];
    if (overview.notices.length) {
      notes.push(`*Novedades:*\n${overview.notices.map((notice) => `• ${notice.body}`).join("\n")}`);
      await client.noticesDelivered(companyId, overview.notices.map((notice) => notice.id));
    }
    if (overview.needsMax.length) {
      notes.push(`Se acaban y no sé hasta cuánto pedir: ${overview.needsMax.join(", ")}. Dime, por ejemplo: «el máximo de ${overview.needsMax[0]} es 100».`);
    }
    if (overview.needsSupplier.length) {
      notes.push(`Se acaban y no tengo a quién pedírselos: ${overview.needsSupplier.join(", ")}. Dime quién te los vende y su WhatsApp, `
        + "por ejemplo: «me los vende Textiles Lima, 987654321», o si los hacen ustedes.");
    }
    if (overview.open.length) notes.push(`*En curso:*\n${overview.open.slice(0, 10).map(openLine).join("\n")}`);
    if (overview.settings.monthlyBudgetCents) {
      notes.push(`Compras de este mes: ${soles(overview.monthSpentCents)} de ${soles(overview.settings.monthlyBudgetCents)}.`);
    }
    if (!overview.proposals.length && !notes.length) {
      await context.reply(`${header} Todo en orden: no hay nada que pedir. Te propongo el pedido cuando algo baje de su mínimo en Stock Cat.`);
      return;
    }
    await context.reply([header, ...notes].join("\n\n"));
    await this.showProposals(context, overview);
  }

  private async showProposals(context: RoleHandlerContext, overview: ReorderOverview) {
    if (!overview.proposals.length) return;
    const shown = overview.proposals.slice(0, 3);
    for (const order of shown) {
      const body = `${orderText(order)}${overview.owner ? "" : "\n\nLo aprueba la titular."}`;
      if (!overview.owner) {
        await context.reply(body);
        continue;
      }
      const buttons = [
        { id: `reorder:approve:${order.id}`, title: order.kind === "production" ? "Producir" : "Aprobar y pedir" },
        { id: `reorder:change:${order.id}`, title: "Cambiar" },
        { id: `reorder:discard:${order.id}`, title: "Descartar" },
      ];
      const sent = await context.sendButtons?.(body, buttons);
      if (!sent || sent.status !== "sent") await context.reply(`${body}\n\nResponde /reorder para verlo con botones.`);
    }
    if (overview.proposals.length > shown.length) {
      await context.reply(`Hay ${overview.proposals.length - shown.length} pedidos más por aprobar; los verás al decidir estos o en el portal.`);
    }
  }

  private async onButton(context: RoleHandlerContext, client: ReorderClient, state: ReorderState, companyId: string,
    interaction: string, save: () => Promise<void>) {
    const [, action, orderId] = interaction.split(":");
    switch (action) {
      case "open":
      case "company":
        state.editing = null;
        await save();
        await this.open(context, client, state);
        return;
      case "approve":
      case "force":
        await this.approve(context, client, state, companyId, orderId, action === "force");
        return;
      case "discard": {
        const result = await client.discard(companyId, orderId);
        await context.reply(result.ok ? `Descartado el ${orderCode(result.data.order.number)}. Te lo vuelvo a proponer si sigue bajo el mínimo.`
          : ERROR_TEXT[result.code] ?? "No pude descartarlo. Inténtalo otra vez.");
        return;
      }
      case "change":
        state.editing = orderId;
        await save();
        await context.reply("¿Qué cambio? Por ejemplo: «solo 30 polos blancos» o «quita las tazas».");
        return;
      case "later":
        await context.reply("Listo, lo dejo por aprobar.");
        return;
      default:
        await this.open(context, client, state);
    }
  }

  /**
   * The owner approves (point 6): a production order starts; a purchase goes to the
   * supplier with the template from MeowLab's number, then the PDF comes back here.
   */
  private async approve(context: RoleHandlerContext, client: ReorderClient, state: ReorderState, companyId: string, orderId: string, force: boolean) {
    const result = await client.approve(companyId, orderId, force);
    if (!result.ok) {
      if (result.code === "over_budget") {
        const details = result.details as { spentCents: number; budgetCents: number; orderCents: number };
        const body = `Este pedido (${soles(details.orderCents)}) pasa tu presupuesto del mes: llevas ${soles(details.spentCents)} de ${soles(details.budgetCents)}. ¿Lo apruebo igual?`;
        const sent = await context.sendButtons?.(body, [
          { id: `reorder:force:${orderId}`, title: "Aprobar igual" },
          { id: `reorder:later:${orderId}`, title: "Ahora no" },
        ]);
        if (!sent || sent.status !== "sent") await context.reply(body);
        return;
      }
      if (result.code === "no_phone") {
        const supplier = (result.details as { supplier?: string } | undefined)?.supplier ?? "el proveedor";
        await context.reply(`No tengo el WhatsApp de ${supplier}. Dímelo, por ejemplo: «el WhatsApp de ${supplier} es 987654321», y lo vuelvo a intentar.`);
        return;
      }
      await context.reply(ERROR_TEXT[result.code] ?? "No pude aprobarlo. Inténtalo otra vez.");
      return;
    }
    const order = result.data.order;
    if (order.kind === "production") {
      await context.reply(`Listo: orden de producción ${orderCode(order.number)} para ${order.lines.map((line) => `${quantityText(line.quantity)} ${line.item}`).join(", ")}. `
        + "Cuando estén listos dime, por ejemplo, «terminamos 50 polos estampados» y los sumo al stock.");
      return;
    }
    const outbound = this.outboundFor(context);
    const supplier = order.supplier!;
    const sent = outbound
      ? await outbound.sendTemplate(supplier.phone!, SUPPLIER_TEMPLATE.name, SUPPLIER_TEMPLATE.language, supplierTemplateParameters(order, result.data.companyName))
      : null;
    const ok = sent?.status === "sent";
    await client.markSent(companyId, order.id, ok, outbound?.phoneNumberId ?? context.tenant.phoneNumberId);
    if (!ok) {
      context.log("whatsapp_reorder_template_failed", { status: sent?.status ?? "no_outbound" });
      const body = `No pude enviarle el pedido a ${supplier.name} por WhatsApp. Quedó aprobado; vuelve a intentarlo en unos minutos.`;
      const retry = await context.sendButtons?.(body, [{ id: `reorder:approve:${order.id}`, title: "Reintentar" }]);
      if (!retry || retry.status !== "sent") await context.reply(body);
      return;
    }
    const pdf = await client.orderPdf(companyId, order.id);
    const summary = `Listo: le pedí a ${supplier.name} ${order.lines.map((line) => `${quantityText(line.quantity)} ${line.item}`).join(", ")} (${orderCode(order.number)}). `
      + "Te aviso cuando responda; si no contesta, le insisto mañana.";
    if (pdf.ok) {
      const document = await context.sendDocument({ pdf: new Blob([pdf.data.bytes], { type: "application/pdf" }), filename: pdf.data.filename, caption: summary });
      if (document.status === "sent") return;
    }
    await context.reply(summary);
  }

  private async onExtraction(context: RoleHandlerContext, client: ReorderClient, state: ReorderState, companyId: string,
    extraction: ReorderExtraction, save: () => Promise<void>, close: (text: string) => Promise<void>) {
    switch (extraction.intent) {
      case "exit":
        await close("Listo, saliste de Reorder Cat. Escribe /reorder cuando quieras volver.");
        return;
      case "help":
        await context.reply(HELP);
        return;
      case "other":
        await context.reply(extraction.reply || HELP);
        return;
      case "review":
        await this.open(context, client, state);
        return;
      case "set_max": {
        if (!extraction.item || !extraction.quantity) {
          await context.reply("¿De qué producto y hasta cuánto lo lleno? Por ejemplo: «el máximo de polos blancos es 100».");
          return;
        }
        const result = await client.setRule(companyId, extraction.item, { maxQty: extraction.quantity });
        if (!result.ok) {
          await context.reply(ERROR_TEXT[result.code] ?? "No pude guardarlo. Inténtalo otra vez.");
          return;
        }
        const rule = result.data.rule;
        await context.reply(`Listo: cuando ${rule.item} baje de su mínimo pediré hasta tener ${quantityText(rule.maxQty ?? extraction.quantity)} (hay ${quantityText(rule.onHand)}).`
          + (rule.minQty === null ? " Ojo: no tiene mínimo en Stock Cat; ponlo con /stock." : ""));
        await this.afterRuleChange(context, client, companyId);
        return;
      }
      case "set_supplier": {
        if (!extraction.supplier) {
          await context.reply("¿Cómo se llama el proveedor y cuál es su WhatsApp?");
          return;
        }
        const items = extraction.items.length ? extraction.items : extraction.item ? [extraction.item] : [];
        const result = await client.setSupplier(companyId, {
          name: extraction.supplier.name,
          ...(extraction.supplier.phone ? { phone: extraction.supplier.phone } : {}),
          ...(extraction.supplier.ruc ? { ruc: extraction.supplier.ruc } : {}),
          ...(items.length ? { items } : {}),
        });
        if (!result.ok) {
          await context.reply(ERROR_TEXT[result.code] ?? "No pude guardar el proveedor. Inténtalo otra vez.");
          return;
        }
        const { supplier, linked, notFound } = result.data;
        await context.reply([
          `Anotado: ${supplier.name}${supplier.phone ? ` (WhatsApp +${supplier.phone})` : ""}${linked.length ? ` te vende ${linked.join(", ")}` : ""}.`,
          supplier.phone ? null : `Me falta su WhatsApp para poder pedirle. Dime: «el WhatsApp de ${supplier.name} es 987654321».`,
          notFound.length ? `No encuentro en el inventario: ${notFound.join(", ")}.` : null,
        ].filter(Boolean).join(" "));
        await this.afterRuleChange(context, client, companyId);
        return;
      }
      case "manufacture":
      case "purchase": {
        if (!extraction.item) {
          await context.reply("¿Qué producto?");
          return;
        }
        const result = await client.setRule(companyId, extraction.item, { supplyType: extraction.intent });
        if (!result.ok) {
          await context.reply(ERROR_TEXT[result.code] ?? "No pude guardarlo. Inténtalo otra vez.");
          return;
        }
        await context.reply(extraction.intent === "manufacture"
          ? `Listo: ${result.data.rule.item} lo producen ustedes. Cuando se acabe te propongo una orden de producción.`
          : `Listo: ${result.data.rule.item} se compra${result.data.rule.supplier ? ` a ${result.data.rule.supplier}` : ""}.`);
        await this.afterRuleChange(context, client, companyId);
        return;
      }
      case "set_budget": {
        if (!extraction.budget && !extraction.removeBudget) {
          await context.reply("¿Cuánto es tu presupuesto mensual de compras?");
          return;
        }
        const change: Partial<ReorderSettings> = { monthlyBudgetCents: extraction.removeBudget ? null : Math.round(extraction.budget! * 100) };
        const result = await client.settings(companyId, change);
        await context.reply(!result.ok ? ERROR_TEXT[result.code] ?? "No pude guardarlo. Inténtalo otra vez."
          : result.data.settings.monthlyBudgetCents
            ? `Listo: presupuesto de compras de ${soles(result.data.settings.monthlyBudgetCents)} al mes. Si un pedido lo pasa, te pregunto antes.`
            : "Listo: sin presupuesto de compras.");
        return;
      }
      case "change_quantity": {
        if (!state.editing) {
          await context.reply("¿De qué pedido? Abre /reorder y toca «Cambiar» en el pedido.");
          return;
        }
        if (!extraction.item || extraction.quantity === null) {
          await context.reply("¿Qué producto y cuántos? Por ejemplo: «solo 30 polos blancos».");
          return;
        }
        const result = await client.changeLine(companyId, state.editing, extraction.item, extraction.quantity);
        if (!result.ok) {
          await context.reply(ERROR_TEXT[result.code] ?? "No pude cambiarlo. Inténtalo otra vez.");
          return;
        }
        const order = result.data.order;
        if (order.status === "cancelled") {
          state.editing = null;
          await save();
          await context.reply(`Quedó vacío, así que descarté el ${orderCode(order.number)}.`);
          return;
        }
        const sent = await context.sendButtons?.(orderText(order), [
          { id: `reorder:approve:${order.id}`, title: order.kind === "production" ? "Producir" : "Aprobar y pedir" },
          { id: `reorder:change:${order.id}`, title: "Cambiar" },
          { id: `reorder:discard:${order.id}`, title: "Descartar" },
        ]);
        if (!sent || sent.status !== "sent") await context.reply(orderText(order));
        return;
      }
      case "produced": {
        const stock = this.stockFor(context);
        if (!extraction.produced.length || !stock) {
          await context.reply(stock ? "¿Qué terminaron y cuántos? Por ejemplo: «terminamos 50 polos estampados»."
            : "Regístralo en /stock como entrada y yo cierro la orden de producción.");
          return;
        }
        const moved = await stock.move(companyId, "in", extraction.produced.map((line) => ({ name: line.name, quantity: line.quantity })), "Producción terminada");
        if (!moved.ok) {
          await context.reply("No pude sumarlo al stock. Regístralo en /stock como entrada.");
          return;
        }
        const receptions = moved.data.received ?? [];
        await context.reply([
          `Sumé al stock: ${moved.data.moved.map((move) => `${move.name} (quedan ${quantityText(move.onHand)})`).join(", ")}.`,
          ...receptions.map((reception) => reception.complete
            ? `La orden ${orderCode(reception.number)} quedó terminada.`
            : `De la orden ${orderCode(reception.number)} falta: ${reception.missing.map((line) => `${quantityText(line.quantity)} ${line.item}`).join(", ")}.`),
        ].join("\n"));
        return;
      }
      case "query": {
        const result = await client.query(companyId, extraction.queryType ?? "pending");
        await context.reply(result.ok ? answerText(result.data) : ERROR_TEXT[result.code] ?? "No pude consultarlo ahora. Inténtalo en unos minutos.");
        return;
      }
    }
  }

  /** A rule changed: whatever can be proposed now is shown right away. */
  private async afterRuleChange(context: RoleHandlerContext, client: ReorderClient, companyId: string) {
    const overview = await client.overview(companyId);
    if (overview.ok && overview.data.created.length) await this.showProposals(context, { ...overview.data, proposals: overview.data.created });
  }
}

/** Sent after Stock Cat's alert (ADR-0016, point 17), only when Reorder Cat is on for the company. */
export async function offerReorder(context: RoleHandlerContext, client: ReorderClient | null, companyId: string): Promise<void> {
  if (!client) return;
  const companies = await client.companies();
  if (!companies.ok || !companies.data.some((company) => company.id === companyId)) return;
  await context.sendButtons?.("¿Pido la reposición de lo que se acaba?", [{ id: `reorder:open:${companyId}`, title: "Pedir reposición" }]);
}

export type { OrderSummary };
