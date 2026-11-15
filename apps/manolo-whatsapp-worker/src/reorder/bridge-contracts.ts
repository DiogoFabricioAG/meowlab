/**
 * Reorder Cat (ADR-0016, phase 1): Worker → VPS bridge. Signed with the Worker's bridge
 * secret, like the other cats; the request id doubles as the idempotency key for writes.
 * Operations started by a person carry their contact; the supplier side and the cron
 * (`SYSTEM_OPERATIONS`) speak for the platform and carry none.
 */
export const REORDER_BRIDGE_PATH = "/v1/reorder/execute";

export const REORDER_OPERATIONS = [
  "companies",
  "overview",
  "propose",
  "set_rule",
  "set_supplier",
  "approve",
  "mark_sent",
  "discard",
  "change_line",
  "settings",
  "query",
  "order_pdf",
  "notices_delivered",
  "supplier_match",
  "supplier_reply",
  "followups",
] as const;
export type ReorderOperation = (typeof REORDER_OPERATIONS)[number];

/** Spoken by the platform itself: a supplier's message or the cron, never a team member. */
export const SYSTEM_OPERATIONS: ReadonlySet<ReorderOperation> = new Set(["supplier_match", "supplier_reply", "followups", "notices_delivered", "order_pdf"]);

export const SUPPLY_TYPES = ["purchase", "manufacture"] as const;
export type SupplyType = (typeof SUPPLY_TYPES)[number];

/** pending: what is ordered and on its way; month: what was bought this month and from whom. */
export const REORDER_QUERY_TYPES = ["pending", "month"] as const;
export type ReorderQueryType = (typeof REORDER_QUERY_TYPES)[number];

export const REPLY_OUTCOMES = ["accepted", "declined", "other"] as const;
export type ReplyOutcome = (typeof REPLY_OUTCOMES)[number];

export type OrderStatus = "proposed" | "sent" | "confirmed" | "partial" | "received" | "declined" | "in_production" | "done" | "cancelled";

export type ReorderBridgeRequest = {
  channel_tenant_id: string;
  /** Absent only for SYSTEM_OPERATIONS. */
  contact_id?: number;
  operation: ReorderOperation;
  /** The company Reorder Cat works for; absent for `companies`, `supplier_match` and `followups`. */
  company_id?: string;
  payload?: Record<string, unknown>;
};

export type ReorderBridgeResponse = {
  request_id: string;
  ok: boolean;
  data?: unknown;
  error?: { code: string; message?: string; details?: unknown };
  replayed?: boolean;
};

export type ReorderSettings = { monthlyBudgetCents: number | null; followupHours: number; escalateHours: number };

export type OrderLine = { item: string; quantity: number; receivedQty: number; unitPriceCents: number | null };
export type OrderSummary = {
  id: string;
  number: number;
  kind: "purchase" | "production";
  status: OrderStatus;
  supplier: { name: string; phone: string | null; ruc: string | null } | null;
  lines: OrderLine[];
  estimatedCents: number | null;
  confirmedCents: number | null;
  deliverBy: string | null;
  sentAt: string | null;
  approved: boolean;
  escalated: boolean;
  supplierNote: string | null;
};
export type Notice = { id: string; kind: "supplier_reply" | "declined" | "escalated" | "received"; body: string; createdAt: string };

/** What the supplier said, already read by the Worker's model (ADR-0016, point 9). */
export type SupplierReply = {
  outcome: ReplyOutcome;
  deliverBy?: string | null;
  totalCents?: number | null;
  unitPrices?: Array<{ item: string; unitPriceCents: number }>;
  note?: string | null;
};

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const optionalText = (value: unknown, max: number) => value === undefined || value === null || text(value, max);
const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
const quantity = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 100_000_000;
const cents = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 100_000_000_000;
const optionalCents = (value: unknown) => value === undefined || value === null || cents(value);
const day = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const optionalDay = (value: unknown) => value === undefined || value === null || day(value);
const company = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
export const isPhone = (value: unknown) => typeof value === "string" && /^[0-9]{8,15}$/.test(value);
const ruc = (value: unknown) => value === undefined || value === null || (typeof value === "string" && /^[0-9]{11}$/.test(value));
const phoneNumberId = (value: unknown) => typeof value === "string" && /^[0-9]{5,32}$/.test(value);

