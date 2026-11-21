import type { RoleHandler, RoleHandlerContext, TenantContext } from "./contracts";
import type { FacturayaClient, ImportInvoiceDraftInput } from "../facturaya/contracts";
import type { PaymentMethod, SalesCustomerInput, SalesGoalStatus, SalesSummary, SummaryPeriod } from "../sales/bridge-contracts";
import { stripCatAlias, validateCatName } from "../sales/cat-name";
import type { SalesClient } from "../sales/client";
import { extractSales, type SalesExtraction } from "../sales/extractor";

export const SALES_ROLE_KEY = "sales";
/** While a Sales Cat conversation is open, the owner's next messages stay with it. */
export const SALES_SESSION_MS = 30 * 60_000;

type Item = { description: string; quantity: number; unitPriceCents: number | null };
export type SalesDraft = {
  kind: "sale" | "quote";
  customer: { name: string; docNumber: string | null } | null;
  items: Item[];
  paymentMethod: PaymentMethod | null;
  discountCents: number;
  notes: string | null;
  dueDate?: string | null;
};
type PendingInvoice = { saleNumber: number; draft: SalesDraft; facturayaDraftId?: string };
export type SalesState = {
  v: 1;
  expiresAt: number;
  companyId: string | null;
  companyName: string | null;
  catName?: string | null;
  creditOfferShown?: boolean;
  draft: SalesDraft | null;
  pendingInvoice: PendingInvoice | null;
  pendingCancel: number | null;
};

const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  efectivo: "Efectivo", yape: "Yape", plin: "Plin", transferencia: "Transferencia", tarjeta: "Tarjeta", credito: "Al crédito",
};
const PERIOD_LABEL: Record<SummaryPeriod, string> = {
  today: "hoy", yesterday: "ayer", week: "esta semana", month: "este mes", last_month: "el mes pasado",
};

