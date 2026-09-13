import { signBody } from "./client";
import type {
  StoreCatalog,
  StoreCatalogRequest,
  StoreCatalogResult,
  StoreCommerceClient,
  StoreCommerceFailureReason,
  StoreDraftActionRequest,
  StoreDraftOrder,
  StoreDraftOrderRequest,
  StoreDraftOrderResult,
  StoreCatalogVariant,
} from "../../store-commerce/contracts";

const REQUEST_TIMEOUT_MS = 30_000;

type CommerceResponse = {
  error?: unknown;
  variants?: unknown;
  orderId?: unknown;
  status?: unknown;
  designId?: unknown;
  designVersion?: unknown;
  variantId?: unknown;
  productType?: unknown;
  productName?: unknown;
  color?: unknown;
  size?: unknown;
  quantity?: unknown;
  unitPrice?: unknown;
  totalAmount?: unknown;
  currencyId?: unknown;
  alreadyExisting?: unknown;
  confirmedAt?: unknown;
  checkoutUrl?: unknown;
};

type SignedCallResult = {
  response: Response;
  payload: CommerceResponse | null;
};

function validText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function knownFailure(value: unknown): StoreCommerceFailureReason | null {
  const reason = typeof value === "string" ? value : "";
  const allowed: StoreCommerceFailureReason[] = [
    "design_access_invalid",
    "database_unavailable",
    "design_not_approved",
    "catalog_unavailable",
    "catalog_variant_invalid",
    "quantity_invalid",
    "insufficient_stock",
    "draft_unavailable",
    "draft_not_found",
    "payment_unavailable",
    "payment_creation_failed",
  ];
  return allowed.includes(reason as StoreCommerceFailureReason)
    ? reason as StoreCommerceFailureReason
    : null;
}

function parseVariant(value: unknown): StoreCatalogVariant | null {
  if (!isRecord(value)) return null;
  const availableQuantity = Number(value.availableQuantity);
  const unitPrice = Number(value.unitPrice);
  if (
    !validText(value.id, 160) ||
    !validText(value.tenantId, 120) ||
    !validText(value.productType, 40) ||
    !validText(value.productName, 80) ||
    !validText(value.color, 40) ||
    !validText(value.colorName, 80) ||
    !validText(value.size, 20) ||
    !validText(value.sizeName, 40) ||
    !Number.isFinite(unitPrice) ||
    unitPrice <= 0 ||
    !validText(value.currencyId, 8) ||
    !Number.isInteger(availableQuantity) ||
    availableQuantity < 0
  ) return null;
  return {
    id: value.id,
    tenantId: value.tenantId,
    productType: value.productType,
    productName: value.productName,
    color: value.color,
    colorName: value.colorName,
    size: value.size,
    sizeName: value.sizeName,
    unitPrice,
    currencyId: value.currencyId,
    availableQuantity,
  };
}

function parseOrder(value: CommerceResponse): StoreDraftOrder | null {
  const quantity = Number(value.quantity);
  const unitPrice = Number(value.unitPrice);
  const totalAmount = Number(value.totalAmount);
  const status = value.status;
  if (
    !validText(value.orderId, 160) ||
    (status !== "draft" && status !== "cancelled" && status !== "pending_payment" && status !== "payment_processing" && status !== "awaiting_payment" && status !== "paid" && status !== "rejected" && status !== "refunded" && status !== "charged_back") ||
    !validText(value.designId, 160) ||
    typeof value.designVersion !== "number" ||
    !Number.isInteger(value.designVersion) ||
    !validText(value.productType, 40) ||
    !validText(value.productName, 80) ||
    !validText(value.color, 80) ||
    !validText(value.size, 40) ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    !Number.isFinite(unitPrice) ||
    unitPrice <= 0 ||
    !Number.isFinite(totalAmount) ||
    totalAmount <= 0 ||
    !validText(value.currencyId, 8) ||
    typeof value.alreadyExisting !== "boolean" ||
    (value.confirmedAt !== null && !validText(value.confirmedAt, 80)) ||
    (value.checkoutUrl !== null && value.checkoutUrl !== undefined && !validText(value.checkoutUrl, 2_000))
  ) return null;
  return {
    orderId: value.orderId,
    status,
    designId: value.designId,
    designVersion: value.designVersion,
    variantId: typeof value.variantId === "string" ? value.variantId : null,
    productType: value.productType,
    productName: value.productName,
    color: value.color,
    size: value.size,
    quantity,
    unitPrice,
    totalAmount,
    currencyId: value.currencyId,
    alreadyExisting: value.alreadyExisting,
    confirmedAt: value.confirmedAt === null ? null : value.confirmedAt,
    checkoutUrl: value.checkoutUrl === null || value.checkoutUrl === undefined ? null : value.checkoutUrl,
  };
}

