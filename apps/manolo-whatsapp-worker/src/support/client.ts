import type { SignedVpsBridgeClient } from "../adapters/bridge/signed-vps-client";
import type { RoleLog } from "../roles/contracts";
import type { CustomerContext, EventKind, SupportBridgeRequest, SupportOperation, Ticket, TicketKind } from "./bridge-contracts";

export type SupportResult<T> = { ok: true; data: T } | { ok: false; code: string; details?: unknown };
export type CustomerQuote = { number: number; totalCents: number; validUntil: string; lines: Array<{ name: string; quantity: number }> };
export type Summary = { companyId: string; ownerPhones: string[]; phoneNumberId: string | null; text: string };

/** What Support Cat needs from the platform (ADR-0017). */
export interface SupportClient {
  customerContext(phoneNumberId: string, phone: string): Promise<SupportResult<CustomerContext>>;
  event(companyId: string, phone: string, kind: EventKind, sourceRef?: string): Promise<SupportResult<{ recorded: boolean }>>;
  openTicket(companyId: string, ticket: { phone: string; kind: TicketKind; question: string; customerName?: string | null; sourceRef?: string }):
    Promise<SupportResult<{ ticket: Ticket; companyName: string; ownerPhones: string[] }>>;
  customerQuote(companyId: string, quote: { phone: string; customerName?: string | null; items: Array<{ product: string; quantity: number }>; sourceRef?: string }):
    Promise<SupportResult<{ quote: CustomerQuote; companyName: string }>>;
  quotePdf(companyId: string, number: number): Promise<SupportResult<{ filename: string; bytes: Uint8Array<ArrayBuffer> }>>;
  markNotified(companyId: string, ticketIds: string[]): Promise<SupportResult<{ notified: boolean }>>;
  summaries(): Promise<SupportResult<Summary[]>>;
  companies(): Promise<SupportResult<Array<{ id: string; name: string }>>>;
  pending(companyId: string): Promise<SupportResult<{ owner: boolean; companyName: string; open: Ticket[] }>>;
  answerTicket(companyId: string, ticketId: string, answer: string): Promise<SupportResult<{ ticket: Ticket; companyName: string }>>;
  markRelayed(companyId: string, ticketId: string, relayed: boolean): Promise<SupportResult<{ ticket: Ticket }>>;
  closeTicket(companyId: string, ticketId: string): Promise<SupportResult<{ ticket: Ticket }>>;
}

/**
 * Through the signed VPS bridge; the WhatsApp message id seeds idempotent writes. Without a
 * contact the client speaks for the platform (the customer side, the cron).
 */
export class VpsSupportClient implements SupportClient {
  constructor(
    private readonly bridge: Pick<SignedVpsBridgeClient, "requestSupportOperation"> | null,
    private readonly channelTenantId: string,
    private readonly contactId: number | null,
    private readonly requestSeed: string,
    private readonly log: RoleLog,
  ) {}

  private async call<T>(operation: SupportOperation, companyId: string | undefined, payload: Record<string, unknown>): Promise<SupportResult<T>> {
    if (!this.bridge) return { ok: false, code: "unavailable" };
    const body: SupportBridgeRequest = {
      channel_tenant_id: this.channelTenantId,
      ...(this.contactId !== null ? { contact_id: this.contactId } : {}),
      operation,
      ...(companyId ? { company_id: companyId } : {}),
      payload,
    };
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(body)));
    const suffix = Array.from(new Uint8Array(digest).slice(0, 12)).map((value) => value.toString(16).padStart(2, "0")).join("");
    const requestId = `${this.requestSeed.slice(0, 170)}:support:${operation}:${suffix}`;
    const response = await this.bridge.requestSupportOperation(requestId, body);
    if (!response) {
      this.log("whatsapp_support_bridge_failed", { operation });
      return { ok: false, code: "unavailable" };
    }
    if (!response.ok) return { ok: false, code: response.error?.code ?? "api_error", details: response.error?.details };
    if (typeof response.data !== "object" || response.data === null) return { ok: false, code: "api_error" };
    return { ok: true, data: response.data as T };
  }

  customerContext(phoneNumberId: string, phone: string) {
    return this.call<CustomerContext>("customer_context", undefined, { phoneNumberId, phone });
  }

  event(companyId: string, phone: string, kind: EventKind, sourceRef?: string) {
    return this.call<{ recorded: boolean }>("customer_event", companyId, { phone, kind, ...(sourceRef ? { sourceRef } : {}) });
  }

  openTicket(companyId: string, ticket: { phone: string; kind: TicketKind; question: string; customerName?: string | null; sourceRef?: string }) {
    return this.call<{ ticket: Ticket; companyName: string; ownerPhones: string[] }>("open_ticket", companyId, clean(ticket));
  }

  customerQuote(companyId: string, quote: { phone: string; customerName?: string | null; items: Array<{ product: string; quantity: number }>; sourceRef?: string }) {
    return this.call<{ quote: CustomerQuote; companyName: string }>("customer_quote", companyId, clean(quote));
  }

  async quotePdf(companyId: string, number: number): Promise<SupportResult<{ filename: string; bytes: Uint8Array<ArrayBuffer> }>> {
    const result = await this.call<{ pdf: { filename?: unknown; contentBase64?: unknown } }>("quote_pdf", companyId, { number });
    if (!result.ok) return result;
    const pdf = result.data.pdf;
    if (typeof pdf?.filename !== "string" || typeof pdf.contentBase64 !== "string") return { ok: false, code: "api_error" };
    const bytes = Uint8Array.from(atob(pdf.contentBase64), (char) => char.charCodeAt(0));
    if (bytes.length < 100 || new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") return { ok: false, code: "api_error" };
    return { ok: true, data: { filename: pdf.filename, bytes } };
  }

  markNotified(companyId: string, ticketIds: string[]) {
    return this.call<{ notified: boolean }>("mark_notified", companyId, { ticketIds });
  }

  async summaries() {
    const result = await this.call<{ summaries: Summary[] }>("summaries", undefined, {});
    return result.ok ? { ok: true as const, data: result.data.summaries } : result;
  }

  async companies() {
    const result = await this.call<{ companies: Array<{ id: string; name: string }> }>("companies", undefined, {});
    return result.ok ? { ok: true as const, data: result.data.companies } : result;
  }

  pending(companyId: string) {
    return this.call<{ owner: boolean; companyName: string; open: Ticket[] }>("pending", companyId, {});
  }

  answerTicket(companyId: string, ticketId: string, answer: string) {
    return this.call<{ ticket: Ticket; companyName: string }>("answer_ticket", companyId, { ticketId, answer });
  }

  markRelayed(companyId: string, ticketId: string, relayed: boolean) {
    return this.call<{ ticket: Ticket }>("mark_relayed", companyId, { ticketId, relayed });
  }

  closeTicket(companyId: string, ticketId: string) {
    return this.call<{ ticket: Ticket }>("close_ticket", companyId, { ticketId });
  }
}

function clean<T extends object>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined && field !== null && field !== ""));
}
