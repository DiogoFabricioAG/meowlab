import type { RoleHandler, RoleHandlerContext, TenantContext } from "./contracts";
import type { StoreDesignReference } from "../store-designer/contracts";
import type {
  StoreCatalogVariant,
  StoreDraftOrder,
} from "../store-commerce/contracts";
import type { WhatsAppListSection } from "../whatsapp/contracts";

export const STORE_DESIGNER_ROLE_KEY = "store-designer";
const STORE_DESIGNER_STATE_KEY = STORE_DESIGNER_ROLE_KEY;
const MODIFY_DESIGN_BUTTON_ID = "store_modify_design";
const APPROVE_DESIGN_BUTTON_ID = "store_approve_design";
const VIEW_DESIGN_BUTTON_ID = "store_view_store";
const LEGACY_NEW_DESIGN_BUTTON_ID = "store_new_design";
const LEGACY_VIEW_DESIGN_BUTTON_ID = "store_view_design";
const CONFIRM_ORDER_BUTTON_ID = "store_confirm_order";
const CHANGE_OPTIONS_BUTTON_ID = "store_change_options";
const CANCEL_ORDER_BUTTON_ID = "store_cancel_order";

const STORE_DESIGNER_ACTION_BUTTONS = [
  { id: MODIFY_DESIGN_BUTTON_ID, title: "Modificar diseño" },
  { id: APPROVE_DESIGN_BUTTON_ID, title: "Aprobar diseño" },
  { id: VIEW_DESIGN_BUTTON_ID, title: "Ver en tienda" },
] as const;

type StoreDesignerState = StoreDesignReference & {
  proposalUrl: string;
  version: number;
  imageUrl?: string;
  status?: "proposal" | "approved";
  approvedAt?: string;
  configuration?: ProductConfigurationState;
};

type ProductConfigurationPhase =
  | "select_product"
  | "select_color"
  | "select_size"
  | "select_quantity"
  | "review"
  | "awaiting_payment"
  | "confirmed";

type ProductConfigurationState = {
  sessionId: string;
  phase: ProductConfigurationPhase;
  variants: StoreCatalogVariant[];
  productType?: string;
  color?: string;
  size?: string;
  quantity?: number;
  draftOrder?: StoreDraftOrder;
};

const CONFIGURATION_PHASES = new Set<ProductConfigurationPhase>([
  "select_product",
  "select_color",
  "select_size",
  "select_quantity",
  "review",
  "awaiting_payment",
  "confirmed",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseConfiguration(value: unknown): ProductConfigurationState | undefined {
  if (!isRecord(value)) return undefined;
  const phase = value.phase;
  const variants = Array.isArray(value.variants) ? value.variants : [];
  if (
    typeof value.sessionId !== "string" ||
    !CONFIGURATION_PHASES.has(phase as ProductConfigurationPhase) ||
    variants.length === 0
  ) return undefined;

  const parsedVariants = variants.filter((variant): variant is StoreCatalogVariant => {
    if (!isRecord(variant)) return false;
    return [
      "id", "tenantId", "productType", "productName", "color", "colorName",
      "size", "sizeName", "currencyId",
    ].every((key) => typeof variant[key] === "string")
      && typeof variant.unitPrice === "number"
      && typeof variant.availableQuantity === "number";
  });
  if (parsedVariants.length !== variants.length) return undefined;

  const quantity = typeof value.quantity === "number" ? value.quantity : undefined;
  const draftOrder = isRecord(value.draftOrder) ? value.draftOrder as unknown as StoreDraftOrder : undefined;
  return {
    sessionId: value.sessionId,
    phase: phase as ProductConfigurationPhase,
    variants: parsedVariants,
    ...(typeof value.productType === "string" ? { productType: value.productType } : {}),
    ...(typeof value.color === "string" ? { color: value.color } : {}),
    ...(typeof value.size === "string" ? { size: value.size } : {}),
    ...(quantity !== undefined ? { quantity } : {}),
    ...(draftOrder ? { draftOrder } : {}),
  };
}

function parseState(value: string | null): StoreDesignerState | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<StoreDesignerState>;
    if (
      typeof parsed.designId !== "string" ||
      typeof parsed.accessToken !== "string" ||
      typeof parsed.proposalUrl !== "string" ||
      typeof parsed.version !== "number" ||
      !Number.isInteger(parsed.version)
    ) {
      return null;
    }
    const imageUrl = typeof parsed.imageUrl === "string" ? parsed.imageUrl : undefined;
    const status = parsed.status === "approved" ? "approved" : "proposal";
    const approvedAt = typeof parsed.approvedAt === "string" ? parsed.approvedAt : undefined;
    const configuration = parseConfiguration(parsed.configuration);
    return {
      designId: parsed.designId,
      accessToken: parsed.accessToken,
      proposalUrl: parsed.proposalUrl,
      version: parsed.version,
      ...(imageUrl ? { imageUrl } : {}),
      status,
      ...(approvedAt ? { approvedAt } : {}),
      ...(configuration ? { configuration } : {}),
    };
  } catch {
    return null;
  }
}