export function isSupplierReply(value: unknown): value is SupplierReply {
  return record(value) && REPLY_OUTCOMES.includes(value.outcome as ReplyOutcome)
    && optionalDay(value.deliverBy) && optionalCents(value.totalCents) && optionalText(value.note, 500)
    && (value.unitPrices === undefined || (Array.isArray(value.unitPrices) && value.unitPrices.length <= 50
      && value.unitPrices.every((price) => record(price) && text(price.item, 200) && cents(price.unitPriceCents))));
}

export function isSettingsChange(value: unknown): value is Partial<ReorderSettings> {
  if (!record(value) || !Object.keys(value).length) return false;
  return Object.entries(value).every(([key, field]) => {
    switch (key) {
      case "monthlyBudgetCents": return field === null || (cents(field) && Number(field) > 0);
      case "followupHours": return Number.isInteger(field) && Number(field) >= 1 && Number(field) <= 168;
      case "escalateHours": return Number.isInteger(field) && Number(field) >= 2 && Number(field) <= 336;
      default: return false;
    }
  });
}

export function isReorderPayload(operation: ReorderOperation, payload: Record<string, unknown>): boolean {
  switch (operation) {
    case "companies":
    case "overview":
    case "propose":
    case "followups":
      return true;
    case "set_rule":
      return text(payload.item, 200)
        && (payload.maxQty === undefined || payload.maxQty === null || quantity(payload.maxQty))
        && (payload.supplyType === undefined || SUPPLY_TYPES.includes(payload.supplyType as SupplyType))
        && optionalText(payload.supplier, 200)
        && (payload.maxQty !== undefined || payload.supplyType !== undefined || payload.supplier !== undefined);
    case "set_supplier":
      return text(payload.name, 200) && (payload.phone === undefined || isPhone(payload.phone)) && ruc(payload.ruc)
        && (payload.items === undefined || (Array.isArray(payload.items) && payload.items.length <= 30 && payload.items.every((item) => text(item, 200))));
    case "approve":
      return uuid(payload.orderId) && (payload.force === undefined || typeof payload.force === "boolean");
    case "mark_sent":
      return uuid(payload.orderId) && typeof payload.sent === "boolean" && phoneNumberId(payload.phoneNumberId);
    case "discard":
    case "order_pdf":
      return uuid(payload.orderId);
    case "change_line":
      return uuid(payload.orderId) && text(payload.item, 200) && (payload.quantity === 0 || quantity(payload.quantity));
    case "settings":
      return isSettingsChange(payload.change);
    case "query":
      return REORDER_QUERY_TYPES.includes(payload.type as ReorderQueryType);
    case "notices_delivered":
      return Array.isArray(payload.ids) && payload.ids.length >= 1 && payload.ids.length <= 50 && payload.ids.every(uuid);
    case "supplier_match":
      return isPhone(payload.phone);
    case "supplier_reply":
      return uuid(payload.orderId) && isPhone(payload.phone) && isSupplierReply(payload.reply);
  }
}

export function isReorderBridgeResponse(value: unknown): value is ReorderBridgeResponse {
  return record(value) && typeof value.request_id === "string" && typeof value.ok === "boolean";
}

const WITHOUT_COMPANY: ReadonlySet<ReorderOperation> = new Set(["companies", "supplier_match", "followups"]);

export function isReorderBridgeRequest(value: unknown): value is ReorderBridgeRequest {
  if (!record(value) || !text(value.channel_tenant_id, 128)) return false;
  if (!REORDER_OPERATIONS.includes(value.operation as ReorderOperation)) return false;
  const operation = value.operation as ReorderOperation;
  const hasContact = value.contact_id !== undefined;
  if (hasContact && (!Number.isSafeInteger(value.contact_id) || Number(value.contact_id) < 1)) return false;
  if (!hasContact && !SYSTEM_OPERATIONS.has(operation)) return false;
  if (WITHOUT_COMPANY.has(operation) ? value.company_id !== undefined : !company(value.company_id)) return false;
  const payload = value.payload ?? {};
  return record(payload) && isReorderPayload(operation, payload);
}