export class SignedStoreCommerceClient implements StoreCommerceClient {
  constructor(
    private readonly endpoint: string | undefined,
    private readonly secret: string | undefined,
    private readonly log: (event: string, details?: Record<string, unknown>) => void,
  ) {}

  private async call(body: Record<string, unknown>): Promise<SignedCallResult | null> {
    if (!this.endpoint?.trim() || !this.secret?.trim()) {
      this.log("whatsapp_store_commerce_failed", { reason: "api_not_configured" });
      return null;
    }

    const serialized = JSON.stringify(body);
    const timestamp = Math.floor(Date.now() / 1_000).toString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "X-Store-Timestamp": timestamp,
          "X-Store-Signature": await signBody(this.secret, timestamp, serialized),
        },
        body: serialized,
      });
      const payload = (await response.json().catch(() => null)) as CommerceResponse | null;
      return { response, payload };
    } catch {
      this.log("whatsapp_store_commerce_failed", { reason: "api_error" });
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getCatalog(request: StoreCatalogRequest): Promise<StoreCatalogResult> {
    const result = await this.call({
      action: "get_catalog",
      requestId: crypto.randomUUID(),
      ...request,
    });
    if (!result) return { ok: false, reason: "api_error" };
    const failure = knownFailure(result.payload?.error);
    if (!result.response.ok) {
      return { ok: false, reason: failure || "api_error" };
    }
    const variants = Array.isArray(result.payload?.variants)
      ? result.payload.variants.map(parseVariant)
      : [];
    if (variants.length === 0 || variants.some((variant) => variant === null)) {
      this.log("whatsapp_store_catalog_failed", { reason: "invalid_response" });
      return { ok: false, reason: "invalid_response" };
    }
    const catalog: StoreCatalog = { variants: variants as StoreCatalogVariant[] };
    this.log("whatsapp_store_catalog_loaded", { variantCount: catalog.variants.length });
    return { ok: true, catalog };
  }

  async createDraftOrder(request: StoreDraftOrderRequest): Promise<StoreDraftOrderResult> {
    const result = await this.call({
      action: "create_draft_order",
      requestId: crypto.randomUUID(),
      ...request,
    });
    if (!result) return { ok: false, reason: "api_error" };
    const failure = knownFailure(result.payload?.error);
    if (!result.response.ok) return { ok: false, reason: failure || "api_error" };
    const order = result.payload ? parseOrder(result.payload) : null;
    if (!order) {
      this.log("whatsapp_store_draft_failed", { reason: "invalid_response" });
      return { ok: false, reason: "invalid_response" };
    }
    return { ok: true, order };
  }

  async confirmDraftOrder(request: StoreDraftActionRequest): Promise<StoreDraftOrderResult> {
    return this.draftAction("confirm_draft_order", request);
  }

  async cancelDraftOrder(request: StoreDraftActionRequest): Promise<StoreDraftOrderResult> {
    return this.draftAction("cancel_draft_order", request);
  }

  private async draftAction(
    action: "confirm_draft_order" | "cancel_draft_order",
    request: StoreDraftActionRequest,
  ): Promise<StoreDraftOrderResult> {
    const result = await this.call({
      action,
      requestId: crypto.randomUUID(),
      ...request,
    });
    if (!result) return { ok: false, reason: "api_error" };
    const failure = knownFailure(result.payload?.error);
    if (!result.response.ok) return { ok: false, reason: failure || "api_error" };
    const order = result.payload ? parseOrder(result.payload) : null;
    if (!order) {
      this.log("whatsapp_store_draft_failed", { reason: "invalid_response" });
      return { ok: false, reason: "invalid_response" };
    }
    return { ok: true, order };
  }
}
