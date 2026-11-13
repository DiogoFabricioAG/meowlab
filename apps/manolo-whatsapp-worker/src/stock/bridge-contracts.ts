/**
 * Stock Cat (ADR-0014, phase 1): Worker → VPS bridge. Signed with the Worker's bridge
 * secret, like Sales Cat; the request id doubles as the idempotency key for writes.
 */
export const STOCK_BRIDGE_PATH = "/v1/stock/execute";

export const STOCK_OPERATIONS = [
  "companies",
  "items",
  "move",
  "set_min",
  "settings",
  "query",
  "sync_documents",
  "link_alias",
] as const;
export type StockOperation = (typeof STOCK_OPERATIONS)[number];

/** in: arrived; out: left by hand; count: physical count (sets the quantity). */
export const MOVE_KINDS = ["in", "out", "count"] as const;
export type MoveKind = (typeof MOVE_KINDS)[number];

export const ITEM_KINDS = ["product", "supply"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const QUERY_TYPES = ["item", "low", "slow", "value", "moves"] as const;
export type QueryType = (typeof QUERY_TYPES)[number];

export const MOVE_PERIODS = ["today", "yesterday", "week", "month", "last_month"] as const;
export type MovePeriod = (typeof MOVE_PERIODS)[number];

export type StockLineInput = { name: string; quantity: number; unitCostCents?: number | null; kind?: ItemKind };

export type StockBridgeRequest = {
  channel_tenant_id: string;
  contact_id: number;
  operation: StockOperation;
  /** The company Stock Cat works for; absent only for `companies`. */
  company_id?: string;
  payload?: Record<string, unknown>;
};

export type StockBridgeResponse = {
  request_id: string;
  ok: boolean;
  data?: unknown;
  error?: { code: string; message?: string; details?: unknown };
  replayed?: boolean;
};

/** A product that just went below its minimum; reported once until it goes back up. */
export type StockAlert = { name: string; onHand: number; minQty: number; needsCount: boolean };

export type StockItem = {
  name: string;
  kind: ItemKind;
  onHand: number;
  minQty: number | null;
  low: boolean;
  needsCount: boolean;
  /** Only for the company's owner (ADR-0014, point 1). */
  avgCostCents?: number | null;
};

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const quantity = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100_000_000
  && Math.abs(Math.round(value * 1000) - value * 1000) < 1e-6;
const cents = (value: unknown) => value === undefined || value === null
  || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100_000_000_000);
const company = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);

export function isStockLines(value: unknown, kind: MoveKind): value is StockLineInput[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= 50 && value.every((line) =>
    record(line) && text(line.name, 200) && quantity(line.quantity)
    && (kind === "count" || Number(line.quantity) > 0)
    && cents(line.unitCostCents) && (line.kind === undefined || ITEM_KINDS.includes(line.kind as ItemKind)));
}

export function isStockPayload(operation: StockOperation, payload: Record<string, unknown>): boolean {
  switch (operation) {
    case "companies":
    case "items":
    case "sync_documents":
      return true;
    case "move":
      return MOVE_KINDS.includes(payload.kind as MoveKind) && isStockLines(payload.lines, payload.kind as MoveKind)
        && (payload.note === undefined || payload.note === null || (typeof payload.note === "string" && payload.note.length <= 300));
    case "set_min":
      return text(payload.name, 200) && (payload.minQty === null || quantity(payload.minQty));
    case "settings":
      return typeof payload.allowNegative === "boolean";
    case "query":
      return QUERY_TYPES.includes(payload.type as QueryType)
        && (payload.type !== "item" || text(payload.name, 200))
        && (payload.type !== "moves" || MOVE_PERIODS.includes(payload.period as MovePeriod));
    case "link_alias":
      return text(payload.description, 300) && text(payload.name, 200);
  }
}

export function isStockBridgeResponse(value: unknown): value is StockBridgeResponse {
  return record(value) && typeof value.request_id === "string" && typeof value.ok === "boolean";
}

export function isStockBridgeRequest(value: unknown): value is StockBridgeRequest {
  if (!record(value) || !text(value.channel_tenant_id, 128)) return false;
  if (!Number.isSafeInteger(value.contact_id) || Number(value.contact_id) < 1) return false;
  if (!STOCK_OPERATIONS.includes(value.operation as StockOperation)) return false;
  const operation = value.operation as StockOperation;
  if (operation !== "companies" && !company(value.company_id)) return false;
  const payload = value.payload ?? {};
  return record(payload) && isStockPayload(operation, payload);
}
