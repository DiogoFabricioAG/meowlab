import type { SignedVpsBridgeClient } from "../adapters/bridge/signed-vps-client";
import type { RoleLog } from "../roles/contracts";
import type {
  CatalogProduct,
  PaymentMethod,
  SalesBridgeRequest,
  SalesCompany,
  SalesCustomerInput,
  SalesLineInput,
  SalesOperation,
  SalesSummary,
  SavedQuote,
  SavedSale,
  SummaryPeriod,
} from "./bridge-contracts";

export type SalesResult<T> = { ok: true; data: T } | { ok: false; code: string };

/** What the Sales Cat role needs from the platform (ADR-0011). */
export interface SalesClient {
  companies(): Promise<SalesResult<SalesCompany[]>>;
  catalog(companyId: string): Promise<SalesResult<CatalogProduct[]>>;
  upsertProduct(companyId: string, name: string, unitPriceCents: number): Promise<SalesResult<{ name: string; unitPriceCents: number; created: boolean }>>;
  createQuote(companyId: string, input: { customer: SalesCustomerInput; lines: SalesLineInput[]; discountCents: number; notes: string | null }): Promise<SalesResult<SavedQuote>>;
  createSale(companyId: string, input: { customer: SalesCustomerInput; lines: SalesLineInput[]; discountCents: number; notes: string | null; paymentMethod: PaymentMethod }): Promise<SalesResult<SavedSale>>;
  cancelSale(companyId: string, number: number, reason: string | null): Promise<SalesResult<{ number: number }>>;
  linkInvoice(companyId: string, number: number, invoiceNumber: string): Promise<SalesResult<true>>;
  summary(companyId: string, period: SummaryPeriod): Promise<SalesResult<SalesSummary>>;
}

/** Through the signed VPS bridge; the WhatsApp message id seeds idempotent writes. */
export class VpsSalesClient implements SalesClient {
  constructor(
    private readonly bridge: Pick<SignedVpsBridgeClient, "requestSalesOperation"> | null,
    private readonly channelTenantId: string,
    private readonly contactId: number | null,
    private readonly requestSeed: string,
    private readonly log: RoleLog,
  ) {}

  private async call<T>(operation: SalesOperation, companyId: string | undefined, payload: Record<string, unknown>, pick: (data: Record<string, unknown>) => T): Promise<SalesResult<T>> {
    if (!this.bridge || this.contactId === null) return { ok: false, code: "unavailable" };
    const body: SalesBridgeRequest = {
      channel_tenant_id: this.channelTenantId,
      contact_id: this.contactId,
      operation,
      ...(companyId ? { company_id: companyId } : {}),
      payload,
    };
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(body)));
    const suffix = Array.from(new Uint8Array(digest).slice(0, 12)).map((value) => value.toString(16).padStart(2, "0")).join("");
    const requestId = `${this.requestSeed.slice(0, 180)}:sales:${operation}:${suffix}`;
    const response = await this.bridge.requestSalesOperation(requestId, body);
    if (!response) {
      this.log("whatsapp_sales_bridge_failed", { operation });
      return { ok: false, code: "unavailable" };
    }
    if (!response.ok) return { ok: false, code: response.error?.code ?? "api_error" };
    const data = response.data;
    if (typeof data !== "object" || data === null) return { ok: false, code: "api_error" };
    try {
      return { ok: true, data: pick(data as Record<string, unknown>) };
    } catch {
      return { ok: false, code: "api_error" };
    }
  }

  companies() {
    return this.call("companies", undefined, {}, (data) => data.companies as SalesCompany[]);
  }

  catalog(companyId: string) {
    return this.call("catalog", companyId, {}, (data) => data.products as CatalogProduct[]);
  }

  upsertProduct(companyId: string, name: string, unitPriceCents: number) {
    return this.call("upsert_product", companyId, { name, unitPriceCents },
      (data) => data.product as { name: string; unitPriceCents: number; created: boolean });
  }

  createQuote(companyId: string, input: Parameters<SalesClient["createQuote"]>[1]) {
    return this.call("create_quote", companyId, { ...input }, (data) => data.quote as SavedQuote);
  }

  createSale(companyId: string, input: Parameters<SalesClient["createSale"]>[1]) {
    return this.call("create_sale", companyId, { ...input }, (data) => data.sale as SavedSale);
  }

  cancelSale(companyId: string, number: number, reason: string | null) {
    return this.call("cancel_sale", companyId, { number, reason }, (data) => data.cancelled as { number: number });
  }

  linkInvoice(companyId: string, number: number, invoiceNumber: string) {
    return this.call("link_invoice", companyId, { number, invoiceNumber }, () => true as const);
  }

  summary(companyId: string, period: SummaryPeriod) {
    return this.call("summary", companyId, { period }, (data) => data.summary as SalesSummary);
  }
}
