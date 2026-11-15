/**
 * Support Cat (ADR-0017, phase 1): Worker → VPS bridge. Signed with the Worker's bridge
 * secret; the request id doubles as the idempotency key for writes. The customer side and
 * the cron (`SYSTEM_OPERATIONS`) speak for the platform and carry no contact; the owner's
 * side carries theirs.
 */
export const SUPPORT_BRIDGE_PATH = "/v1/support/execute";

export const SUPPORT_OPERATIONS = [
  // Customer side.
  "customer_context",
  "customer_event",
  "open_ticket",
  "customer_quote",
  "quote_pdf",
  "mark_notified",
  // Cron.
  "summaries",
  // Owner side.
  "companies",
  "pending",
  "answer_ticket",
  "mark_relayed",
  "close_ticket",
] as const;
export type SupportOperation = (typeof SUPPORT_OPERATIONS)[number];

export const SYSTEM_OPERATIONS: ReadonlySet<SupportOperation> = new Set([
  "customer_context", "customer_event", "open_ticket", "customer_quote", "quote_pdf", "mark_notified", "summaries",
]);

export const TICKET_KINDS = ["question", "complaint", "human", "sale", "unhappy"] as const;
export type TicketKind = (typeof TICKET_KINDS)[number];
export const EVENT_KINDS = ["answered", "quoted", "escalated", "rated_yes", "rated_no"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export type SupportBridgeRequest = {
  channel_tenant_id: string;
  /** Absent only for SYSTEM_OPERATIONS. */
  contact_id?: number;
  operation: SupportOperation;
  /** The company Support Cat works for; absent for `customer_context`, `summaries` and `companies`. */
  company_id?: string;
  payload?: Record<string, unknown>;
};

export type SupportBridgeResponse = {
  request_id: string;
  ok: boolean;
  data?: unknown;
  error?: { code: string; message?: string; details?: unknown };
  replayed?: boolean;
};

export type Ticket = {
  id: string;
  number: number;
  kind: TicketKind;
  priority: "normal" | "high";
  status: "open" | "answered" | "closed";
  customerName: string | null;
  customerPhone: string;
  question: string;
  answer: string | null;
  relayed: boolean;
  createdAt: string;
};

/** What the cat knows when a customer writes (ADR-0017, points 3 and 4). */
export type CustomerContext =
  | { mode: "off" }
  | {
    mode: "customer";
    companyId: string;
    companyName: string;
    customer: { name: string | null };
    faqs: Array<{ question: string; answer: string }>;
    catalog: Array<{ name: string; unitPriceCents: number }>;
    quotes: Array<{ number: number; totalCents: number; validUntil: string; createdOn: string }>;
    sales: Array<{ number: number; totalCents: number; balanceCents: number; status: string; paymentMethod: string; soldOn: string }>;
    openTickets: Array<{ number: number; kind: TicketKind; question: string }>;
  };

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const optionalText = (value: unknown, max: number) => value === undefined || value === null || text(value, max);
const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
const company = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
export const isPhone = (value: unknown) => typeof value === "string" && /^[0-9]{8,15}$/.test(value);
const phoneNumberId = (value: unknown) => typeof value === "string" && /^[0-9]{5,32}$/.test(value);
const sourceRef = (value: unknown) => value === undefined || (typeof value === "string" && value.length >= 1 && value.length <= 200);

export function isSupportPayload(operation: SupportOperation, payload: Record<string, unknown>): boolean {
  switch (operation) {
    case "companies":
    case "summaries":
      return true;
    case "pending":
      return true;
    case "customer_context":
      return phoneNumberId(payload.phoneNumberId) && isPhone(payload.phone);
    case "customer_event":
      return isPhone(payload.phone) && EVENT_KINDS.includes(payload.kind as EventKind) && sourceRef(payload.sourceRef);
    case "open_ticket":
      return isPhone(payload.phone) && TICKET_KINDS.includes(payload.kind as TicketKind) && text(payload.question, 1500)
        && optionalText(payload.customerName, 200) && sourceRef(payload.sourceRef);
    case "customer_quote":
      return isPhone(payload.phone) && optionalText(payload.customerName, 200) && sourceRef(payload.sourceRef)
        && Array.isArray(payload.items) && payload.items.length >= 1 && payload.items.length <= 30
        && payload.items.every((item) => record(item) && text(item.product, 200)
          && typeof item.quantity === "number" && Number.isFinite(item.quantity) && item.quantity > 0 && item.quantity <= 100_000);
    case "quote_pdf":
      return Number.isSafeInteger(payload.number) && Number(payload.number) >= 1;
    case "mark_notified":
      return Array.isArray(payload.ticketIds) && payload.ticketIds.length >= 1 && payload.ticketIds.length <= 50 && payload.ticketIds.every(uuid);
    case "answer_ticket":
      return uuid(payload.ticketId) && text(payload.answer, 1500);
    case "mark_relayed":
      return uuid(payload.ticketId) && typeof payload.relayed === "boolean";
    case "close_ticket":
      return uuid(payload.ticketId);
  }
}

export function isSupportBridgeResponse(value: unknown): value is SupportBridgeResponse {
  return record(value) && typeof value.request_id === "string" && typeof value.ok === "boolean";
}

const WITHOUT_COMPANY: ReadonlySet<SupportOperation> = new Set(["customer_context", "summaries", "companies"]);

export function isSupportBridgeRequest(value: unknown): value is SupportBridgeRequest {
  if (!record(value) || !text(value.channel_tenant_id, 128)) return false;
  if (!SUPPORT_OPERATIONS.includes(value.operation as SupportOperation)) return false;
  const operation = value.operation as SupportOperation;
  const hasContact = value.contact_id !== undefined;
  if (hasContact && (!Number.isSafeInteger(value.contact_id) || Number(value.contact_id) < 1)) return false;
  if (hasContact === SYSTEM_OPERATIONS.has(operation)) return false;
  if (WITHOUT_COMPANY.has(operation) ? value.company_id !== undefined : !company(value.company_id)) return false;
  const payload = value.payload ?? {};
  return record(payload) && isSupportPayload(operation, payload);
}
