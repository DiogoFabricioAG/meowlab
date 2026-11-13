/**
 * Sales Cat (ADR-0011, phase 1): Worker → VPS bridge. Signed with the Worker's bridge
 * secret; the request id doubles as the idempotency key for writes.
 */
export const SALES_BRIDGE_PATH = "/v1/sales/execute";

export const SALES_OPERATIONS = [
  "companies",
  "catalog",
  "upsert_product",
  "create_quote",
  "create_sale",
  "cancel_sale",
  "link_invoice",
  "summary",
] as const;
export type SalesOperation = (typeof SALES_OPERATIONS)[number];

export const PAYMENT_METHODS = ["efectivo", "yape", "plin", "transferencia", "tarjeta", "credito"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const SUMMARY_PERIODS = ["today", "yesterday", "week", "month", "last_month"] as const;
export type SummaryPeriod = (typeof SUMMARY_PERIODS)[number];

export type SalesCustomerInput = { docType: "0" | "1" | "6"; docNumber: string | null; name: string } | null;
export type SalesLineInput = { description: string; quantity: number; unitPriceCents: number };

export type SalesBridgeRequest = {
  /** WhatsApp tenant of the channel (the number the person writes to). */
  channel_tenant_id: string;
  contact_id: number;
  operation: SalesOperation;
  /** The company Sales Cat works for; absent only for `companies`. */
  company_id?: string;
  payload?: Record<string, unknown>;
};

export type SalesBridgeResponse = {
  request_id: string;
  ok: boolean;
  data?: unknown;
  error?: { code: string; message?: string };
  replayed?: boolean;
};

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const cents = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 100_000_000_000;
const company = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);

export function isSalesCustomer(value: unknown): value is SalesCustomerInput {
  if (value === null) return true;
  if (!record(value) || !text(value.name, 200)) return false;
  if (value.docType === "0") return value.docNumber === null;
  if (value.docType === "1") return typeof value.docNumber === "string" && /^\d{8}$/.test(value.docNumber);
  if (value.docType === "6") return typeof value.docNumber === "string" && /^\d{11}$/.test(value.docNumber);
  return false;
}

export function isSalesLines(value: unknown): value is SalesLineInput[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= 50 && value.every((line) =>
    record(line) && text(line.description, 300)
    && typeof line.quantity === "number" && Number.isFinite(line.quantity) && line.quantity > 0 && line.quantity <= 1_000_000
    && cents(line.unitPriceCents));
}

const notes = (value: unknown) => value === undefined || value === null || (typeof value === "string" && value.length <= 1000);

export function isSalesPayload(operation: SalesOperation, payload: Record<string, unknown>): boolean {
  switch (operation) {
    case "companies":
    case "catalog":
      return true;
    case "upsert_product":
      return text(payload.name, 200) && cents(payload.unitPriceCents);
    case "create_quote":
      return isSalesCustomer(payload.customer) && isSalesLines(payload.lines)
        && (payload.discountCents === undefined || cents(payload.discountCents)) && notes(payload.notes);
    case "create_sale":
      return isSalesCustomer(payload.customer) && isSalesLines(payload.lines)
        && (payload.discountCents === undefined || cents(payload.discountCents)) && notes(payload.notes)
        && PAYMENT_METHODS.includes(payload.paymentMethod as PaymentMethod);
    case "cancel_sale":
      return Number.isSafeInteger(payload.number) && Number(payload.number) >= 1 && notes(payload.reason);
    case "link_invoice":
      return Number.isSafeInteger(payload.number) && Number(payload.number) >= 1 && text(payload.invoiceNumber, 40);
    case "summary":
      return SUMMARY_PERIODS.includes(payload.period as SummaryPeriod);
  }
}

export function isSalesBridgeRequest(value: unknown): value is SalesBridgeRequest {
  if (!record(value) || !text(value.channel_tenant_id, 128)) return false;
  if (!Number.isSafeInteger(value.contact_id) || Number(value.contact_id) < 1) return false;
  if (!SALES_OPERATIONS.includes(value.operation as SalesOperation)) return false;
  const operation = value.operation as SalesOperation;
  if (operation !== "companies" && !company(value.company_id)) return false;
  const payload = value.payload ?? {};
  return record(payload) && isSalesPayload(operation, payload);
}

export function isSalesBridgeResponse(value: unknown): value is SalesBridgeResponse {
  return record(value) && typeof value.request_id === "string" && typeof value.ok === "boolean";
}

/** Shapes returned in `data`. */
export type SalesCompany = { id: string; name: string };
export type CatalogProduct = { name: string; unitPriceCents: number };
export type SavedQuote = { id: string; number: number; totalCents: number; validUntil: string; publicToken: string };
export type SavedSale = { id: string; number: number; totalCents: number; balanceCents: number; soldAt: string };
export type SalesSummary = {
  period: SummaryPeriod;
  from: string;
  to: string;
  salesCount: number;
  totalCents: number;
  creditCents: number;
  quotesCount: number;
  quotedCents: number;
  topProducts: Array<{ description: string; quantity: number; totalCents: number }>;
  topCustomers: Array<{ name: string; salesCount: number; totalCents: number }>;
};