function requestsNewDesign(text: string): boolean {
  return /^(?:nueva|otro|otra|reinicia|reiniciar)\s+(?:propuesta|diseño|dise[nñ]o)|^quiero\s+(?:un|una)\s+(?:nuevo|nueva)\s+(?:diseño|propuesta)/iu.test(
    text.trim(),
  );
}

function normalizeOption(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .trim()
    .toLowerCase();
}

function uniqueOptions<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = key(value);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function productVariants(
  configuration: ProductConfigurationState,
): StoreCatalogVariant[] {
  return configuration.variants.filter((variant) =>
    !configuration.productType || variant.productType === configuration.productType,
  ).filter((variant) =>
    !configuration.color || variant.color === configuration.color,
  ).filter((variant) =>
    !configuration.size || variant.size === configuration.size,
  );
}

function formatMoney(amount: number, currencyId: string): string {
  return `${currencyId} ${new Intl.NumberFormat("es-CO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)}`;
}

function isAction(messageText: string, interactionId: string | null, id: string, pattern: RegExp): boolean {
  return interactionId === id || pattern.test(normalizeOption(messageText));
}

function proposalReply(
  proposal: StoreDesignerState & { brief: string },
  revision: boolean,
): string {
  return [
    revision ? "🎨 Actualicé tu propuesta." : "🎨 Preparé una propuesta para tu idea.",
    "",
    proposal.brief,
    "",
    `Versión ${proposal.version}: ${proposal.proposalUrl}`,
    "",
    "Puedes pedirme cambios escribiéndolos aquí. Para empezar otro diseño, escribe: nueva propuesta.",
  ].join("\n");
}

function proposalCaption(
  proposal: StoreDesignerState & { brief: string },
  revision: boolean,
): string {
  return [
    revision ? "🎨 Actualicé tu propuesta." : "🎨 Preparé una propuesta para tu idea.",
    "",
    proposal.brief.slice(0, 700),
    "",
    `Versión ${proposal.version}`,
    `Ver propuesta: ${proposal.proposalUrl}`,
  ].join("\n");
}

export class StoreDesignerRoleHandler implements RoleHandler {
  readonly key = STORE_DESIGNER_ROLE_KEY;

  configure(tenant: TenantContext): TenantContext {
    return {
      ...tenant,
      roleKey: STORE_DESIGNER_ROLE_KEY,
      aiProvider: "store-internal",
      systemPrompt: "",
      temperature: 0.2,
      maxTokens: 180,
    };
  }

