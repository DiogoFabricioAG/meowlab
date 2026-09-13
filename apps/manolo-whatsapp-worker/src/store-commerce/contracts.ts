export type StoreDesignConfigurationReference = {
  tenantId: string;
  contactId: number;
  whatsappUserId: string;
  phoneNumberId?: string;
  designId: string;
  accessToken: string;
  version: number;
};

export type StoreCatalogVariant = {
  id: string;
  tenantId: string;
  productType: string;
  productName: string;
  color: string;
  colorName: string;
  size: string;
  sizeName: string;
  unitPrice: number;
  currencyId: string;
  availableQuantity: number;
};

export type StoreCatalogRequest = StoreDesignConfigurationReference;

export type StoreCatalog = {
  variants: StoreCatalogVariant[];
};

export type StoreDraftOrderRequest = StoreDesignConfigurationReference & {
  variantId: string;
  quantity: number;
  idempotencyKey: string;
};

export type StoreDraftOrder = {
  orderId: string;
  status: "draft" | "cancelled" | "pending_payment" | "payment_processing" | "awaiting_payment" | "paid" | "rejected" | "refunded" | "charged_back";
  designId: string;
  designVersion: number;
  variantId: string | null;
  productType: string;
  productName: string;
  color: string;
  size: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  currencyId: string;
  alreadyExisting: boolean;
  confirmedAt: string | null;
  checkoutUrl: string | null;
};

export type StoreDraftActionRequest = {
  tenantId: string;
  contactId: number;
  whatsappUserId: string;
  orderId: string;
  phoneNumberId?: string;
  designId?: string;
  accessToken?: string;
  version?: number;
};

export type StoreCommerceFailureReason =
  | "api_not_configured"
  | "api_error"
  | "invalid_response"
  | "design_access_invalid"
  | "database_unavailable"
  | "design_not_approved"
  | "catalog_unavailable"
  | "catalog_variant_invalid"
  | "quantity_invalid"
  | "insufficient_stock"
  | "draft_unavailable"
  | "draft_not_found"
  | "payment_unavailable"
  | "payment_creation_failed";

export type StoreCatalogResult =
  | { ok: true; catalog: StoreCatalog }
  | { ok: false; reason: StoreCommerceFailureReason };

export type StoreDraftOrderResult =
  | { ok: true; order: StoreDraftOrder }
  | { ok: false; reason: StoreCommerceFailureReason };

export interface StoreCommerceClient {
  getCatalog(request: StoreCatalogRequest): Promise<StoreCatalogResult>;
  createDraftOrder(request: StoreDraftOrderRequest): Promise<StoreDraftOrderResult>;
  confirmDraftOrder(request: StoreDraftActionRequest): Promise<StoreDraftOrderResult>;
  cancelDraftOrder(request: StoreDraftActionRequest): Promise<StoreDraftOrderResult>;
}
