/**
 * Collections Cat (ADR-0015, phase 1): Worker → VPS bridge. Signed with the Worker's bridge
 * secret, like Sales and Stock Cat; the request id doubles as the idempotency key for writes.
 */
export const COLLECTIONS_BRIDGE_PATH = "/v1/collections/execute";

export const COLLECTIONS_OPERATIONS = [
  "companies",
  "overview",
  "add_debt",
  "record_payment",
  "decide_payment",
  "remind",
  "set_customer",
  "settings",
  "query",
  "cancel_debt",
] as const;
export type CollectionsOperation = (typeof COLLECTIONS_OPERATIONS)[number];

export const PAYMENT_METHODS = ["yape", "plin", "transferencia", "efectivo", "tarjeta", "enlace", "otro"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** owed: how much and how old; top: who owes the most; paid: what came in during a period. */
export const COLLECTIONS_QUERY_TYPES = ["owed", "top", "paid"] as const;
export type CollectionsQueryType = (typeof COLLECTIONS_QUERY_TYPES)[number];

export const PAID_PERIODS = ["today", "week", "month"] as const;
export type PaidPeriod = (typeof PAID_PERIODS)[number];

export type ReminderTone = "friendly" | "firm" | "final";

export type CollectionsBridgeRequest = {
  channel_tenant_id: string;
  contact_id: number;
  operation: CollectionsOperation;
  /** The company Collections Cat works for; absent only for `companies`. */
  company_id?: string;
  payload?: Record<string, unknown>;
};

export type CollectionsBridgeResponse = {
  request_id: string;
  ok: boolean;
  data?: unknown;
  error?: { code: string; message?: string; details?: unknown };
  replayed?: boolean;
};

/** What the company accepts; the reminder offers all of them (ADR-0015, point 7). */
export type PaymentOptions = { yapePhone: string | null; plinPhone: string | null; bankText: string | null; paymentLink: string | null };

export type CollectionsSettings = PaymentOptions & {
  defaultDueDays: number;
  remindBeforeDays: number;
  remindEveryDays: number;
  maxReminders: number;
  windowStartHour: number;
  windowEndHour: number;
  skipSundays: boolean;
};

export type DebtSummary = {
  id: string;
  customer: string;
  phone: string | null;
  balanceCents: number;
  amountCents: number;
  dueOn: string;
  /** Days past due; negative while it is not due yet. */
  daysLate: number;
  document: string | null;
  description: string | null;
  remindersSent: number;
};

export type PendingPayment = { id: string; customer: string; amountCents: number; method: PaymentMethod; operationNumber: string | null; paidOn: string };

export const SETTINGS_KEYS = [
  "defaultDueDays", "remindBeforeDays", "remindEveryDays", "maxReminders", "windowStartHour", "windowEndHour", "skipSundays",
  "yapePhone", "plinPhone", "bankText", "paymentLink",
] as const;

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const optionalText = (value: unknown, max: number) => value === undefined || value === null || text(value, max);
const cents = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 100_000_000_000;
const company = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const date = (value: unknown) => value === undefined || value === null
  || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (value: unknown) => typeof value === "string" && UUID.test(value);
const phone = (value: unknown) => value === undefined || value === null || (typeof value === "string" && /^[0-9]{8,15}$/.test(value));
const int = (value: unknown, min: number, max: number) => Number.isInteger(value) && Number(value) >= min && Number(value) <= max;

/** A partial settings change; unknown keys are refused. */
export function isSettingsChange(value: unknown): value is Partial<CollectionsSettings> {
  if (!record(value) || !Object.keys(value).length) return false;
  return Object.entries(value).every(([key, field]) => {
    switch (key) {
      case "defaultDueDays": return int(field, 0, 365);
      case "remindBeforeDays": return int(field, 0, 30);
      case "remindEveryDays": return int(field, 1, 60);
      case "maxReminders": return int(field, 1, 20);
      case "windowStartHour": return int(field, 0, 23);
      case "windowEndHour": return int(field, 1, 24);
      case "skipSundays": return typeof field === "boolean";
      case "yapePhone":
      case "plinPhone": return field === null || (typeof field === "string" && /^[0-9]{9}$/.test(field));
      case "bankText": return field === null || text(field, 300);
      case "paymentLink": return field === null || (typeof field === "string" && field.length <= 500 && /^https:\/\/[^\s]+$/.test(field));
      default: return false;
    }
  }) && (value.windowStartHour === undefined || value.windowEndHour === undefined
    || Number(value.windowStartHour) < Number(value.windowEndHour));
}

export function isCollectionsPayload(operation: CollectionsOperation, payload: Record<string, unknown>): boolean {
  switch (operation) {
    case "companies":
    case "overview":
      return true;
    case "add_debt":
      return text(payload.customer, 200) && cents(payload.amountCents) && optionalText(payload.description, 300)
        && date(payload.dueOn) && phone(payload.phone)
        && (payload.docNumber === undefined || payload.docNumber === null || (typeof payload.docNumber === "string" && /^([0-9]{8}|[0-9]{11})$/.test(payload.docNumber)));
    case "record_payment":
      return (id(payload.debtId) || text(payload.customer, 200)) && cents(payload.amountCents)
        && PAYMENT_METHODS.includes(payload.method as PaymentMethod) && date(payload.paidOn)
        && optionalText(payload.operationNumber, 60) && typeof payload.fromCapture === "boolean";
    case "decide_payment":
      return id(payload.paymentId) && typeof payload.approve === "boolean";
    case "remind":
      return id(payload.debtId) || text(payload.customer, 200);
    case "set_customer":
      return text(payload.customer, 200) && phone(payload.phone)
        && (payload.doNotContact === undefined || typeof payload.doNotContact === "boolean")
        && (payload.phone !== undefined || payload.doNotContact !== undefined);
    case "settings":
      return isSettingsChange(payload.change);
    case "query":
      return COLLECTIONS_QUERY_TYPES.includes(payload.type as CollectionsQueryType)
        && (payload.type !== "paid" || PAID_PERIODS.includes(payload.period as PaidPeriod));
    case "cancel_debt":
      return id(payload.debtId);
  }
}

export function isCollectionsBridgeResponse(value: unknown): value is CollectionsBridgeResponse {
  return record(value) && typeof value.request_id === "string" && typeof value.ok === "boolean";
}

export function isCollectionsBridgeRequest(value: unknown): value is CollectionsBridgeRequest {
  if (!record(value) || !text(value.channel_tenant_id, 128)) return false;
  if (!Number.isSafeInteger(value.contact_id) || Number(value.contact_id) < 1) return false;
  if (!COLLECTIONS_OPERATIONS.includes(value.operation as CollectionsOperation)) return false;
  const operation = value.operation as CollectionsOperation;
  if (operation !== "companies" && !company(value.company_id)) return false;
  const payload = value.payload ?? {};
  return record(payload) && isCollectionsPayload(operation, payload);
}