  async handle(context: RoleHandlerContext): Promise<void> {
    const { tenant, persisted, message, log } = context;
    if (persisted.contactId === null || !context.storeDesigner) {
      log("whatsapp_store_design_failed", {
        reason: persisted.contactId === null ? "missing_contact" : "client_unavailable",
      });
      await context.reply(
        "No pude conectar el diseñador de la tienda en este momento. Intenta nuevamente en unos segundos.",
      );
      return;
    }

    const storedState = parseState(
      context.roleState
        ? await context.roleState.get(tenant.tenantId, persisted.contactId, STORE_DESIGNER_STATE_KEY)
        : null,
    );

    if (storedState?.configuration && !requestsNewDesign(message.text)) {
      const handled = await this.handleProductConfiguration(context, storedState);
      if (handled) return;
    }

    if (message.interactionId === MODIFY_DESIGN_BUTTON_ID) {
      if (storedState?.status === "approved") {
        await context.reply(
          "Este diseño ya fue aprobado. Escribe nueva propuesta si quieres comenzar otro diseño.",
        );
        return;
      }
      await context.reply(
        "Perfecto. Escríbeme el cambio que quieres hacer, o envíamelo como nota de voz.",
      );
      return;
    }

    if (message.interactionId === APPROVE_DESIGN_BUTTON_ID) {
      if (!storedState) {
        await context.reply(
          "Todavía no hay una propuesta activa para aprobar. Envíame primero la idea del diseño.",
        );
        return;
      }

      if (storedState.status === "approved") {
        await context.reply(
          `✅ Este diseño ya está aprobado (versión ${storedState.version}).\nVer en tienda: ${storedState.proposalUrl}`,
        );
        if (!storedState.configuration) {
          await this.startProductConfiguration(context, storedState);
        }
        return;
      }

      const approval = await context.storeDesigner.approve({
        tenantId: tenant.tenantId,
        contactId: persisted.contactId,
        whatsappUserId: message.to,
        designId: storedState.designId,
        accessToken: storedState.accessToken,
        version: storedState.version,
      });
      if (!approval.ok) {
        await context.reply(
          "No pude aprobar el diseño en este momento. Intenta nuevamente en unos segundos.",
        );
        return;
      }

      const approvedState: StoreDesignerState = {
        ...storedState,
        version: approval.approval.version,
        proposalUrl: approval.approval.proposalUrl,
        status: "approved",
        approvedAt: new Date().toISOString(),
      };
      await this.persistState(context, approvedState);
      await context.reply(
        approval.approval.alreadyApproved
          ? `✅ El diseño ya estaba aprobado (versión ${approval.approval.version}).\nVer en tienda: ${approval.approval.proposalUrl}`
          : `✅ Diseño aprobado (versión ${approval.approval.version}).\nVer en tienda: ${approval.approval.proposalUrl}`,
      );
      await this.startProductConfiguration(context, approvedState);
      return;
    }

    if (
      message.interactionId === VIEW_DESIGN_BUTTON_ID
      || message.interactionId === LEGACY_VIEW_DESIGN_BUTTON_ID
    ) {
      await context.reply(
        storedState
          ? `Aquí tienes el enlace de tu diseño en la tienda:\n${storedState.proposalUrl}`
          : "Todavía no hay una propuesta activa. Envíame primero la idea del diseño.",
      );
      return;
    }

    // Mantiene compatibilidad con botones de propuestas enviadas antes de esta iteración.
    if (message.interactionId === LEGACY_NEW_DESIGN_BUTTON_ID) {
      if (context.roleState) {
        const cleared = await context.roleState.clear(
          tenant.tenantId,
          persisted.contactId,
          STORE_DESIGNER_STATE_KEY,
        );
        if (!cleared) {
          log("whatsapp_store_design_state_failed", {
            reason: "clear_error",
          });
        }
      }
      await context.reply(
        "Listo. Empecemos una propuesta nueva. Envíame la idea del siguiente diseño.",
      );
      return;
    }

    if (storedState?.status === "approved" && !requestsNewDesign(message.text)) {
      await this.startProductConfiguration(context, storedState);
      return;
    }

    const currentDesign =
      requestsNewDesign(message.text) || !storedState
        ? null
        : {
            designId: storedState.designId,
            accessToken: storedState.accessToken,
          };
    const result = await context.storeDesigner.generate({
      tenantId: tenant.tenantId,
      contactId: persisted.contactId,
      whatsappUserId: message.to,
      input: message.text,
      currentDesign,
    });

    if (!result.ok && result.reason === "design_access_invalid" && currentDesign) {
      log("whatsapp_store_design_state_expired");
      const retry = await context.storeDesigner.generate({
        tenantId: tenant.tenantId,
        contactId: persisted.contactId,
        whatsappUserId: message.to,
        input: message.text,
        currentDesign: null,
      });
      if (retry.ok) {
        await this.persistState(context, retry.proposal);
        await this.respondWithProposal(context, retry.proposal, false);
        return;
      }
    }

    if (!result.ok) {
      await context.reply(
        "No pude generar la propuesta de la tienda en este momento. Intenta nuevamente en unos segundos.",
      );
      return;
    }

    await this.persistState(context, result.proposal);
    await this.respondWithProposal(
      context,
      result.proposal,
      Boolean(currentDesign),
    );
  }

