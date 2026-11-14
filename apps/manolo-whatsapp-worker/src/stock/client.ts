import type { SignedVpsBridgeClient } from "../adapters/bridge/signed-vps-client";
import type { RoleLog } from "../roles/contracts";
import type {
  MoveKind,
  MovePeriod,
  QueryType,
  StockAlert,
  StockBridgeRequest,
  StockItem,
  StockLineInput,
  StockOperation,
} from "./bridge-contracts";

export type StockResult<T> = { ok: true; data: T } | { ok: false; code: string; details?: unknown };

export type StockCompany = { id: string; name: string };
export type StockSync = { processed: number; alerts: StockAlert[]; unmatched: string[]; available: boolean };
export type StockMoved = { moved: Array<{ name: string; onHand: number; delta: number }>; alerts: StockAlert[] };
export type StockAnswer =
  | { items: StockItem[]; days?: number }
  | { valueCents: number; withoutCost: number; withStock: number }
  | { period: MovePeriod; items: Array<{ name: string; entered: number; left: number; countDifference: number }> };

/** What the Stock Cat role needs from the platform (ADR-0014). */
export interface StockClient {
  companies(): Promise<StockResult<StockCompany[]>>;
  items(companyId: string): Promise<StockResult<{ items: StockItem[]; owner: boolean; settings: { allowNegative: boolean } }>>;
  move(companyId: string, kind: MoveKind, lines: StockLineInput[], note: string | null): Promise<StockResult<StockMoved>>;
  setMin(companyId: string, name: string, minQty: number | null): Promise<StockResult<{ item: { name: string; onHand: number; minQty: number | null }; alerts: StockAlert[] }>>;
  settings(companyId: string, allowNegative: boolean): Promise<StockResult<{ settings: { allowNegative: boolean } }>>;
  query(companyId: string, type: QueryType, options: { name?: string; period?: MovePeriod }): Promise<StockResult<StockAnswer>>;
  syncDocuments(companyId: string): Promise<StockResult<StockSync>>;
  linkAlias(companyId: string, description: string, name: string): Promise<StockResult<{ item: { name: string; onHand: number }; applied: number; alerts: StockAlert[] }>>;
}

/** Through the signed VPS bridge; the WhatsApp message id seeds idempotent writes. */
export class VpsStockClient implements StockClient {
  constructor(
    private readonly bridge: Pick<SignedVpsBridgeClient, "requestStockOperation"> | null,
    private readonly channelTenantId: string,
    private readonly contactId: number | null,
    private readonly requestSeed: string,
    private readonly log: RoleLog,
  ) {}

  private async call<T>(operation: StockOperation, companyId: string | undefined, payload: Record<string, unknown>): Promise<StockResult<T>> {
    if (!this.bridge || this.contactId === null) return { ok: false, code: "unavailable" };
    const body: StockBridgeRequest = {
      channel_tenant_id: this.channelTenantId,
      contact_id: this.contactId,
      operation,
      ...(companyId ? { company_id: companyId } : {}),
      payload,
    };
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(body)));
    const suffix = Array.from(new Uint8Array(digest).slice(0, 12)).map((value) => value.toString(16).padStart(2, "0")).join("");
    const requestId = `${this.requestSeed.slice(0, 180)}:stock:${operation}:${suffix}`;
    const response = await this.bridge.requestStockOperation(requestId, body);
    if (!response) {
      this.log("whatsapp_stock_bridge_failed", { operation });
      return { ok: false, code: "unavailable" };
    }
    if (!response.ok) return { ok: false, code: response.error?.code ?? "api_error", details: response.error?.details };
    if (typeof response.data !== "object" || response.data === null) return { ok: false, code: "api_error" };
    return { ok: true, data: response.data as T };
  }

  async companies() {
    const result = await this.call<{ companies: StockCompany[] }>("companies", undefined, {});
    return result.ok ? { ok: true as const, data: result.data.companies } : result;
  }

  items(companyId: string) {
    return this.call<{ items: StockItem[]; owner: boolean; settings: { allowNegative: boolean } }>("items", companyId, {});
  }

  move(companyId: string, kind: MoveKind, lines: StockLineInput[], note: string | null) {
    return this.call<StockMoved>("move", companyId, { kind, lines, note });
  }

  setMin(companyId: string, name: string, minQty: number | null) {
    return this.call<{ item: { name: string; onHand: number; minQty: number | null }; alerts: StockAlert[] }>("set_min", companyId, { name, minQty });
  }

  settings(companyId: string, allowNegative: boolean) {
    return this.call<{ settings: { allowNegative: boolean } }>("settings", companyId, { allowNegative });
  }

  query(companyId: string, type: QueryType, options: { name?: string; period?: MovePeriod }) {
    return this.call<StockAnswer>("query", companyId, { type, ...options });
  }

  syncDocuments(companyId: string) {
    return this.call<StockSync>("sync_documents", companyId, {});
  }

  linkAlias(companyId: string, description: string, name: string) {
    return this.call<{ item: { name: string; onHand: number }; applied: number; alerts: StockAlert[] }>("link_alias", companyId, { description, name });
  }
}
