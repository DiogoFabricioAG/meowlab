import type { RoleHandler, RoleHandlerContext, TenantContext } from "./contracts";
import type { MoveKind, MovePeriod, StockAlert, StockItem, StockLineInput } from "../stock/bridge-contracts";
import type { StockAnswer, StockClient } from "../stock/client";
import { extractStock, type StockExtraction } from "../stock/extractor";

export const STOCK_ROLE_KEY = "stock";
/** While a Stock Cat conversation is open, the next messages stay with it. */
export const STOCK_SESSION_MS = 30 * 60_000;

type Pending = { kind: MoveKind; lines: StockLineInput[] };
export type StockState = {
  v: 1;
  expiresAt: number;
  companyId: string | null;
  companyName: string | null;
  pending: Pending | null;
};

const PERIOD_LABEL: Record<MovePeriod, string> = {
  today: "hoy", yesterday: "ayer", week: "esta semana", month: "este mes", last_month: "el mes pasado",
};
const KIND_LABEL: Record<MoveKind, string> = { in: "Entrada", out: "Salida", count: "Conteo" };

const soles = (cents: number) =>
  `S/ ${(cents / 100).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const quantityText = (value: number) =>
  (Number.isInteger(value) ? String(value) : value.toLocaleString("es-PE", { maximumFractionDigits: 3 }));

/** `/stock` (any case) opens Stock Cat; `/salir` closes it. */
export const isStockCommand = (text: string) => /^\/stock\b/i.test(text.trim());
const isExitCommand = (text: string) => /^\/(salir|exit)\b/i.test(text.trim()) || /^salir( del inventario)?$/i.test(text.trim());

export function parseStockState(json: string | null, now = Date.now()): StockState | null {
  if (!json) return null;
  try {
    const state = JSON.parse(json) as StockState;
    return state?.v === 1 && typeof state.expiresAt === "number" && state.expiresAt > now ? state : null;
  } catch {
    return null;
  }
}

/** «Se está acabando: Polo blanco M — quedan 3 (mínimo 5).» */
export function formatAlerts(alerts: StockAlert[], companyName?: string | null): string {
  if (!alerts.length) return "";
  const lines = alerts.map((alert) =>
    `• ${alert.name}: quedan ${quantityText(alert.onHand)} (mínimo ${quantityText(alert.minQty)})${alert.needsCount ? ". Conviene contarlo." : ""}`);
  return `⚠️ *Se está acabando${companyName ? ` en ${companyName}` : ""}:*\n${lines.join("\n")}`;
}

export function formatPending(pending: Pending): string {
  const lines = pending.lines.map((line) => {
    const cost = line.unitCostCents !== null && line.unitCostCents !== undefined ? ` a ${soles(line.unitCostCents)} c/u` : "";
    return pending.kind === "count"
      ? `• ${line.name}: hay ${quantityText(line.quantity)}`
      : `• ${quantityText(line.quantity)} × ${line.name}${cost}`;
  });
  return [`*${KIND_LABEL[pending.kind]}*`, ...lines].join("\n");
}

function itemLine(item: StockItem): string {
  const min = item.minQty !== null ? ` (mínimo ${quantityText(item.minQty)})` : "";
  const cost = item.avgCostCents !== undefined && item.avgCostCents !== null ? ` · costo ${soles(item.avgCostCents)}` : "";
  return `• ${item.name}: ${quantityText(item.onHand)}${min}${cost}${item.needsCount ? " · contar" : ""}`;
}

export function formatAnswer(answer: StockAnswer, type: string): string {
  if ("valueCents" in answer) {
    const missing = answer.withoutCost ? `\n${answer.withoutCost} ${answer.withoutCost === 1 ? "producto no tiene" : "productos no tienen"} costo registrado y no suman.` : "";
    return `*Tu inventario vale ${soles(answer.valueCents)}* al costo promedio (${answer.withStock} ${answer.withStock === 1 ? "producto" : "productos"} con stock).${missing}`;
  }
  if ("period" in answer) {
    const when = PERIOD_LABEL[answer.period];
    if (!answer.items.length) return `No hubo movimientos ${when}.`;
    return `*Movimientos ${when}:*\n${answer.items.map((item) => {
      const parts = [
        item.entered ? `entró ${quantityText(item.entered)}` : "",
        item.left ? `salió ${quantityText(item.left)}` : "",
        item.countDifference ? `conteo ${item.countDifference > 0 ? "+" : ""}${quantityText(item.countDifference)}` : "",
      ].filter(Boolean);
      return `• ${item.name}: ${parts.join(", ") || "sin cambios"}`;
    }).join("\n")}`;
  }
  if (!answer.items.length) {
    return type === "low" ? "Nada se está acabando. 👍"
      : type === "slow" ? `Todo lo que tienes se movió en los últimos ${answer.days ?? 30} días.`
      : "No encontré ese producto en tu inventario.";
  }
  const title = type === "low" ? "*Se está acabando:*" : type === "slow" ? `*No se vende hace más de ${answer.days ?? 30} días:*` : "*Stock:*";
  return `${title}\n${answer.items.map(itemLine).join("\n")}`;
}

const HELP = [
  "Soy Stock Cat. Puedes escribirme, por ejemplo:",
  "• «Me llegaron 50 polos blancos a 12 soles»",
  "• «Salieron 3 tazas» o «se rompieron 2»",
  "• «Conté 40 polos»",
  "• «Avísame cuando queden 10 polos»",
  "• «¿Qué se está acabando?» · «¿Cuánto me queda de tazas?» · «¿Cuánto vale mi inventario?»",
  "Las facturas y boletas que emites con Invoice Cat descuentan el stock solas.",
  "Escribe /salir para volver con Manolo.",
].join("\n");

const ERROR_TEXT: Record<string, string> = {
  owner_only: "Eso solo lo puede cambiar o ver la titular de la empresa.",
  forbidden: "No tienes Stock Cat activo para esa empresa.",
};

/**
 * Stock Cat, phase 1 (ADR-0014): the team records entries, exits and counts, asks about
 * stock and gets alerted when something runs low. Invoices and receipts issued with Invoice
 * Cat take stock out by themselves; data lives in the platform (`stock`).
 */
export class StockRoleHandler implements RoleHandler {
  readonly key = STOCK_ROLE_KEY;

  constructor(private readonly clientFor: (context: RoleHandlerContext) => StockClient | null) {}

  configure(tenant: TenantContext): TenantContext {
    return { ...tenant, roleKey: STOCK_ROLE_KEY, temperature: 0 };
  }

  async handle(context: RoleHandlerContext): Promise<void> {
    const client = this.clientFor(context);
    const contactId = context.persisted.contactId;
    if (!client || !context.roleState || contactId === null) {
      await context.reply("Stock Cat no está disponible en este momento. Inténtalo en unos minutos.");
      return;
    }
    const roleState = context.roleState;
    const tenantId = context.tenant.tenantId;
    let state: StockState = parseStockState(await roleState.get(tenantId, contactId, STOCK_ROLE_KEY)) ?? {
      v: 1, expiresAt: 0, companyId: null, companyName: null, pending: null,
    };
    const save = async () => {
      state.expiresAt = Date.now() + STOCK_SESSION_MS;
      await roleState.set(tenantId, contactId, STOCK_ROLE_KEY, JSON.stringify(state));
    };
    const close = async (text: string) => {
      await roleState.clear(tenantId, contactId, STOCK_ROLE_KEY);
      await context.reply(text);
    };

    const text = context.message.text.trim();
    const interaction = context.message.interactionId?.startsWith("stock:") ? context.message.interactionId : null;
    if (!interaction && isExitCommand(text)) {
      await close("Listo, saliste de Stock Cat. Escribe /stock cuando quieras volver.");
      return;
    }

    if (interaction?.startsWith("stock:company:")) {
      const companies = await client.companies();
      const chosen = companies.ok ? companies.data.find((company) => company.id === interaction.slice("stock:company:".length)) : null;
      if (chosen) {
        state = { ...state, companyId: chosen.id, companyName: chosen.name, pending: null };
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
        await close("Stock Cat todavía no está activo para tu empresa. Escríbele al equipo de MeowLab para activarlo.");
        return;
      }
      if (companies.data.length > 1) {
        await save();
        await context.sendList?.("¿De qué empresa es el inventario?", "Elegir empresa", [{
          title: "Empresas",
          rows: companies.data.slice(0, 10).map((company) => ({ id: `stock:company:${company.id}`, title: company.name.slice(0, 24) })),
        }]);
        return;
      }
      state = { ...state, companyId: companies.data[0].id, companyName: companies.data[0].name };
    }
    const companyId = state.companyId!;

    if (interaction) {
      await this.onButton(context, client, state, companyId, interaction, save);
      return;
    }

    const message = text.replace(/^\/stock\b/i, "").trim();
    if (!message && !state.pending) {
      await save();
      await this.open(context, client, state, `Hola, soy Stock Cat${state.companyName ? ` de ${state.companyName}` : ""}.`);
      return;
    }
    if (state.pending && /^(confirmar|confirmo|s[ií]|guardar|ok|dale)$/i.test(message)) {
      await this.confirm(context, client, state, companyId, save);
      return;
    }
    if (state.pending && /^(cancelar|descartar|no)$/i.test(message)) {
      state.pending = null;
      await save();
      await context.reply("Descartado. ¿Algo más? Escribe /salir para volver con Manolo.");
      return;
    }

    const [items, sync] = await Promise.all([client.items(companyId), client.syncDocuments(companyId)]);
    const extraction = await extractStock(context.ai, context.tenant, {
      message: message || text,
      pending: state.pending,
      items: items.ok ? items.data.items.map((item) => item.name) : [],
      unmatched: sync.ok ? sync.data.unmatched : [],
    }, context.log);
    if (sync.ok && sync.data.alerts.length) await context.reply(formatAlerts(sync.data.alerts));
    if (!extraction) {
      await save();
      await context.reply("No te entendí bien. ¿Me lo dices de otra forma? Por ejemplo: «me llegaron 20 polos».");
      return;
    }
    await this.onExtraction(context, client, state, companyId, extraction, save, close);
  }

  /** Greets, brings documents up to date and says what needs attention. */
  private async open(context: RoleHandlerContext, client: StockClient, state: StockState, greeting: string) {
    const companyId = state.companyId!;
    const sync = await client.syncDocuments(companyId);
    const notes: string[] = [];
    if (sync.ok && sync.data.processed) {
      notes.push(`Revisé ${sync.data.processed} ${sync.data.processed === 1 ? "comprobante nuevo" : "comprobantes nuevos"} y descontaré lo vendido.`);
    }
    if (sync.ok && sync.data.alerts.length) notes.push(formatAlerts(sync.data.alerts));
    if (sync.ok && sync.data.unmatched.length) {
      notes.push(`En tus comprobantes hay productos que no reconozco: ${sync.data.unmatched.slice(0, 5).join(", ")}. `
        + "Dime a cuál de tu inventario corresponden, por ejemplo: «POLO BL M es el polo blanco M».");
    }
    if (notes.length) await context.reply(notes.join("\n\n"));
    const sent = await context.sendButtons?.(`${greeting} ¿Qué hacemos?`, [
      { id: "stock:query:low", title: "¿Qué se acaba?" },
      { id: "stock:query:moves", title: "Movimientos" },
      { id: "stock:help", title: "¿Qué puedo decirte?" },
    ]);
    if (!sent || sent.status !== "sent") await context.reply(HELP);
  }

  private async onButton(context: RoleHandlerContext, client: StockClient, state: StockState, companyId: string, interaction: string,
    save: () => Promise<void>) {
    await save();
    if (interaction === "stock:confirm") {
      await this.confirm(context, client, state, companyId, save);
      return;
    }
    if (interaction === "stock:cancel") {
      state.pending = null;
      await save();
      await context.reply("Descartado. ¿Algo más?");
      return;
    }
    if (interaction === "stock:help") {
      await context.reply(HELP);
      return;
    }
    if (interaction === "stock:query:low" || interaction === "stock:query:moves") {
      const type = interaction === "stock:query:low" ? "low" : "moves";
      const answer = await client.query(companyId, type, type === "moves" ? { period: "week" } : {});
      await context.reply(answer.ok ? formatAnswer(answer.data, type) : "No pude consultar el inventario ahora. Inténtalo en unos minutos.");
      return;
    }
    await context.reply("Ese botón ya no aplica. Escribe /stock para empezar de nuevo.");
  }

  private async onExtraction(context: RoleHandlerContext, client: StockClient, state: StockState, companyId: string,
    extraction: StockExtraction, save: () => Promise<void>, close: (text: string) => Promise<void>) {
    switch (extraction.intent) {
      case "exit":
        await close("Listo, saliste de Stock Cat. Escribe /stock cuando quieras volver.");
        return;
      case "help":
      case "other":
        await save();
        await context.reply(extraction.intent === "help" ? HELP : extraction.reply || HELP);
        return;
      case "in":
      case "out":
      case "count": {
        if (!extraction.items.length) {
          await save();
          await context.reply(extraction.reply || "¿Qué productos y cuántos?");
          return;
        }
        state.pending = {
          kind: extraction.intent,
          lines: extraction.items.map((item) => ({
            name: item.name,
            quantity: item.quantity,
            ...(extraction.intent === "in" && item.unitCost !== null ? { unitCostCents: Math.round(item.unitCost * 100) } : {}),
            ...(item.kind ? { kind: item.kind } : {}),
          })),
        };
        await save();
        const summary = formatPending(state.pending);
        const sent = await context.sendButtons?.(summary, [
          { id: "stock:confirm", title: "Guardar" },
          { id: "stock:cancel", title: "Cancelar" },
        ]);
        if (!sent || sent.status !== "sent") await context.reply(`${summary}\n\nResponde *confirmar* para guardar o *cancelar*.`);
        return;
      }
      case "set_min": {
        await save();
        const name = extraction.items[0]?.name ?? extraction.itemName;
        if (!name) {
          await context.reply("¿De qué producto es el mínimo?");
          return;
        }
        const minQty = extraction.minQty ?? (extraction.items[0]?.quantity ?? null);
        const result = await client.setMin(companyId, name, minQty);
        if (!result.ok) {
          await context.reply(result.code === "not_found" ? `No tengo «${name}» en el inventario. Regístralo primero con una entrada o un conteo.`
            : ERROR_TEXT[result.code] ?? "No pude guardar el mínimo. Inténtalo otra vez.");
          return;
        }
        const item = result.data.item;
        await context.reply([
          item.minQty === null ? `Quité el mínimo de ${item.name}.` : `Listo: te aviso cuando ${item.name} llegue a ${quantityText(item.minQty)} (hay ${quantityText(item.onHand)}).`,
          formatAlerts(result.data.alerts),
        ].filter(Boolean).join("\n\n"));
        return;
      }
      case "query": {
        await save();
        const type = extraction.queryType ?? (extraction.itemName ? "item" : "low");
        if (type === "item" && !extraction.itemName) {
          await context.reply("¿De qué producto quieres saber?");
          return;
        }
        const answer = await client.query(companyId, type, {
          ...(type === "item" ? { name: extraction.itemName! } : {}),
          ...(type === "moves" ? { period: extraction.period ?? "week" } : {}),
        });
        await context.reply(answer.ok ? formatAnswer(answer.data, type)
          : ERROR_TEXT[answer.code] ?? "No pude consultar el inventario ahora. Inténtalo en unos minutos.");
        return;
      }
      case "negative": {
        await save();
        if (extraction.allowNegative === null) {
          await context.reply("¿Quieres permitir que un producto quede en negativo (y te aviso) o no permitirlo?");
          return;
        }
        const result = await client.settings(companyId, extraction.allowNegative);
        await context.reply(!result.ok ? ERROR_TEXT[result.code] ?? "No pude cambiar la regla. Inténtalo otra vez."
          : result.data.settings.allowNegative
            ? "Listo: si algo sale sin stock, lo registro igual y te aviso."
            : "Listo: no registraré salidas a mano sin stock. Las facturas ya aceptadas descuentan igual y te pediré contar ese producto.");
        return;
      }
      case "link": {
        await save();
        if (!extraction.alias) {
          await context.reply("¿Qué nombre del comprobante corresponde a qué producto? Por ejemplo: «POLO BL M es el polo blanco M».");
          return;
        }
        const result = await client.linkAlias(companyId, extraction.alias.description, extraction.alias.name);
        if (!result.ok) {
          await context.reply(ERROR_TEXT[result.code] ?? "No pude guardarlo. Inténtalo otra vez.");
          return;
        }
        await context.reply([
          `Anotado: «${extraction.alias.description}» es ${result.data.item.name}.${result.data.applied
            ? ` Desconté ${result.data.applied} ${result.data.applied === 1 ? "línea pendiente" : "líneas pendientes"}; quedan ${quantityText(result.data.item.onHand)}.` : ""}`,
          formatAlerts(result.data.alerts),
        ].filter(Boolean).join("\n\n"));
        return;
      }
    }
  }

  private async confirm(context: RoleHandlerContext, client: StockClient, state: StockState, companyId: string, save: () => Promise<void>) {
    const pending = state.pending;
    if (!pending) {
      await context.reply("No hay nada pendiente de guardar. Cuéntame qué entró, salió o contaste.");
      return;
    }
    const result = await client.move(companyId, pending.kind, pending.lines, null);
    if (!result.ok) {
      const details = result.details as { name?: string; onHand?: number } | undefined;
      await context.reply(result.code === "insufficient" && details?.name
        ? `No hay suficiente ${details.name}: quedan ${quantityText(details.onHand ?? 0)}. La regla de tu empresa no permite quedar en negativo; corrige la cantidad o haz un conteo.`
        : result.code === "not_found" && (result.details as { name?: string } | undefined)?.name
          ? `No tengo «${(result.details as { name: string }).name}» en el inventario. Registra primero una entrada o un conteo.`
          : "No pude guardarlo. Inténtalo otra vez.");
      return;
    }
    state.pending = null;
    await save();
    const lines = result.data.moved.map((move) => `• ${move.name}: quedan ${quantityText(move.onHand)}`);
    await context.reply([`Guardado.\n${lines.join("\n")}`, formatAlerts(result.data.alerts)].filter(Boolean).join("\n\n"));
  }
}

/**
 * After Invoice Cat issues a document: brings Stock Cat up to date for the contact's
 * companies and returns the alerts to show in the same chat (ADR-0014, point 14).
 */
export async function stockAlertsAfterInvoice(client: StockClient | null): Promise<string | null> {
  if (!client) return null;
  const companies = await client.companies();
  if (!companies.ok || !companies.data.length) return null;
  const texts: string[] = [];
  for (const company of companies.data.slice(0, 5)) {
    const sync = await client.syncDocuments(company.id);
    if (sync.ok && sync.data.alerts.length) texts.push(formatAlerts(sync.data.alerts, companies.data.length > 1 ? company.name : null));
  }
  return texts.length ? texts.join("\n\n") : null;
}