  private async startProductConfiguration(
    context: RoleHandlerContext,
    state: StoreDesignerState,
  ): Promise<void> {
    if (!context.storeCommerce || context.persisted.contactId === null) {
      await context.reply(
        "El diseño quedó aprobado. No pude cargar el catálogo para configurar el pedido; intenta nuevamente en unos segundos.",
      );
      return;
    }

    const catalog = await context.storeCommerce.getCatalog({
      tenantId: context.tenant.tenantId,
      contactId: context.persisted.contactId,
      whatsappUserId: context.message.to,
      designId: state.designId,
      accessToken: state.accessToken,
      version: state.version,
    });
    if (!catalog.ok || catalog.catalog.variants.length === 0) {
      context.log("whatsapp_store_catalog_failed", {
        reason: catalog.ok ? "empty_catalog" : catalog.reason,
      });
      await context.reply(
        "El diseño quedó aprobado, pero no pude cargar las opciones disponibles de la tienda.",
      );
      return;
    }

    const nextState: StoreDesignerState = {
      ...state,
      status: "approved",
      configuration: {
        sessionId: `store_config_${crypto.randomUUID()}`,
        phase: "select_product",
        variants: catalog.catalog.variants,
      },
    };
    await this.persistState(context, nextState);
    await context.reply("✅ Diseño aprobado. Ahora elige el tipo de prenda:");
    await this.sendProductOptions(context, nextState.configuration!);
  }

