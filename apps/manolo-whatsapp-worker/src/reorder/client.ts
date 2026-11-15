import type { SignedVpsBridgeClient } from "../adapters/bridge/signed-vps-client";
import type { RoleLog } from "../roles/contracts";
import type {
  Notice,
  OrderSummary,
  ReorderBridgeRequest,
  ReorderOperation,
  ReorderQueryType,
  ReorderSettings,
  SupplierReply,
  SupplyType,
} from "./bridge-contracts";

export type ReorderResult<T> = { ok: true; data: T } | { ok: false; code: string; details?: unknown };

export type ReorderCompany = { id: string; name: string };
export type ReorderOverview = {
  owner: boolean;
  companyName: string;
  created: OrderSummary[];
  settings: ReorderSettings;
  proposals: OrderSummary[];
  open: OrderSummary[];
  notices: Notice[];
  needsMax: string[];
  needsSupplier: string[];
  monthSpentCents: number;
};
export type ItemRule = {
  item: string;
  onHand: number;
  minQty: number | null;
  supplyType: SupplyType;
  maxQty: number | null;
  supplier: string | null;
  supplierPhone: string | null;
};
export type SupplierInfo = { name: string; phone: string | null; ruc: string | null };
export type ReorderAnswer =
  | { pending: OrderSummary[] }
  | { month: Array<{ supplier: string; orders: number; totalCents: number }>; totalCents: number; budgetCents: number | null };
export type SupplierMatch = { companyId: string; companyName: string; supplierName: string; order: OrderSummary; pdfSent: boolean; replied: boolean };
export type SupplierReplyResult = {
  order: OrderSummary;
  companyName: string;
  notice: { id: string; body: string };
  ownerPhones: string[];
  sendPdf: boolean;
  phoneNumberId: string | null;
};
export type Followups = {
  reminders: Array<{ companyId: string; companyName: string; order: OrderSummary; phoneNumberId: string | null }>;
  escalations: Array<{ companyId: string; companyName: string; orderId: string; notice: { id: string; body: string }; ownerPhones: string[]; phoneNumberId: string | null }>;
};
export type OrderPdf = { filename: string; bytes: Uint8Array<ArrayBuffer> };

/** What Reorder Cat needs from the platform (ADR-0016). */
export interface ReorderClient {
  companies(): Promise<ReorderResult<ReorderCompany[]>>;
  overview(companyId: string): Promise<ReorderResult<ReorderOverview>>;
  setRule(companyId: string, item: string, change: { maxQty?: number | null; supplyType?: SupplyType; supplier?: string }): Promise<ReorderResult<{ rule: ItemRule }>>;
  setSupplier(companyId: string, supplier: { name: string; phone?: string; ruc?: string; items?: string[] }): Promise<ReorderResult<{ supplier: SupplierInfo; linked: string[]; notFound: string[] }>>;
  approve(companyId: string, orderId: string, force: boolean): Promise<ReorderResult<{ order: OrderSummary; companyName: string }>>;
  markSent(companyId: string, orderId: string, sent: boolean, phoneNumberId: string): Promise<ReorderResult<{ order: OrderSummary }>>;
  discard(companyId: string, orderId: string): Promise<ReorderResult<{ order: OrderSummary }>>;
  changeLine(companyId: string, orderId: string, item: string, quantity: number): Promise<ReorderResult<{ order: OrderSummary }>>;
  settings(companyId: string, change: Partial<ReorderSettings>): Promise<ReorderResult<{ settings: ReorderSettings }>>;
  query(companyId: string, type: ReorderQueryType): Promise<ReorderResult<ReorderAnswer>>;
  orderPdf(companyId: string, orderId: string): Promise<ReorderResult<OrderPdf>>;
  noticesDelivered(companyId: string, ids: string[]): Promise<ReorderResult<{ delivered: number }>>;
  supplierMatch(phone: string): Promise<ReorderResult<SupplierMatch[]>>;
  supplierReply(companyId: string, orderId: string, phone: string, reply: SupplierReply): Promise<ReorderResult<SupplierReplyResult>>;
  followups(): Promise<ReorderResult<Followups>>;
}

/**
 * Through the signed VPS bridge; the WhatsApp message id seeds idempotent writes. Without a
 * contact the client speaks for the platform (a supplier's message, the cron).
 */
export class VpsReorderClient implements ReorderClient {
  constructor(
    private readonly bridge: Pick<SignedVpsBridgeClient, "requestReorderOperation"> | null,
    private readonly channelTenantId: string,
    private readonly contactId: number | null,
    private readonly requestSeed: string,
    private readonly log: RoleLog,
  ) {}