export const soles = (cents: number) =>
  `S/ ${(cents / 100).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const quantityText = (value: number) => (Number.isInteger(value) ? String(value) : value.toLocaleString("es-PE", { maximumFractionDigits: 3 }));
const toCents = (soles: number) => Math.round(soles * 100);
const limaToday = (now = Date.now()) => new Date(now - 5 * 3_600_000).toISOString().slice(0, 10);
const limaMonth = (now = Date.now()) => limaToday(now).slice(0, 7);
const MONTHS_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-");
  const name = MONTHS_ES[Number(m) - 1] ?? ym;
  return `${name} ${y}`;
};

export function formatGoalStatus(goal: SalesGoalStatus, catLabel = "Sales Cat"): string {
  const label = monthLabel(goal.month);
  if (!goal.targetCents) {
    return `${catLabel}: aún no pusiste meta para ${label}. Dime por ejemplo: «mi meta de ${MONTHS_ES[Number(goal.month.slice(5)) - 1] ?? "este mes"} es S/ 20,000».`;
  }
  const pct = Math.round((goal.achievedCents / goal.targetCents) * 100);
  if (goal.achievedCents >= goal.targetCents) {
    return `¡Meta de ${label} cumplida! Llevas ${soles(goal.achievedCents)} de ${soles(goal.targetCents)} (${pct} %).`;
  }
  const remaining = goal.targetCents - goal.achievedCents;
  if (goal.isPastMonth) {
    return `Meta de ${label}: cerraste con ${soles(goal.achievedCents)} de ${soles(goal.targetCents)} (${pct} %). Faltaron ${soles(remaining)}.`;
  }
  const daysLeft = goal.isCurrentMonth && goal.currentDay !== null
    ? Math.max(1, goal.daysInMonth - goal.currentDay + 1)
    : goal.daysInMonth;
  const dailyNeeded = Math.ceil(remaining / daysLeft);
  return `Meta de ${label}: llevas ${soles(goal.achievedCents)} de ${soles(goal.targetCents)} (${pct} %). Te faltan ${soles(remaining)} (${soles(dailyNeeded)} al día en ${daysLeft} ${daysLeft === 1 ? "día" : "días"}).`;
}

/** `/sales` (any case) opens Sales Cat; `/salir` closes it. */
export const isSalesCommand = (text: string) => /^\/sales\b/i.test(text.trim());
const isExitCommand = (text: string) => /^\/(salir|exit)\b/i.test(text.trim()) || /^salir( de ventas)?$/i.test(text.trim());

export function parseSalesState(json: string | null, now = Date.now()): SalesState | null {
  if (!json) return null;
  try {
    const state = JSON.parse(json) as SalesState;
    return state?.v === 1 && typeof state.expiresAt === "number" && state.expiresAt > now ? state : null;
  } catch {
    return null;
  }
}

function draftTotals(draft: SalesDraft) {
  const subtotal = draft.items.reduce((sum, item) => sum + Math.round(item.quantity * (item.unitPriceCents ?? 0)), 0);
  const discount = Math.min(subtotal, draft.discountCents);
  return { subtotal, discount, total: subtotal - discount };
}

function customerInput(draft: SalesDraft): SalesCustomerInput {
  const customer = draft.customer;
  if (!customer) return null;
  const doc = customer.docNumber;
  const docType = doc?.length === 11 ? "6" : doc?.length === 8 ? "1" : "0";
  return { docType, docNumber: docType === "0" ? null : doc, name: customer.name || (doc ? `Cliente ${doc}` : "Cliente varios") };
}

export function formatDraft(draft: SalesDraft): string {
  const totals = draftTotals(draft);
  const lines = draft.items.map((item) =>
    `• ${quantityText(item.quantity)} × ${item.description} — ${item.unitPriceCents === null ? "precio por definir" : soles(Math.round(item.quantity * item.unitPriceCents))}`);
  return [
    draft.kind === "quote" ? "*Cotización*" : "*Venta*",
    `Cliente: ${draft.customer ? `${draft.customer.name}${draft.customer.docNumber ? ` (${draft.customer.docNumber})` : ""}` : "Cliente varios"}`,
    ...lines,
    ...(totals.discount ? [`Descuento: −${soles(totals.discount)}`] : []),
    `*Total: ${soles(totals.total)}*`,
    ...(draft.kind === "sale" ? [`Pago: ${draft.paymentMethod ? PAYMENT_LABEL[draft.paymentMethod] : "por definir"}`] : []),
    ...(draft.kind === "sale" && draft.paymentMethod === "credito" && draft.dueDate ? [`Vence: ${draft.dueDate.split("-").reverse().join("/")}`] : []),
    ...(draft.notes ? [`Nota: ${draft.notes}`] : []),
  ].join("\n");
}

export function formatSummary(summary: SalesSummary): string {
  const when = PERIOD_LABEL[summary.period];
  if (!summary.salesCount && !summary.quotesCount) return `No hay ventas ni cotizaciones registradas ${when}.`;
  const parts = [
    `*Ventas ${when}:* ${summary.salesCount} por ${soles(summary.totalCents)}${summary.creditCents ? ` (${soles(summary.creditCents)} al crédito)` : ""}.`,
    `*Cotizaciones:* ${summary.quotesCount} por ${soles(summary.quotedCents)}.`,
  ];
  if (summary.topProducts.length) {
    parts.push(`*Lo que más se vendió:*\n${summary.topProducts.map((p) => `• ${p.description}: ${quantityText(p.quantity)} (${soles(p.totalCents)})`).join("\n")}`);
  }
  if (summary.topCustomers.length) {
    parts.push(`*Quién compró más:*\n${summary.topCustomers.map((c) => `• ${c.name}: ${c.salesCount} ${c.salesCount === 1 ? "compra" : "compras"} (${soles(c.totalCents)})`).join("\n")}`);
  }
  return parts.join("\n\n");
}

const HELP = [
  "Soy Sales Cat. Puedes escribirme, por ejemplo:",
  "• «Vendí 3 polos a 25 a Juan Pérez, pagó con Yape»",
  "• «Cotiza 100 volantes A5 para Comercial Lima, RUC 20123456789»",
  "• «¿Cuánto vendí esta semana?»",
  "• «El polo blanco ahora cuesta 30»",
  "• «Anula la venta 12»",
  "Escribe /salir para volver al menú de MeowLab.",
].join("\n");

/**
 * Sales Cat, phase 1 (ADR-0011): the owner and her team register sales and quotes and ask
 * about them from Manolo's chat. Data lives in the platform (`commerce`, `sales`); a quote is
 * shared with a link; a sale may be invoiced through Invoice Cat.
 */
export class SalesRoleHandler implements RoleHandler {
  readonly key = SALES_ROLE_KEY;

  constructor(private readonly clientFor: (context: RoleHandlerContext) => SalesClient | null) {}

  configure(tenant: TenantContext): TenantContext {
    return { ...tenant, roleKey: SALES_ROLE_KEY, temperature: 0 };
  }

  async handle(context: RoleHandlerContext): Promise<void> {
    const client = this.clientFor(context);
    const contactId = context.persisted.contactId;
    if (!client || !context.roleState || contactId === null) {
      await context.reply("Sales Cat no está disponible en este momento. Inténtalo en unos minutos.");
      return;
    }
    const roleState = context.roleState;
    const tenantId = context.tenant.tenantId;
    const now = Date.now();
    let state: SalesState = parseSalesState(await roleState.get(tenantId, contactId, SALES_ROLE_KEY), now) ?? {
      v: 1, expiresAt: 0, companyId: null, companyName: null, draft: null, pendingInvoice: null, pendingCancel: null,
    };
    const save = async () => {
      state.expiresAt = Date.now() + SALES_SESSION_MS;
      await roleState.set(tenantId, contactId, SALES_ROLE_KEY, JSON.stringify(state));
    };
    const close = async (text: string) => {
      await roleState.clear(tenantId, contactId, SALES_ROLE_KEY);
      await context.reply(text);
    };

    const text = context.message.text.trim();
    const interaction = context.message.interactionId?.startsWith("sales:") ? context.message.interactionId : null;
    if (!interaction && isExitCommand(text)) {
      await close("Listo, saliste de Sales Cat. Escribe /sales cuando quieras volver.");
      return;
    }

    // Company: the one this contact may sell for (ADR-0010 memberships with Sales Cat on).
    if (interaction?.startsWith("sales:company:")) {
      const companies = await client.companies();
      const chosen = companies.ok ? companies.data.find((company) => company.id === interaction.slice("sales:company:".length)) : null;
      if (chosen) {
        state = { ...state, companyId: chosen.id, companyName: chosen.name, catName: chosen.catName ?? null };
        await save();
        await this.menu(context, `Trabajemos con ${chosen.name}.`, state.catName);
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
        await close("Sales Cat todavía no está activo para tu empresa. Actívalo desde app.meowlab.tech o escríbele al equipo de MeowLab.");
        return;
      }
      if (companies.data.length > 1) {
        await save();
        await context.sendList?.("¿Para qué empresa vas a registrar ventas?", "Elegir empresa", [{
          title: "Empresas",
          rows: companies.data.slice(0, 10).map((company) => ({ id: `sales:company:${company.id}`, title: company.name.slice(0, 24) })),
        }]);
        return;
      }
      state = { ...state, companyId: companies.data[0].id, companyName: companies.data[0].name, catName: companies.data[0].catName ?? null };
    }
    const companyId = state.companyId!;
    const catLabel = state.catName || "Sales Cat";

    if (interaction) {
      await this.onButton(context, client, state, companyId, interaction, save, close);
      return;
    }

    let message = text.replace(/^\/sales\b/i, "").trim();
    if (message === text && state.catName) {
      message = stripCatAlias(text, state.catName);
    }
    if (!message && !state.draft) {
      await save();
      await this.menu(context, `Hola, soy ${catLabel}${state.companyName ? ` de ${state.companyName}` : ""}.`, state.catName);
      await this.maybeOfferCreditSync(context, client, state, companyId, save);
      return;
    }

    // Plain-word answers (also the fallback when buttons cannot be shown).
    if (state.draft && /^(confirmar|confirmo|s[ií]|guardar|ok|dale)$/i.test(message)) {
      await this.confirm(context, client, state, companyId, save);
      return;
    }
    if (state.draft && /^(cancelar|descartar|no)$/i.test(message)) {
      state.draft = null;
      await save();
      await context.reply("Descartado. ¿Algo más? Escribe /salir para volver al menú de MeowLab.");
      return;
    }

    const catalog = await client.catalog(companyId);
    const extraction = await extractSales(context.ai, context.tenant, {
      message: message || text,
      draft: state.draft,
      catalog: catalog.ok ? catalog.data : [],
    }, context.log);
    if (!extraction) {
      await save();
      await context.reply("No te entendí bien. ¿Me lo dices de otra forma? Por ejemplo: «vendí 2 polos a 25».");
      return;
    }
    await this.onExtraction(context, client, state, companyId, extraction, save, close);
  }

  private async menu(context: RoleHandlerContext, greeting: string, catName?: string | null) {
    const sent = await context.sendButtons?.(`${greeting} ¿Qué hacemos?`, [
      { id: "sales:start:sale", title: "Registrar venta" },
      { id: "sales:start:quote", title: "Nueva cotización" },
      { id: "sales:query:today", title: "Ventas de hoy" },
    ]);
    if (!sent || sent.status !== "sent") {
      await context.reply(catName ? HELP.replace("Soy Sales Cat.", `Soy ${catName}.`) : HELP);
    }
  }

  private async maybeOfferCreditSync(
    context: RoleHandlerContext,
    client: SalesClient,
    state: SalesState,
    companyId: string,
    save: () => Promise<void>,
  ) {
    if (state.creditOfferShown || !client.creditSyncStatus) return;
    const status = await client.creditSyncStatus(companyId);
    if (!status.ok || status.data.pendingCount <= 0) return;
    state.creditOfferShown = true;
    await save();
    const n = status.data.pendingCount;
    const prompt = `Tienes ${n} ${n === 1 ? "venta al crédito" : "ventas al crédito"} con saldo pendiente que aún no ${n === 1 ? "está" : "están"} en Collections Cat. ¿Quieres ${n === 1 ? "traerla" : "traerlas"} ahora?`;
    const sent = await context.sendButtons?.(prompt, [
      { id: "sales:sync_credit:yes", title: "Sí, traerlas" },
      { id: "sales:sync_credit:no", title: "Ahora no" },
    ]);
    if (!sent || sent.status !== "sent") await context.reply(prompt);
  }

  private async onExtraction(
    context: RoleHandlerContext,
    client: SalesClient,
    state: SalesState,
    companyId: string,
    extraction: SalesExtraction,
    save: () => Promise<void>,
    close: (text: string) => Promise<void>,
  ) {
    switch (extraction.intent) {
      case "exit":
        await close("Listo, saliste de Sales Cat. Escribe /sales cuando quieras volver.");
        return;
      case "help":
        await save();
        await context.reply(HELP);
        return;
      case "query": {
        await save();
        const summary = await client.summary(companyId, extraction.period ?? "today");
        await context.reply(summary.ok ? formatSummary(summary.data) : "No pude consultar tus ventas ahora. Inténtalo en unos minutos.");
        return;
      }
      case "product": {
        await save();
        if (!extraction.product) {
          await context.reply(extraction.reply || "Dime el producto y su precio. Por ejemplo: «el polo blanco cuesta 30».");
          return;
        }
        const saved = await client.upsertProduct(companyId, extraction.product.name, toCents(extraction.product.unitPrice));
        await context.reply(saved.ok
          ? `${saved.data.created ? "Agregué" : "Actualicé"} *${saved.data.name}* a ${soles(saved.data.unitPriceCents)}.`
          : "No pude guardar el producto. Inténtalo otra vez.");
        return;
      }
      case "cancel_sale": {
        if (!extraction.saleNumber) {
          await save();
          await context.reply("¿Qué número de venta anulo? Por ejemplo: «anula la venta 12».");
          return;
        }
        state.pendingCancel = extraction.saleNumber;
        await save();
        await context.sendButtons?.(`¿Anulo la venta N.° ${extraction.saleNumber}? Quedará registrado quién la anuló.`, [
          { id: `sales:cancelsale:${extraction.saleNumber}`, title: "Sí, anular" },
          { id: "sales:keep", title: "No" },
        ]);
        return;
      }
      case "set_goal": {
        await save();
        if (!extraction.goalAmount || !client.setGoal) {
          await context.reply("Dime el monto de tu meta mensual. Por ejemplo: «mi meta de diciembre es S/ 20,000».");
          return;
        }
        const month = extraction.goalMonth ?? limaMonth();
        const saved = await client.setGoal(companyId, month, toCents(extraction.goalAmount));
        await context.reply(saved.ok
          ? formatGoalStatus(saved.data, state.catName || "Sales Cat")
          : "No pude guardar tu meta. Inténtalo otra vez.");
        return;
      }
      case "goal_status": {
        await save();
        if (!client.goalStatus) {
          await context.reply("No pude consultar tu meta ahora. Inténtalo en unos minutos.");
          return;
        }
        const month = extraction.goalMonth ?? limaMonth();
        const goal = await client.goalStatus(companyId, month);
        await context.reply(goal.ok
          ? formatGoalStatus(goal.data, state.catName || "Sales Cat")
          : "No pude consultar tu meta ahora. Inténtalo en unos minutos.");
        return;
      }
      case "set_cat_name": {
        const check = validateCatName(extraction.catName ?? "");
        if (!check.ok) {
          await save();
          await context.reply(
            check.reason === "length" ? "El nombre debe tener entre 2 y 20 caracteres."
              : check.reason === "link" ? "El nombre no puede contener enlaces ni dominios."
              : "Ese nombre está reservado para MeowLab o sus gatos. Elige otro.",
          );
          return;
        }
        if (!client.setCatName) {
          await save();
          await context.reply("No pude cambiar el nombre ahora. Inténtalo en unos minutos.");
          return;
        }
        const saved = await client.setCatName(companyId, check.name);
        if (!saved.ok) {
          await save();
          await context.reply("No pude cambiar el nombre. Verifica que tenga de 2 a 20 caracteres y no esté reservado.");
          return;
        }
        state.catName = saved.data.catName;
        await save();
        await context.reply(`¡Listo! Desde ahora me llamo *${saved.data.catName}*. Puedes hablarme empezando con «${saved.data.catName}, ...» o con /sales.`);
        return;
      }
      case "sale":
      case "quote":
        await this.updateDraft(context, state, extraction, save);
        return;
      default:
        await save();
        await context.reply(extraction.reply || HELP);
    }
  }

  private async updateDraft(context: RoleHandlerContext, state: SalesState, extraction: SalesExtraction, save: () => Promise<void>) {
    const draft: SalesDraft = state.draft
      ? { ...state.draft, kind: extraction.intent === "quote" || extraction.intent === "sale" ? extraction.intent : state.draft.kind }
      : { kind: extraction.intent as "sale" | "quote", customer: null, items: [], paymentMethod: null, discountCents: 0, notes: null };
    const items = extraction.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPriceCents: item.unitPrice === null ? null : toCents(item.unitPrice),
    }));
    if (extraction.replaceItems && items.length) draft.items = items;
    else {
      for (const item of items) {
        // A line already in the draft with an unknown price takes the new price.
        const same = draft.items.find((existing) => existing.description.toLowerCase() === item.description.toLowerCase());
        if (same && item.unitPriceCents !== null && (same.unitPriceCents === null || same.quantity === item.quantity)) {
          same.unitPriceCents = item.unitPriceCents;
          same.quantity = item.quantity;
        } else if (!same) draft.items.push(item);
      }
    }
    draft.items = draft.items.slice(0, 50);
    if (extraction.customer) {
      draft.customer = {
        name: extraction.customer.name ?? draft.customer?.name ?? "",
        docNumber: extraction.customer.docNumber ?? draft.customer?.docNumber ?? null,
      };
    }
    if (extraction.paymentMethod) draft.paymentMethod = extraction.paymentMethod;
    if (extraction.dueDate) draft.dueDate = extraction.dueDate;
    if (extraction.discount !== null) draft.discountCents = toCents(extraction.discount);
    if (extraction.notes) draft.notes = extraction.notes;
    state.draft = draft;
    await save();

    if (!draft.items.length) {
      await context.reply(extraction.reply || `¿Qué ${draft.kind === "quote" ? "cotizamos" : "vendiste"}? Dime producto, cantidad y precio.`);
      return;
    }
    const missing = draft.items.filter((item) => item.unitPriceCents === null);
    if (missing.length) {
      await context.reply(`${formatDraft(draft)}\n\n¿A cuánto ${missing.length === 1 ? `está *${missing[0].description}*` : "están estos productos"}? Dime el precio por unidad.`);
      return;
    }
    if (draft.kind === "sale" && !draft.paymentMethod) {
      await context.sendList?.(`${formatDraft(draft)}\n\n¿Cómo te pagó?`, "Forma de pago", [{
        title: "Forma de pago",
        rows: (Object.keys(PAYMENT_LABEL) as PaymentMethod[]).map((method) => ({ id: `sales:pay:${method}`, title: PAYMENT_LABEL[method] })),
      }]);
      return;
    }
    await this.askConfirmation(context, draft);
  }

  private async askConfirmation(context: RoleHandlerContext, draft: SalesDraft) {
    await context.sendButtons?.(`${formatDraft(draft)}\n\n¿Lo guardo?`, [
      { id: "sales:confirm", title: draft.kind === "quote" ? "Crear cotización" : "Guardar venta" },
      { id: "sales:discard", title: "Descartar" },
    ]);
  }

  private async onButton(
    context: RoleHandlerContext,
    client: SalesClient,
    state: SalesState,
    companyId: string,
    interaction: string,
    save: () => Promise<void>,
    close: (text: string) => Promise<void>,
  ) {
    if (interaction === "sales:start:sale" || interaction === "sales:start:quote") {
      const kind = interaction.endsWith("quote") ? "quote" : "sale";
      state.draft = { kind, customer: null, items: [], paymentMethod: null, discountCents: 0, notes: null };
      await save();
      await context.reply(kind === "quote"
        ? "Dime qué cotizamos, cantidades, precios y para quién (con RUC o DNI si lo tienes)."
        : "Cuéntame la venta: qué vendiste, cuántos, a cuánto, a quién y cómo te pagó.");
      return;
    }
    if (interaction === "sales:query:today") {
      await save();
      const summary = await client.summary(companyId, "today");
      await context.reply(summary.ok ? formatSummary(summary.data) : "No pude consultar tus ventas ahora. Inténtalo en unos minutos.");
      return;
    }
    if (interaction === "sales:discard") {
      state.draft = null;
      await save();
      await context.reply("Descartado. ¿Algo más? Escribe /salir para volver al menú de MeowLab.");
      return;
    }
    if (interaction === "sales:keep") {
      state.pendingCancel = null;
      await save();
      await context.reply("No anulé nada.");
      return;
    }
    if (interaction.startsWith("sales:pay:")) {
      const method = interaction.slice("sales:pay:".length) as PaymentMethod;
      if (!state.draft || !(method in PAYMENT_LABEL)) {
        await context.reply("Ese botón ya no aplica. Cuéntame de nuevo la venta.");
        return;
      }
      state.draft.paymentMethod = method;
      await save();
      await this.askConfirmation(context, state.draft);
      return;
    }
    if (interaction === "sales:confirm") {
      await this.confirm(context, client, state, companyId, save);
      return;
    }
    if (interaction === "sales:sync_credit:yes") {
      if (!client.syncCreditDebts) {
        await context.reply("No pude pasar las deudas ahora. Inténtalo en unos minutos.");
        return;
      }
      const synced = await client.syncCreditDebts(companyId);
      await context.reply(synced.ok
        ? (synced.data.added > 0
          ? `Listo, pasé ${synced.data.added} ${synced.data.added === 1 ? "venta al crédito" : "ventas al crédito"} a Collections Cat.`
          : "No quedaron ventas al crédito pendientes por pasar.")
        : "No pude pasar las deudas ahora. Inténtalo en unos minutos.");
      return;
    }
    if (interaction === "sales:sync_credit:no") {
      await context.reply("Listo, quedan guardadas aquí sin pasarlas todavía.");
      return;
    }
    if (interaction.startsWith("sales:cancelsale:")) {
      const number = Number(interaction.slice("sales:cancelsale:".length));
      if (state.pendingCancel !== number) {
        await context.reply("Ese botón ya no aplica.");
        return;
      }
      state.pendingCancel = null;
      await save();
      const result = await client.cancelSale(companyId, number, null);
      if (!result.ok) {
        await context.reply(result.code === "not_found" ? `No encontré una venta vigente con el N.° ${number}.` : "No pude anular la venta. Inténtalo otra vez.");
        return;
      }
      await context.reply(
        result.data.debtStatus === "has_payments"
          ? `Anulé la venta N.° ${number}, pero la deuda en Collections Cat ya tiene pagos registrados, así que no la toqué. Revísala en /collections.`
          : result.data.debtStatus === "cancelled"
          ? `Anulé la venta N.° ${number} y su deuda pendiente en Collections Cat.`
          : `Anulé la venta N.° ${number}.`,
      );
      return;
    }
    if (interaction.startsWith("sales:invoice:")) {
      await this.startInvoice(context, state, companyId, interaction.slice("sales:invoice:".length), save);
      return;
    }
    if (interaction.startsWith("sales:issue:")) {
      await this.issueInvoice(context, client, state, companyId, interaction.slice("sales:issue:".length), save);
      return;
    }
    await context.reply("Ese botón ya no aplica. Escribe /sales para empezar de nuevo.");
    void close;
  }

  private async confirm(context: RoleHandlerContext, client: SalesClient, state: SalesState, companyId: string, save: () => Promise<void>) {
    const draft = state.draft;
    if (!draft || !draft.items.length || draft.items.some((item) => item.unitPriceCents === null)) {
      await context.reply("No hay nada listo para guardar. Cuéntame la venta o la cotización.");
      return;
    }
    const lines = draft.items.map((item) => ({ description: item.description, quantity: item.quantity, unitPriceCents: item.unitPriceCents! }));
    if (draft.kind === "quote") {
      const saved = await client.createQuote(companyId, { customer: customerInput(draft), lines, discountCents: draft.discountCents, notes: draft.notes });
      if (!saved.ok) {
        await context.reply("No pude guardar la cotización. Inténtalo otra vez.");
        return;
      }
      state.draft = null;
      await save();
      const url = `${(context.env.PORTAL_PUBLIC_URL || "https://app.meowlab.tech").replace(/\/$/, "")}/cotizacion/${saved.data.publicToken}`;
      const body = `Cotización N.° ${saved.data.number} por ${soles(saved.data.totalCents)}, válida hasta el ${saved.data.validUntil.split("-").reverse().join("/")}. Reenvía este mensaje a tu cliente para que la vea.`;
      const sent = await context.sendCtaUrl?.(body, "Ver cotización", url);
      if (!sent || sent.status !== "sent") await context.reply(`${body}\n${url}`);
      // ADR-0013: the same PDF as the link, as a document the owner can forward as is.
      const pdf = await client.quotePdf(companyId, saved.data.number);
      if (pdf.ok) {
        await context.sendDocument({
          pdf: new Blob([new Uint8Array(pdf.data.bytes)], { type: "application/pdf" }),
          filename: pdf.data.filename,
          caption: `Cotización N.° ${saved.data.number} en PDF.`,
        });
      }
      return;
    }
    if (!draft.paymentMethod) {
      await this.updateDraft(context, state, { intent: "sale", period: null, customer: null, items: [], replaceItems: false, paymentMethod: null,
        discount: null, notes: null, product: null, saleNumber: null, dueDate: null, goalMonth: null, goalAmount: null, catName: null, reply: "" }, save);
      return;
    }
    const saved = await client.createSale(companyId, {
      customer: customerInput(draft), lines, discountCents: draft.discountCents, notes: draft.notes, paymentMethod: draft.paymentMethod,
      ...(draft.dueDate ? { dueDate: draft.dueDate } : {}),
    });
    if (!saved.ok) {
      await context.reply("No pude guardar la venta. Inténtalo otra vez.");
      return;
    }
    state.draft = null;
    state.pendingInvoice = { saleNumber: saved.data.number, draft };
    await save();
    const credit = saved.data.balanceCents
      ? (saved.data.debtCreated
        ? ` Registré la venta al crédito; Collections Cat le hará seguimiento.`
        : ` Queda una deuda de ${soles(saved.data.balanceCents)}.`)
      : "";
    const sent = await context.sendButtons?.(`Guardé la venta N.° ${saved.data.number} por ${soles(saved.data.totalCents)}.${credit}\n\n¿Emito el comprobante con Invoice Cat?`, [
      { id: "sales:invoice:01", title: "Factura" },
      { id: "sales:invoice:03", title: "Boleta" },
      { id: "sales:invoice:none", title: "Sin comprobante" },
    ]);
    if (!sent || sent.status !== "sent") await context.reply(`Guardé la venta N.° ${saved.data.number} por ${soles(saved.data.totalCents)}.${credit}`);
  }

  /** Hands the sale to Invoice Cat (FacturaYa) for the same company (ADR-0011, point 11). */
  private async startInvoice(context: RoleHandlerContext, state: SalesState, companyId: string, choice: string, save: () => Promise<void>) {
    const pending = state.pendingInvoice;
    if (choice === "none" || !pending) {
      state.pendingInvoice = null;
      await save();
      await context.reply(pending ? "Listo, sin comprobante. ¿Algo más?" : "Ese botón ya no aplica.");
      return;
    }
    const facturaya = await this.facturayaFor(context, companyId);
    if (!facturaya) {
      state.pendingInvoice = null;
      await save();
      await context.reply("Invoice Cat no está conectado a SUNAT para esta empresa, así que no emití comprobante. La venta quedó guardada.");
      return;
    }
    const documentType = choice === "01" ? "01" : "03";
    const customer = customerInput(pending.draft);
    if (pending.draft.paymentMethod === "credito") {
      await context.reply("Para un comprobante al crédito necesito las cuotas: pídeselo a Invoice Cat con el detalle. La venta quedó guardada.");
      return;
    }
    if (documentType === "01" && customer?.docType !== "6") {
      await context.reply("Esta venta no tiene el RUC del cliente, y una factura lo necesita. Elige boleta, o pídele la factura a Invoice Cat con el RUC.");
      return;
    }
    const total = draftTotals(pending.draft).total;
    const anonymous = documentType === "03" && (!customer || customer.docType === "0");
    if (anonymous && total > 70_000) {
      await context.reply("Una boleta de más de S/ 700 necesita el DNI del cliente, y esta venta no lo tiene. Pídele la boleta a Invoice Cat con el DNI.");
      return;
    }
    // A discount goes into the unit price (FacturaYa reads the lines as text).
    const lines = pending.draft.items.map((item) => ({ ...item, unitPriceCents: item.unitPriceCents ?? 0 }));
    if (pending.draft.discountCents) {
      if (lines.length !== 1) {
        await context.reply("Esta venta tiene un descuento sobre varios productos: pídele el comprobante a Invoice Cat con los precios finales. La venta quedó guardada.");
        return;
      }
      lines[0].unitPriceCents = Math.round(total / lines[0].quantity);
    }
    const input: ImportInvoiceDraftInput = {
      documentType,
      customerDocumentType: anonymous ? "0" : customer!.docType,
      customerRuc: anonymous ? null : customer!.docNumber,
      customerName: anonymous ? null : customer!.name,
      issueDate: limaToday(),
      taxMode: "included",
      paymentMethod: "contado",
      productsText: lines
        .map((item) => `${quantityText(item.quantity)} ${item.description}, precio unitario PEN ${(item.unitPriceCents / 100).toFixed(2)}`)
        .join("\n"),
    };
    const draft = await facturaya.importInvoiceDraft(input);
    if (!draft.ok) {
      await context.reply(`No pude preparar el comprobante: ${draft.message ?? "el servicio de facturación no respondió"}. La venta quedó guardada.`);
      return;
    }
    state.pendingInvoice = { ...pending, facturayaDraftId: draft.data.id };
    await save();
    const totals = draft.data.totals;
    await context.sendButtons?.(
      `${documentType === "01" ? "Factura" : "Boleta"} lista para emitir a ${customer?.name ?? "Cliente varios"} por S/ ${Number(totals?.total ?? 0).toFixed(2)}`
      + ` (IGV S/ ${Number(totals?.igv ?? 0).toFixed(2)}). ¿La emito ante SUNAT?`,
      [{ id: `sales:issue:${draft.data.id}`, title: "Emitir" }, { id: "sales:invoice:none", title: "No emitir" }],
    );
  }

  private async issueInvoice(context: RoleHandlerContext, client: SalesClient, state: SalesState, companyId: string, draftId: string, save: () => Promise<void>) {
    const pending = state.pendingInvoice;
    if (!pending || pending.facturayaDraftId !== draftId) {
      await context.reply("Ese botón ya no aplica.");
      return;
    }
    const facturaya = await this.facturayaFor(context, companyId);
    if (!facturaya) {
      await context.reply("Invoice Cat no está disponible ahora. La venta quedó guardada.");
      return;
    }
    state.pendingInvoice = null;
    await save();
    const issued = await facturaya.issueInvoice(draftId);
    if (!issued.ok) {
      await context.reply(`No pude emitir el comprobante: ${issued.message ?? "el servicio de facturación no respondió"}. Revísalo con Invoice Cat.`);
      return;
    }
    await client.linkInvoice(companyId, pending.saleNumber, issued.data.number);
    if (issued.data.status !== "accepted") {
      await context.reply(`Emití ${issued.data.number}; SUNAT lo dejó en estado «${issued.data.status}». Invoice Cat te avisará cómo sigue.`);
      return;
    }
    const lowStock = await context.stockAlertsAfterInvoice?.();
    if (lowStock) await context.reply(lowStock);
    const pdf = issued.data.files?.pdf ? await facturaya.downloadFile(issued.data.files.pdf) : null;
    if (pdf?.ok) {
      await context.sendDocument({
        pdf: new Blob([new Uint8Array(pdf.data.bytes)], { type: pdf.data.mimeType || "application/pdf" }),
        filename: pdf.data.filename || `${issued.data.number}.pdf`,
        caption: `${issued.data.number}, aceptado por SUNAT.`,
      });
    } else {
      await context.reply(`${issued.data.number} fue aceptado por SUNAT. Puedes descargarlo en app.meowlab.tech.`);
    }
  }

  /** FacturaYa working on the same company as Sales Cat, or null. */
  private async facturayaFor(context: RoleHandlerContext, companyId: string): Promise<FacturayaClient | null> {
    const facturaya = context.facturaya;
    if (!facturaya) return null;
    const access = await facturaya.resolveTenantAccess();
    if (access.status === "authorized" && access.tenant.id === companyId) return facturaya;
    if (access.tenants.some((tenant) => tenant.id === companyId)) {
      const selected = await facturaya.selectTenant(companyId);
      return selected.status === "authorized" ? facturaya : null;
    }
    return null;
  }
}
