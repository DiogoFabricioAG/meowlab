/**
 * Companies created from the portal and the owner's invitations (ADR-0010, phases 1–2). Signed with the portal's own
 * secret, like the other portal routes. The bridge re-reads the RUC from the taxpayer
 * registry on creation: the portal never supplies the legal name.
 */
import type { BrandKitProblem, BrandKitView } from "./brand-contracts";

export const PORTAL_COMPANY_BRIDGE_PATH = "/v1/portal/companies";

type Base = { version: 1; requestId: string; portalUserId: string };

export type InvitationAccess = "view" | "full";

export type PortalCompanyRequest =
  | (Base & { action: "mine" })
  | (Base & { action: "lookup"; ruc: string })
  | (Base & { action: "create"; ruc: string; name?: string })
  // Phase 2: invitations by the owner.
  | (Base & { action: "team"; tenantId: string })
  | (Base & { action: "invite"; tenantId: string; phone?: string; access: InvitationAccess })
  | (Base & { action: "revoke"; tenantId: string; invitationId: string })
  | (Base & { action: "remove"; tenantId: string; memberId: string })
  | (Base & { action: "preview"; token: string })
  | (Base & { action: "accept"; token: string })
  // «Inicio»: what the company's agents did this week.
  | (Base & { action: "weekly"; tenantId: string })
  // Brand kit (ADR-0012, phase 1): members read it, owners change it.
  | (Base & { action: "brand_get" | "brand_logo_get" | "brand_logo_delete"; tenantId: string })
  | (Base & { action: "brand_save"; tenantId: string; kit: unknown })
  | (Base & { action: "brand_logo_put"; tenantId: string; contentBase64: string });

export type WeeklySummary = {
  /** Monday to Sunday, Lima dates; `today` is the current Lima date. */
  week: { start: string; end: string };
  today: string;
  team: { members: number; messages: number; activePeople: number; previousMessages: number; messagesToday: number };
  tender: {
    /** Someone in the company has Tender Cat in the Manolo chat. */
    enabled: boolean;
    found: number;
    foundToday: number;
    interesting: number;
    highlights: Array<{ description: string; buyer: string; deadline: string; amount: string; sourceUrl: string | null; interesting: boolean }>;
  };
  /** Sales Cat (ADR-0011): sales registered today and this week. */
  sales: { enabled: boolean; todayCount: number; todayTotalCents: number; weekCount: number; weekTotalCents: number; weekQuotes: number };
  /** Null when the company has no Invoice Cat (FacturaYa) yet. */
  invoicing:
    | null
    | { status: "unavailable" }
    | {
      status: "ok";
      documents: number;
      accepted: number;
      totalPen: string;
      previousTotalPen: string;
      partial: boolean;
      rejected: Array<{ number: string; customer: string; message: string | null }>;
      today: { documents: number; totalPen: string; rejected: number };
    };
};

export type TeamMember = { portalUserId: string; role: "owner" | "member"; joinedAt: string };
export type PendingInvitation = { id: string; createdAt: string; expiresAt: string; maskedPhone: string | null; access: InvitationAccess };

export type Taxpayer = {
  ruc: string;
  legalName: string;
  address: string | null;
  status: string | null;
  condition: string | null;
};

export type PortalMembership = {
  id: string;
  name: string;
  legalName: string | null;
  ruc: string | null;
  role: "owner" | "member";
  /** Invoice Cat needs SOL credentials (phase 3); active once FacturaYa is connected. */
  invoicing: "active" | "needs_sol";
};

export type PortalCompanyResponse =
  | { status: "ok"; companies: PortalMembership[] }
  | { status: "ok"; taxpayer: Taxpayer }
  | { status: "created"; company: PortalMembership }
  | { status: "invalid_ruc" }
  | { status: "not_found" }
  | { status: "inactive"; taxpayer: Taxpayer }
  | { status: "taken" }
  | { status: "limit_reached" }
  | { status: "unavailable" }
  | { status: "ok"; team: { members: TeamMember[]; invitations: PendingInvitation[] } }
  | { status: "invited"; invitation: PendingInvitation & { token: string } }
  | { status: "revoked" | "removed" | "forbidden" | "invalid_phone" }
  | { status: "ok"; invitation: { companyName: string; invitedBy: string; expiresAt: string; maskedPhone: string | null; alreadyMember: boolean } }
  | { status: "joined"; company: PortalMembership }
  | { status: "invalid" | "expired" | "used" | "already_member" | "needs_whatsapp" | "phone_mismatch" }
  | { status: "ok"; weekly: WeeklySummary }
  | { status: "ok"; brand: BrandKitView; canEdit: boolean }
  | { status: "ok"; logo: { mimeType: string; contentBase64: string; version: string } }
  | { status: "invalid_brand"; problem: BrandKitProblem }
  | { status: "invalid_logo"; problem: "size" | "format" | "dimensions" };

/** Max companies one account may own; more needs the MeowLab team. */
export const MAX_OWNED_COMPANIES = 3;

/** Open invitations per company, and how long a link stays valid. */
export const MAX_PENDING_INVITATIONS = 20;
export const INVITATION_TTL_DAYS = 7;

/** 128 random bits in base64url: the code inside https://app.meowlab.tech/invitacion/<code>. */
export const INVITATION_TOKEN = /^[A-Za-z0-9_-]{22}$/;

const WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

/** SUNAT RUC: 11 digits, a known prefix and the module-11 check digit. */
export function isValidRuc(value: unknown): value is string {
  if (typeof value !== "string" || !/^(10|15|16|17|20)\d{9}$/.test(value)) return false;
  const sum = WEIGHTS.reduce((total, weight, index) => total + weight * Number(value[index]), 0);
  const check = (11 - (sum % 11)) % 10;
  return check === Number(value[10]);
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const tenant = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPortalCompanyRequest(value: unknown): value is PortalCompanyRequest {
  if (!record(value) || value.version !== 1 || !text(value.requestId, 255) || !text(value.portalUserId, 128)) return false;
  switch (value.action) {
    case "mine":
      return true;
    // A malformed RUC still reaches the service, which answers invalid_ruc.
    case "lookup":
      return typeof value.ruc === "string" && value.ruc.length <= 11;
    case "create":
      return typeof value.ruc === "string" && value.ruc.length <= 11
        && (value.name === undefined || (typeof value.name === "string" && value.name.length <= 160));
    case "team":
    case "weekly":
    case "brand_get":
    case "brand_logo_get":
    case "brand_logo_delete":
      return tenant(value.tenantId);
    case "invite":
      return tenant(value.tenantId) && (value.access === "view" || value.access === "full")
        && (value.phone === undefined || (typeof value.phone === "string" && value.phone.length <= 32));
    case "revoke":
      return tenant(value.tenantId) && typeof value.invitationId === "string" && UUID.test(value.invitationId);
    case "remove":
      return tenant(value.tenantId) && text(value.memberId, 128);
    case "brand_save":
      return tenant(value.tenantId) && record(value.kit);
    // 300 KB of image is at most 409 600 base64 characters.
    case "brand_logo_put":
      return tenant(value.tenantId) && typeof value.contentBase64 === "string"
        && value.contentBase64.length <= 409_600 && /^[A-Za-z0-9+/]+={0,2}$/.test(value.contentBase64);
    case "preview":
    case "accept":
      return typeof value.token === "string" && INVITATION_TOKEN.test(value.token);
    default:
      return false;
  }
}