  private async handleProductConfiguration(
    context: RoleHandlerContext,
    state: StoreDesignerState,
  ): Promise<boolean> {
    const configuration = state.configuration;
    if (!configuration || requestsNewDesign(context.message.text)) return false;
    if (
      context.message.interactionId === MODIFY_DESIGN_BUTTON_ID
      || context.message.interactionId === APPROVE_DESIGN_BUTTON_ID
      || context.message.interactionId === VIEW_DESIGN_BUTTON_ID
      || context.message.interactionId === LEGACY_VIEW_DESIGN_BUTTON_ID
    ) return false;
    if (!context.storeCommerce || context.persisted.contactId === null) {
      await context.reply("No pude continuar la configuración de la tienda. Intenta nuevamente en unos segundos.");
      return true;
    }

    if (isAction(context.message.text, context.message.interactionId, CONFIRM_ORDER_BUTTON_ID, /^(?:confirmar|confirmar pedido)$/u)) {
      await this.confirmDraftOrder(context, state);
      return true;
    }
    if (isAction(context.message.text, context.message.interactionId, CHANGE_OPTIONS_BUTTON_ID, /^(?:cambiar|cambiar opciones|modificar opciones)$/u)) {
      const { configuration: _configuration, ...approvedState } = state;
      await this.startProductConfiguration(context, approvedState);
      return true;
    }
    if (isAction(context.message.text, context.message.interactionId, CANCEL_ORDER_BUTTON_ID, /^(?:cancelar|cancelar pedido)$/u)) {
      await this.cancelDraftOrder(context, state);
      return true;
    }

    if (configuration.phase === "review" || configuration.phase === "awaiting_payment" || configuration.phase === "confirmed") {
      if (configuration.phase === "awaiting_payment") {
        await context.reply([
          "El pedido está pendiente de pago.",
          configuration.draftOrder?.checkoutUrl
            ? `Pagar pedido: ${configuration.draftOrder.checkoutUrl}`
            : "",
        ].filter(Boolean).join("\n"));
      } else {
        await context.reply(
          configuration.phase === "confirmed"
            ? "El pedido ya fue pagado y está confirmado."
            : "Revisa el resumen y elige Confirmar pedido, Cambiar opciones o Cancelar.",
        );
      }
      return true;
    }

    if (configuration.phase === "select_product") {
      const products = uniqueOptions(configuration.variants, (variant) => variant.productType);
      const selected = products.find((variant) =>
        context.message.interactionId === `store_product_${variant.productType}`
        || [variant.productType, variant.productName].some((value) => normalizeOption(value) === normalizeOption(context.message.text)),
      );
      if (!selected) {
        await context.reply(`Elige una prenda válida: ${products.map((variant) => variant.productName).join(" o ")}.`);
        return true;
      }
      const nextState: StoreDesignerState = {
        ...state,
        configuration: {
          ...configuration,
          phase: "select_color",
          productType: selected.productType,
          color: undefined,
          size: undefined,
          quantity: undefined,
          draftOrder: undefined,
        },
      };
      await this.persistState(context, nextState);
      await context.reply(`Perfecto. Ahora elige el color para tu ${selected.productName.toLowerCase()}:`);
      await this.sendColorOptions(context, nextState.configuration!);
      return true;
    }

    if (configuration.phase === "select_color" && configuration.productType) {
      const colors = uniqueOptions(
        productVariants(configuration),
        (variant) => variant.color,
      );
      const selected = colors.find((variant) =>
        context.message.interactionId === `store_color_${variant.color}`
        || [variant.color, variant.colorName].some((value) => normalizeOption(value) === normalizeOption(context.message.text)),
      );
      if (!selected) {
        await context.reply(`Elige un color válido: ${colors.map((variant) => variant.colorName).join(", ")}.`);
        return true;
      }
      const nextState: StoreDesignerState = {
        ...state,
        configuration: {
          ...configuration,
          phase: "select_size",
          color: selected.color,
          size: undefined,
          quantity: undefined,
          draftOrder: undefined,
        },
      };
      await this.persistState(context, nextState);
      await context.reply("Ahora elige la talla:");
      await this.sendSizeOptions(context, nextState.configuration!);
      return true;
    }

    if (configuration.phase === "select_size" && configuration.productType && configuration.color) {
      const sizes = uniqueOptions(productVariants(configuration), (variant) => variant.size);
      const selected = sizes.find((variant) =>
        context.message.interactionId === `store_size_${variant.size}`
        || [variant.size, variant.sizeName].some((value) => normalizeOption(value) === normalizeOption(context.message.text)),
      );
      if (!selected) {
        await context.reply(`Elige una talla válida: ${sizes.map((variant) => variant.sizeName).join(", ")}.`);
        return true;
      }
      const nextState: StoreDesignerState = {
        ...state,
        configuration: {
          ...configuration,
          phase: "select_quantity",
          size: selected.size,
          quantity: undefined,
          draftOrder: undefined,
        },
      };
      await this.persistState(context, nextState);
      await context.reply("¿Cuántas unidades necesitas?");
      await this.sendQuantityOptions(context, nextState.configuration!);
      return true;
    }

    if (configuration.phase === "select_quantity") {
      const selectedVariant = productVariants(configuration)[0];
      const quantityFromInteraction = context.message.interactionId?.startsWith("store_quantity_")
        ? Number(context.message.interactionId.slice("store_quantity_".length))
        : Number(context.message.text);
      const maxQuantity = selectedVariant?.availableQuantity ?? 0;
      if (
        !selectedVariant ||
        !Number.isInteger(quantityFromInteraction) ||
        quantityFromInteraction < 1 ||
        quantityFromInteraction > Math.min(20, maxQuantity)
      ) {
        await context.reply(`Indica una cantidad entre 1 y ${Math.min(20, maxQuantity)}.`);
        return true;
      }

      const idempotencyKey = `${configuration.sessionId}:${selectedVariant.id}:${quantityFromInteraction}`;
      const draft = await context.storeCommerce.createDraftOrder({
        tenantId: context.tenant.tenantId,
        contactId: context.persisted.contactId,
        whatsappUserId: context.message.to,
        phoneNumberId: context.tenant.phoneNumberId,
        designId: state.designId,
        accessToken: state.accessToken,
        version: state.version,
        variantId: selectedVariant.id,
        quantity: quantityFromInteraction,
        idempotencyKey,
      });
      if (!draft.ok) {
        await context.reply(
          draft.reason === "insufficient_stock"
            ? "No hay suficiente disponibilidad para esa cantidad. Elige una cantidad menor."
            : "No pude crear el pedido borrador. Intenta nuevamente en unos segundos.",
        );
        return true;
      }

      const nextState: StoreDesignerState = {
        ...state,
        configuration: {
          ...configuration,
          phase: "review",
          quantity: quantityFromInteraction,
          draftOrder: draft.order,
        },
      };
      await this.persistState(context, nextState);
      await this.sendDraftSummary(context, draft.order);
      return true;
    }

    return true;
  }

