import type { SignedVpsBridgeClient } from "../adapters/bridge/signed-vps-client";
import type { RoleLog } from "../roles/contracts";
import type {
  CollectionsBridgeRequest,
  CollectionsOperation,
  CollectionsQueryType,
  CollectionsSettings,
  DebtSummary,
  PaidPeriod,
  PaymentMethod,
  PaymentOptions,
  PendingPayment,
  ReminderTone,
} from "./bridge-contracts";

export type CollectionsResult<T> = { ok: true; data: T } | { ok: false; code: string; details?: unknown };

export type CollectionsCompany = { id: string; name: string };
export type Buckets = { current: number; d1_30: number; d31_60: number; d61: number };
export type CollectionsOverview = {
  owner: boolean;
  sync: { added: number; creditNotes: number; available: boolean };
  settings: CollectionsSettings;
  totalCents: number;
  buckets: Buckets;
  openCount: number;
  toRemind: DebtSummary[];
  escalated: DebtSummary[];
  pending: PendingPayment[];
  customers: string[];
};
export type AppliedPayment = {
  customer: string;
  applied: Array<{ debtId: string; amountCents: number; balanceCents: number }>;
  leftoverCents: number;
  customerBalanceCents: number;
};
export type Reminder = {
  companyName: string;
  debt: DebtSummary;
  customerBalanceCents: number;
  openDebts: number;
  tone: ReminderTone;
  lastReminder: boolean;
  outsideWindow: boolean;
  payment: PaymentOptions;
};
export type CollectionsAnswer =
  | { totalCents: number; buckets: Buckets; customers: number; lateCount: number }
  | { customers: Array<{ customer: string; phone: string | null; balanceCents: number; oldestDaysLate: number; buckets: Buckets; escalated: boolean }>; totalCents: number }
  | { period: PaidPeriod; totalCents: number; payments: Array<{ customer: string; amountCents: number; method: string; paidOn: string }> };

export type NewDebt = { customer: string; amountCents: number; description?: string | null; dueOn?: string | null; phone?: string | null; docNumber?: string | null };
export type NewPayment = {
  debtId?: string; customer?: string; amountCents: number; method: PaymentMethod; paidOn?: string | null; operationNumber?: string | null; fromCapture: boolean;
};

/** What the Collections Cat role needs from the platform (ADR-0015). */
export interface CollectionsClient {
  companies(): Promise<CollectionsResult<CollectionsCompany[]>>;
  overview(companyId: string): Promise<CollectionsResult<CollectionsOverview>>;
  addDebt(companyId: string, debt: NewDebt): Promise<CollectionsResult<{ debt: DebtSummary; customerBalanceCents: number }>>;
  recordPayment(companyId: string, payment: NewPayment): Promise<CollectionsResult<AppliedPayment | { pending: PendingPayment; customerBalanceCents: number }>>;
  decidePayment(companyId: string, paymentId: string, approve: boolean): Promise<CollectionsResult<{ approved: false; customer: string } | (AppliedPayment & { approved: true })>>;
  remind(companyId: string, target: { debtId?: string; customer?: string }): Promise<CollectionsResult<Reminder>>;
  setCustomer(companyId: string, customer: string, change: { phone?: string; doNotContact?: boolean }): Promise<CollectionsResult<{ customer: { name: string; phone: string | null; doNotContact: boolean } }>>;
  settings(companyId: string, change: Partial<CollectionsSettings>): Promise<CollectionsResult<{ settings: CollectionsSettings }>>;
  query(companyId: string, type: CollectionsQueryType, period?: PaidPeriod): Promise<CollectionsResult<CollectionsAnswer>>;
}

/** Through the signed VPS bridge; the WhatsApp message id seeds idempotent writes. */
export class VpsCollectionsClient implements CollectionsClient {
  constructor(
    private readonly bridge: Pick<SignedVpsBridgeClient, "requestCollectionsOperation"> | null,
    private readonly channelTenantId: string,
    private readonly contactId: number | null,
    private readonly requestSeed: string,
    private readonly log: RoleLog,
  ) {}

  private async call<T>(operation: CollectionsOperation, companyId: string | undefined, payload: Record<string, unknown>): Promise<CollectionsResult<T>> {
    if (!this.bridge || this.contactId === null) return { ok: false, code: "unavailable" };
    const body: CollectionsBridgeRequest = {
      channel_tenant_id: this.channelTenantId,
      contact_id: this.contactId,
      operation,
      ...(companyId ? { company_id: companyId } : {}),
      payload,
    };
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(body)));
    const suffix = Array.from(new Uint8Array(digest).slice(0, 12)).map((value) => value.toString(16).padStart(2, "0")).join("");
    const requestId = `${this.requestSeed.slice(0, 170)}:collections:${operation}:${suffix}`;
    const response = await this.bridge.requestCollectionsOperation(requestId, body);
    if (!response) {
      this.log("whatsapp_collections_bridge_failed", { operation });
      return { ok: false, code: "unavailable" };
    }
    if (!response.ok) return { ok: false, code: response.error?.code ?? "api_error", details: response.error?.details };
    if (typeof response.data !== "object" || response.data === null) return { ok: false, code: "api_error" };
    return { ok: true, data: response.data as T };
  }

  async companies() {
    const result = await this.call<{ companies: CollectionsCompany[] }>("companies", undefined, {});
    return result.ok ? { ok: true as const, data: result.data.companies } : result;
  }

  overview(companyId: string) {
    return this.call<CollectionsOverview>("overview", companyId, {});
  }

  addDebt(companyId: string, debt: NewDebt) {
    return this.call<{ debt: DebtSummary; customerBalanceCents: number }>("add_debt", companyId, clean(debt));
  }

  recordPayment(companyId: string, payment: NewPayment) {
    return this.call<AppliedPayment | { pending: PendingPayment; customerBalanceCents: number }>("record_payment", companyId, clean(payment));
  }

  decidePayment(companyId: string, paymentId: string, approve: boolean) {
    return this.call<{ approved: false; customer: string } | (AppliedPayment & { approved: true })>("decide_payment", companyId, { paymentId, approve });
  }

  remind(companyId: string, target: { debtId?: string; customer?: string }) {
    return this.call<Reminder>("remind", companyId, clean(target));
  }

  setCustomer(companyId: string, customer: string, change: { phone?: string; doNotContact?: boolean }) {
    return this.call<{ customer: { name: string; phone: string | null; doNotContact: boolean } }>("set_customer", companyId, clean({ customer, ...change }));
  }

  settings(companyId: string, change: Partial<CollectionsSettings>) {
    return this.call<{ settings: CollectionsSettings }>("settings", companyId, { change });
  }

  query(companyId: string, type: CollectionsQueryType, period?: PaidPeriod) {
    return this.call<CollectionsAnswer>("query", companyId, clean({ type, period }));
  }
}

/** Drops empty optional fields so the bridge's validation sees only what was said. */
function clean<T extends object>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined && field !== null && field !== ""));
}