  private async call<T>(operation: ReorderOperation, companyId: string | undefined, payload: Record<string, unknown>): Promise<ReorderResult<T>> {
    if (!this.bridge) return { ok: false, code: "unavailable" };
    const body: ReorderBridgeRequest = {
      channel_tenant_id: this.channelTenantId,
      ...(this.contactId !== null ? { contact_id: this.contactId } : {}),
      operation,
      ...(companyId ? { company_id: companyId } : {}),
      payload,
    };
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(body)));
    const suffix = Array.from(new Uint8Array(digest).slice(0, 12)).map((value) => value.toString(16).padStart(2, "0")).join("");
    const requestId = `${this.requestSeed.slice(0, 170)}:reorder:${operation}:${suffix}`;
    const response = await this.bridge.requestReorderOperation(requestId, body);
    if (!response) {
      this.log("whatsapp_reorder_bridge_failed", { operation });
      return { ok: false, code: "unavailable" };
    }
    if (!response.ok) return { ok: false, code: response.error?.code ?? "api_error", details: response.error?.details };
    if (typeof response.data !== "object" || response.data === null) return { ok: false, code: "api_error" };
    return { ok: true, data: response.data as T };
  }

  async companies() {
    const result = await this.call<{ companies: ReorderCompany[] }>("companies", undefined, {});
    return result.ok ? { ok: true as const, data: result.data.companies } : result;
  }

  overview(companyId: string) {
    return this.call<ReorderOverview>("overview", companyId, {});
  }

  setRule(companyId: string, item: string, change: { maxQty?: number | null; supplyType?: SupplyType; supplier?: string }) {
    return this.call<{ rule: ItemRule }>("set_rule", companyId, { item, ...change });
  }

  setSupplier(companyId: string, supplier: { name: string; phone?: string; ruc?: string; items?: string[] }) {
    return this.call<{ supplier: SupplierInfo; linked: string[]; notFound: string[] }>("set_supplier", companyId, supplier);
  }

  approve(companyId: string, orderId: string, force: boolean) {
    return this.call<{ order: OrderSummary; companyName: string }>("approve", companyId, { orderId, ...(force ? { force } : {}) });
  }

  markSent(companyId: string, orderId: string, sent: boolean, phoneNumberId: string) {
    return this.call<{ order: OrderSummary }>("mark_sent", companyId, { orderId, sent, phoneNumberId });
  }

  discard(companyId: string, orderId: string) {
    return this.call<{ order: OrderSummary }>("discard", companyId, { orderId });
  }

  changeLine(companyId: string, orderId: string, item: string, quantity: number) {
    return this.call<{ order: OrderSummary }>("change_line", companyId, { orderId, item, quantity });
  }

  settings(companyId: string, change: Partial<ReorderSettings>) {
    return this.call<{ settings: ReorderSettings }>("settings", companyId, { change });
  }

  query(companyId: string, type: ReorderQueryType) {
    return this.call<ReorderAnswer>("query", companyId, { type });
  }

  async orderPdf(companyId: string, orderId: string): Promise<ReorderResult<OrderPdf>> {
    const result = await this.call<{ pdf: { filename?: unknown; contentBase64?: unknown } }>("order_pdf", companyId, { orderId });
    if (!result.ok) return result;
    const pdf = result.data.pdf;
    if (typeof pdf?.filename !== "string" || typeof pdf.contentBase64 !== "string") return { ok: false, code: "api_error" };
    const bytes = Uint8Array.from(atob(pdf.contentBase64), (char) => char.charCodeAt(0));
    if (bytes.length < 100 || new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") return { ok: false, code: "api_error" };
    return { ok: true, data: { filename: pdf.filename, bytes } };
  }

  noticesDelivered(companyId: string, ids: string[]) {
    return this.call<{ delivered: number }>("notices_delivered", companyId, { ids });
  }

  async supplierMatch(phone: string) {
    const result = await this.call<{ matches: SupplierMatch[] }>("supplier_match", undefined, { phone });
    return result.ok ? { ok: true as const, data: result.data.matches } : result;
  }

  supplierReply(companyId: string, orderId: string, phone: string, reply: SupplierReply) {
    return this.call<SupplierReplyResult>("supplier_reply", companyId, { orderId, phone, reply: clean(reply) });
  }

  followups() {
    return this.call<Followups>("followups", undefined, {});
  }
}

/** Drops empty optional fields so the bridge's validation sees only what was said. */
function clean<T extends object>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined && field !== null && field !== ""
    && !(Array.isArray(field) && field.length === 0)));
}