  private async sendProductOptions(
    context: RoleHandlerContext,
    configuration: ProductConfigurationState,
  ): Promise<void> {
    const products = uniqueOptions(configuration.variants, (variant) => variant.productType);
    if (context.sendButtons) {
      const result = await context.sendButtons(
        "Selecciona el tipo de prenda:",
        products.slice(0, 3).map((variant) => ({
          id: `store_product_${variant.productType}`,
          title: variant.productName,
        })),
      );
      if (result.status === "sent") return;
    }
    await context.reply(`Opciones disponibles: ${products.map((variant) => variant.productName).join(" o ")}.`);
  }

  private async sendColorOptions(
    context: RoleHandlerContext,
    configuration: ProductConfigurationState,
  ): Promise<void> {
    const colors = uniqueOptions(productVariants(configuration), (variant) => variant.color);
    const sections: WhatsAppListSection[] = [{
      title: "Colores disponibles",
      rows: colors.map((variant) => ({
        id: `store_color_${variant.color}`,
        title: variant.colorName,
        description: `${new Set(productVariants(configuration).filter((item) => item.color === variant.color).map((item) => item.size)).size} tallas disponibles`,
      })),
    }];
    if (context.sendList) {
      const result = await context.sendList("Elige el color de tu prenda:", "Ver colores", sections);
      if (result.status === "sent") return;
    }
    await context.reply(`Colores disponibles: ${colors.map((variant) => variant.colorName).join(", ")}.`);
  }

  private async sendSizeOptions(
    context: RoleHandlerContext,
    configuration: ProductConfigurationState,
  ): Promise<void> {
    const sizes = uniqueOptions(productVariants(configuration), (variant) => variant.size);
    const sections: WhatsAppListSection[] = [{
      title: "Tallas disponibles",
      rows: sizes.map((variant) => ({
        id: `store_size_${variant.size}`,
        title: variant.sizeName,
        description: `Hasta ${variant.availableQuantity} unidades disponibles`,
      })),
    }];
    if (context.sendList) {
      const result = await context.sendList("Elige la talla:", "Ver tallas", sections);
      if (result.status === "sent") return;
    }
    await context.reply(`Tallas disponibles: ${sizes.map((variant) => variant.sizeName).join(", ")}.`);
  }

  private async sendQuantityOptions(
    context: RoleHandlerContext,
    configuration: ProductConfigurationState,
  ): Promise<void> {
    const variant = productVariants(configuration)[0];
    const maximum = Math.min(20, variant?.availableQuantity ?? 0);
    const sections: WhatsAppListSection[] = [{
      title: "Cantidad",
      rows: Array.from({ length: maximum }, (_, index) => ({
        id: `store_quantity_${index + 1}`,
        title: `${index + 1} ${index === 0 ? "unidad" : "unidades"}`,
      })),
    }];
    if (context.sendList && maximum > 0) {
      const result = await context.sendList("Selecciona la cantidad:", "Ver cantidades", sections);
      if (result.status === "sent") return;
    }
    await context.reply(`Escribe la cantidad, entre 1 y ${maximum}.`);
  }

  private async sendDraftSummary(
    context: RoleHandlerContext,
    order: StoreDraftOrder,
  ): Promise<void> {
    await context.reply([
      "✅ Diseño aprobado.",
      "",
      `Prenda: ${order.productName}`,
      `Color: ${order.color}`,
      `Talla: ${order.size}`,
      `Cantidad: ${order.quantity}`,
      `Precio unitario: ${formatMoney(order.unitPrice, order.currencyId)}`,
      `Total: ${formatMoney(order.totalAmount, order.currencyId)}`,
      "",
      "Preparé un pedido borrador. Elige una acción:",
    ].join("\n"));
    if (context.sendButtons) {
      const result = await context.sendButtons("¿Qué deseas hacer?", [
        { id: CONFIRM_ORDER_BUTTON_ID, title: "Confirmar pedido" },
        { id: CHANGE_OPTIONS_BUTTON_ID, title: "Cambiar opciones" },
        { id: CANCEL_ORDER_BUTTON_ID, title: "Cancelar" },
      ]);
      if (result.status === "sent") return;
    }
    await context.reply("Escribe confirmar, cambiar opciones o cancelar.");
  }

