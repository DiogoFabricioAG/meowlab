/**
 * Signed client for the Manolo bridge (VPS). Same scheme as Worker → VPS: HMAC-SHA256
 * over `${timestamp}.${body}`, with the portal's own secret, valid only for the
 * portal route. Uses WebCrypto, so it runs on Cloudflare and on Node alike.
 */
export const PORTAL_LINK_BRIDGE_PATH = "/v1/portal/whatsapp-link";
export const PORTAL_BILLING_BRIDGE_PATH = "/v1/portal/billing";
export const PORTAL_COMPANY_BRIDGE_PATH = "/v1/portal/companies";
export const PORTAL_PUBLIC_QUOTE_PATH = "/v1/portal/public-quote";

/** A Sales Cat quote as its customer sees it (ADR-0011). Amounts in céntimos, IGV included. */
export type PublicQuote = {
  company: { name: string; legalName: string | null; ruc: string | null; address: string | null };
  number: number;
  issuedAt: string;
  validUntil: string;
  customerName: string;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  notes: string | null;
  lines: Array<{ description: string; quantity: number; unitPriceCents: number; totalCents: number }>;
};

export type Taxpayer = { ruc: string; legalName: string; address: string | null; status: string | null; condition: string | null };

/** A company this account belongs to (ADR-0010). Invoice Cat needs SOL credentials until FacturaYa is connected. */
export type PortalMembership = {
  id: string;
  name: string;
  legalName: string | null;
  ruc: string | null;
  role: "owner" | "member";
  invoicing: "active" | "needs_sol";
};

export type InvitationAccess = "view" | "full";
export type TeamMember = { portalUserId: string; role: "owner" | "member"; joinedAt: string };
export type PendingInvitation = { id: string; createdAt: string; expiresAt: string; maskedPhone: string | null; access: InvitationAccess };

export type PortalCompanyAction =
  | { action: "mine" }
  | { action: "lookup"; ruc: string }
  | { action: "create"; ruc: string; name?: string }
  | { action: "team"; tenantId: string }
  | { action: "invite"; tenantId: string; phone?: string; access: InvitationAccess }
  | { action: "revoke"; tenantId: string; invitationId: string }
  | { action: "remove"; tenantId: string; memberId: string }
  | { action: "preview"; token: string }
  | { action: "accept"; token: string }
  | { action: "weekly"; tenantId: string };

/** What the company's agents did this week (Lima, Monday to Sunday). Real data only. */
export type WeeklySummary = {
  week: { start: string; end: string };
  team: { members: number; messages: number; activePeople: number; previousMessages: number };
  tender: {
    found: number;
    interesting: number;
    highlights: Array<{ description: string; buyer: string; deadline: string; amount: string; sourceUrl: string | null; interesting: boolean }>;
  };
  invoicing:
    | null
    | { status: "unavailable" }
    | { status: "ok"; documents: number; accepted: number; totalPen: string; previousTotalPen: string; partial: boolean;
        rejected: Array<{ number: string; customer: string; message: string | null }> };
};

export type PortalCompanyResponse =
  | { status: "ok"; companies: PortalMembership[] }
  | { status: "ok"; taxpayer: Taxpayer }
  | { status: "created"; company: PortalMembership }
  | { status: "inactive"; taxpayer: Taxpayer }
  | { status: "invalid_ruc" | "not_found" | "taken" | "limit_reached" | "unavailable" }
  | { status: "ok"; team: { members: TeamMember[]; invitations: PendingInvitation[] } }
  | { status: "invited"; invitation: PendingInvitation & { token: string } }
  | { status: "ok"; invitation: { companyName: string; invitedBy: string; expiresAt: string; maskedPhone: string | null; alreadyMember: boolean } }
  | { status: "joined"; company: PortalMembership }
  | { status: "revoked" | "removed" | "forbidden" | "invalid_phone" | "invalid" | "expired" | "used" | "already_member" | "needs_whatsapp" | "phone_mismatch" }
  | { status: "ok"; weekly: WeeklySummary };

export type PortalCompany = { id: string; name: string; legalName: string | null; ruc: string | null; environment: "beta" | "production" };