  private async confirmDraftOrder(
    context: RoleHandlerContext,
    state: StoreDesignerState,
  ): Promise<void> {
    const draftOrder = state.configuration?.draftOrder;
    if (!draftOrder || !context.storeCommerce || context.persisted.contactId === null) {
      await context.reply("Todavía no hay un pedido borrador para confirmar.");
      return;
    }
    const result = await context.storeCommerce.confirmDraftOrder({
      orderId: draftOrder.orderId,
      tenantId: context.tenant.tenantId,
      contactId: context.persisted.contactId,
      whatsappUserId: context.message.to,
      phoneNumberId: context.tenant.phoneNumberId,
      designId: state.designId,
      accessToken: state.accessToken,
      version: state.version,
    });
    if (!result.ok) {
      await context.reply(
        result.reason === "payment_unavailable"
          ? "El pago no está disponible en este momento. Intenta nuevamente más tarde."
          : result.reason === "payment_creation_failed"
            ? "No pude crear el enlace de pago. Intenta nuevamente en unos segundos."
            : "No pude confirmar el pedido borrador. Intenta nuevamente en unos segundos.",
      );
      return;
    }
    const nextState: StoreDesignerState = {
      ...state,
      configuration: {
        ...state.configuration!,
        phase: result.order.status === "paid" ? "confirmed" : "awaiting_payment",
        draftOrder: result.order,
      },
    };
    await this.persistState(context, nextState);
    if (result.order.status === "paid") {
      await context.reply("✅ Este pedido ya figura como pagado y confirmado.");
      return;
    }
    await context.reply([
      "✅ Pedido listo para pagar.",
      `Total: ${formatMoney(result.order.totalAmount, result.order.currencyId)}`,
      result.order.checkoutUrl ? `Pagar pedido: ${result.order.checkoutUrl}` : "",
      "Después de pagar, Mercado Pago confirmará el pedido automáticamente.",
    ].filter(Boolean).join("\n"));
    if (context.sendButtons) {
      const buttonResult = await context.sendButtons("¿Deseas cancelar este pedido?", [
        { id: CANCEL_ORDER_BUTTON_ID, title: "Cancelar" },
      ]);
      if (buttonResult.status === "sent") return;
    }
    await context.reply("Si deseas cancelar, escribe cancelar.");
  }

  private async cancelDraftOrder(
    context: RoleHandlerContext,
    state: StoreDesignerState,
  ): Promise<void> {
    const draftOrder = state.configuration?.draftOrder;
    if (draftOrder && context.storeCommerce && context.persisted.contactId !== null) {
      const result = await context.storeCommerce.cancelDraftOrder({
        orderId: draftOrder.orderId,
        tenantId: context.tenant.tenantId,
        contactId: context.persisted.contactId,
        whatsappUserId: context.message.to,
      });
      if (!result.ok) {
        await context.reply("No pude cancelar el pedido borrador. Intenta nuevamente en unos segundos.");
        return;
      }
    }
    const { configuration: _configuration, ...approvedState } = state;
    await this.persistState(context, approvedState);
    await context.reply("Pedido borrador cancelado. El diseño aprobado sigue disponible.");
  }

  private async respondWithProposal(
    context: RoleHandlerContext,
    proposal: StoreDesignerState & { brief: string },
    revision: boolean,
  ): Promise<void> {
    const replyText = proposalReply(proposal, revision);
    if (context.sendImage) {
      const imageResult = await context.sendImage(
        proposal.imageUrl ?? "",
        proposalCaption(proposal, revision),
      );
      if (imageResult.status !== "sent") {
        context.log("whatsapp_store_design_image_failed", {
          reason: imageResult.status,
        });
        await context.reply(replyText);
      }
    } else {
      await context.reply(replyText);
    }

    if (context.sendButtons) {
      const buttonResult = await context.sendButtons(
        "¿Qué deseas hacer con esta propuesta?",
        STORE_DESIGNER_ACTION_BUTTONS,
      );
      if (buttonResult.status !== "sent") {
        context.log("whatsapp_store_design_buttons_failed", {
          reason: buttonResult.status,
        });
      }
    }
  }

  private async persistState(
    context: RoleHandlerContext,
    proposal: StoreDesignerState,
  ): Promise<void> {
    if (!context.roleState || context.persisted.contactId === null) return;

    const saved = await context.roleState.set(
      context.tenant.tenantId,
      context.persisted.contactId,
      STORE_DESIGNER_STATE_KEY,
      JSON.stringify(proposal),
    );
    if (!saved) {
      context.log("whatsapp_store_design_state_failed", {
        reason: "persistence_error",
      });
    }
  }
}