export type PortalBillingAction =
  | { action: "companies" }
  | { action: "documents"; tenantId: string; from?: string; to?: string; type?: "01" | "03" | "07"; page?: number }
  | { action: "summary"; tenantId: string; year: number }
  | { action: "despatches"; tenantId: string; page?: number }
  | { action: "file"; tenantId: string; kind: "invoice" | "credit_note" | "despatch"; id: string; fileType: "pdf" | "xml" | "cdr" };

export type PortalBillingResponse =
  | { status: "ok"; companies: PortalCompany[] }
  | { status: "ok"; data: unknown; meta?: unknown }
  | { status: "ok"; file: { base64: string; mimeType: string; filename: string } }
  | { status: "not_linked" | "forbidden" | "not_found" | "unavailable" };

export type PortalLinkResponse =
  | { status: "code_sent"; challengeId: string; expiresAt: string; resendAfterSeconds: number; maskedPhone: string }
  | { status: "invalid_phone" }
  | { status: "rate_limited"; retryAfterSeconds: number }
  | { status: "delivery_failed" }
  | { status: "linked"; maskedPhone: string; linkedAt: string }
  | { status: "invalid_code"; attemptsLeft: number }
  | { status: "expired" }
  | { status: "not_linked" }
  | { status: "unlinked" };

export type PortalLinkAction =
  | { action: "start"; phone: string }
  | { action: "verify"; challengeId: string; code: string }
  | { action: "status" }
  | { action: "unlink" };

export interface PortalBridge {
  link(portalUserId: string, request: PortalLinkAction): Promise<PortalLinkResponse | null>;
  billing(portalUserId: string, request: PortalBillingAction): Promise<PortalBillingResponse | null>;
  companies(portalUserId: string, request: PortalCompanyAction): Promise<PortalCompanyResponse | null>;
  /** Public: no account involved; the code is the only key. */
  publicQuote?(token: string): Promise<{ status: "ok"; quote: PublicQuote } | { status: "not_found" } | null>;
}

const encoder = new TextEncoder();

async function sign(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`));
  return `sha256=${[...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export class SignedPortalBridge implements PortalBridge {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
    // Wrapped: calling a stored `fetch` as a method throws "Illegal invocation" on Workers.
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  link(portalUserId: string, request: PortalLinkAction): Promise<PortalLinkResponse | null> {
    return this.call<PortalLinkResponse>(PORTAL_LINK_BRIDGE_PATH, portalUserId, request);
  }

  billing(portalUserId: string, request: PortalBillingAction): Promise<PortalBillingResponse | null> {
    return this.call<PortalBillingResponse>(PORTAL_BILLING_BRIDGE_PATH, portalUserId, request);
  }

  companies(portalUserId: string, request: PortalCompanyAction): Promise<PortalCompanyResponse | null> {
    return this.call<PortalCompanyResponse>(PORTAL_COMPANY_BRIDGE_PATH, portalUserId, request);
  }

  publicQuote(token: string) {
    return this.call<{ status: "ok"; quote: PublicQuote } | { status: "not_found" }>(PORTAL_PUBLIC_QUOTE_PATH, "public", { token });
  }

  private async call<T>(path: string, portalUserId: string, request: Record<string, unknown>): Promise<T | null> {
    const requestId = crypto.randomUUID();
    const body = JSON.stringify({ version: 1, requestId, portalUserId, ...request });
    const timestamp = String(Math.floor(Date.now() / 1_000));
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        headers: {
          "Content-Type": "application/json",
          "X-Manolo-Timestamp": timestamp,
          "X-Manolo-Signature": await sign(this.secret, timestamp, body),
          "X-Manolo-Request-Id": requestId,
        },
        body,
      });
      if (!response.ok) return null;
      return (await response.json()) as T;
    } catch {
      return null;
    }
  }
}

export function createPortalBridge(url: string | undefined, secret: string | undefined): PortalBridge | null {
  const baseUrl = url?.trim().replace(/\/$/, "");
  const key = secret?.trim();
  if (!baseUrl || !key || key.length < 32) return null;
  return new SignedPortalBridge(baseUrl, key);
}
