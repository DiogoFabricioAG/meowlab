import { isSettingsChange, type CollectionsSettings } from "../collections/bridge-contracts";
import { isSettingsChange as isReorderSettingsChange, type Notice, type OrderSummary, type ReorderSettings } from "../reorder/bridge-contracts";
import type { Ticket as SupportTicket } from "../support/bridge-contracts";

export function isSupportFaqChange(value: unknown): value is SupportFaqChange {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const faq = value as Record<string, unknown>;
  const id = faq.id === undefined || (typeof faq.id === "string" && /^[0-9a-f-]{36}$/i.test(faq.id));
  const filled = (text: unknown, max: number) => typeof text === "string" && text.trim().length > 0 && text.length <= max;
  if (!id || Object.keys(faq).some((key) => !["id", "question", "answer", "remove"].includes(key))) return false;
  if (faq.remove !== undefined) return faq.remove === true && typeof faq.id === "string" && faq.question === undefined && faq.answer === undefined;
  return filled(faq.question, 300) && filled(faq.answer, 1500);
}

/**
 * Companies created from the portal and the owner's invitations (ADR-0010, phases 1–2). Signed with the portal's own
 * secret, like the other portal routes. The bridge re-reads the RUC from the taxpayer
 * registry on creation: the portal never supplies the legal name.
 */
export const PORTAL_COMPANY_BRIDGE_PATH = "/v1/portal/companies";

type Base = { version: 1; requestId: string; portalUserId: string };

export type InvitationAccess = "view" | "full";

export type PortalCompanyRequest =
  | (Base & { action: "mine" })
  | (Base & { action: "lookup"; ruc: string })
  | (Base & { action: "create"; ruc?: string; name?: string; sector?: string; city?: string })
  | (Base & { action: "set_ruc"; tenantId: string; ruc: string })
  // Phase 2: invitations by the owner.
  | (Base & { action: "team"; tenantId: string })
  | (Base & { action: "invite"; tenantId: string; phone?: string; access: InvitationAccess })
  | (Base & { action: "revoke"; tenantId: string; invitationId: string })
  | (Base & { action: "remove"; tenantId: string; memberId: string })
  | (Base & { action: "preview"; token: string })
  | (Base & { action: "accept"; token: string })
  // «Inicio»: what the company's agents did this week, 14-day series and recent activity.
  | (Base & { action: "weekly"; tenantId: string })
  | (Base & { action: "activity"; tenantId: string })
  // Stock Cat (ADR-0014): stock, alerts and moves of one company.
  | (Base & { action: "stock_view"; tenantId: string })
  // Collections Cat (ADR-0015): what the company is owed, and its rules (owner only).
  | (Base & { action: "collections_view"; tenantId: string })
  | (Base & { action: "collections_settings"; tenantId: string; change: Partial<CollectionsSettings> })
  // Reorder Cat (ADR-0016): orders, suppliers and purchases; budget and waiting times (owner only).
  | (Base & { action: "reorder_view"; tenantId: string })
  | (Base & { action: "reorder_settings"; tenantId: string; change: Partial<ReorderSettings> })
  // Support Cat (ADR-0017): FAQs, tickets and today's numbers; FAQs edited by the owner.
  | (Base & { action: "support_view"; tenantId: string })
  | (Base & { action: "support_faq"; tenantId: string; faq: SupportFaqChange })
  // Sales Cat (ADR-0011 fase 3): monthly goal and custom cat name.
  | (Base & { action: "sales_view"; tenantId: string })
  | (Base & { action: "sales_settings"; tenantId: string; change: SalesSettingsChange });

export type SalesSettingsChange = {
  catName?: string | null;
  goalTargetCents?: number | null;
  month?: string;
};

export type SalesView =
  | { enabled: false }
  | {
    enabled: true;
    owner: boolean;
    catName: string | null;
    month: string;
    goalTargetCents: number | null;
    monthTotalCents: number;
    monthCount: number;
    daysInMonth: number;
    currentDay: number | null;
  };

/** Add (no id), edit (id + texts) or remove (id + remove) one frequent question. */
export type SupportFaqChange = { id?: string; question?: string; answer?: string; remove?: boolean };

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
    highlights: Array<{ ocid?: string; displayTitle?: string; description: string; buyer: string; deadline: string; amount: string; sourceUrl: string | null; interesting: boolean }>;
  };
  /** Stock Cat (ADR-0014): items at or below their minimum, and today's moves. */
  stock?: { enabled: boolean; lowCount: number; movesToday: number };
  /** Collections Cat (ADR-0015): what is owed, how much is late and who needs the owner. */
  collections?: { enabled: boolean; owedCents: number; lateCount: number; needsOwner: number; paidWeekCents: number };
  /** Reorder Cat (ADR-0016): to approve, on their way, escalated this week, and the month's purchases. */
  reorder?: { enabled: boolean; toApprove: number; waiting: number; escalated: number; monthSpentCents: number };
  /** Support Cat (ADR-0017): customers this week, solved alone, passed to the owner, still open. */
  support?: { enabled: boolean; customers: number; answered: number; escalated: number; open: number };
  /** Sales Cat (ADR-0011): sales registered today and this week, plus optional month goal. */
  sales: {
    enabled: boolean;
    todayCount: number;
    todayTotalCents: number;
    weekCount: number;
    weekTotalCents: number;
    weekQuotes: number;
    catName?: string | null;
    goalTargetCents?: number | null;
    monthTotalCents?: number;
  };
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

export type ActivityDay = {
  date: string;
  invoices: number;
  salesCents: number;
  collectionsCents: number;
};

export type ActivityAgentKey = "invoice" | "sales" | "collections" | "reorder" | "support" | "stock";

export type ActivityEvent = {
  id: string;
  at: string;
  agent: ActivityAgentKey;
  text: string;
};

export type ActivitySummary = {
  today: string;
  active: {
    invoicing: boolean;
    sales: boolean;
    collections: boolean;
  };
  series: ActivityDay[];
  events: ActivityEvent[];
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
  | { status: "ok"; sales: SalesView }
  | { status: "invalid_cat_name" }
  | { status: "ok"; taxpayer: Taxpayer }
  | { status: "created" | "updated"; company: PortalMembership }
  | { status: "invalid_ruc" | "invalid_name" | "already_has_ruc" }
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
  | { status: "ok"; activity: ActivitySummary }
  | { status: "ok"; stock: PortalStockView }
  | { status: "ok"; collections: PortalCollectionsView }
  | { status: "ok"; reorder: PortalReorderView }
  | { status: "ok"; support: PortalSupportView }
  | { status: "invalid_settings" | "owner_only" };

export type PortalSupportView =
  | { enabled: false }
  | {
    enabled: true;
    owner: boolean;
    phoneNumberId: string | null;
    faqs: Array<{ id: string; question: string; answer: string }>;
    open: SupportTicket[];
    recent: SupportTicket[];
    today: { customers: number; answered: number; quoted: number; escalated: number; ratedYes: number; ratedNo: number; open: number };
  };

export type PortalReorderView =
  | { enabled: false }
  | {
    enabled: true;
    owner: boolean;
    settings: ReorderSettings;
    proposals: OrderSummary[];
    open: OrderSummary[];
    notices: Notice[];
    needsMax: string[];
    needsSupplier: string[];
    monthSpentCents: number;
    suppliers: Array<{ name: string; phone: string | null; ruc: string | null; items: string[] }>;
    month: Array<{ supplier: string; orders: number; totalCents: number }>;
  };

export type PortalCollectionsView =
  | { enabled: false }
  | {
    enabled: true;
    owner: boolean;
    settings: CollectionsSettings;
    totalCents: number;
    buckets: { current: number; d1_30: number; d31_60: number; d61: number };
    debts: Array<{ id: string; customer: string; docNumber: string | null; phone: string | null; balanceCents: number; amountCents: number;
      dueOn: string; daysLate: number; document: string | null; description: string | null; remindersSent: number; escalated: boolean;
      dueForReminder: boolean; source: "sale" | "invoice" | "chat" }>;
    pending: Array<{ id: string; customer: string; amountCents: number; method: string; operationNumber: string | null; paidOn: string }>;
    recent: Array<{ customer: string; amountCents: number; method: string; paidOn: string }>;
  };

export type PortalStockView =
  | { enabled: false }
  | {
    enabled: true;
    owner: boolean;
    allowNegative: boolean;
    /** Inventory value at average cost; owner only. */
    valueCents: number | null;
    items: Array<{ name: string; kind: "product" | "supply"; onHand: number; minQty: number | null; low: boolean; needsCount: boolean;
      avgCostCents: number | null }>;
    moves: Array<{ at: string; kind: "in" | "out" | "count" | "document_out" | "document_in"; name: string; delta: number; balance: number;
      document: string | null }>;
    /** Lines of documents that matched no item yet. */
    unmatched: string[];
  };

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

const isSalesSettingsChange = (value: unknown): value is SalesSettingsChange => {
  if (!record(value)) return false;
  const { catName, goalTargetCents, month } = value;
  if (catName !== undefined && catName !== null && (typeof catName !== "string" || catName.length > 40)) return false;
  if (goalTargetCents !== undefined && goalTargetCents !== null
    && (!Number.isSafeInteger(goalTargetCents) || Number(goalTargetCents) <= 0 || Number(goalTargetCents) > 100_000_000_000)) return false;
  if (month !== undefined && (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))) return false;
  return catName !== undefined || goalTargetCents !== undefined;
};

export function isPortalCompanyRequest(value: unknown): value is PortalCompanyRequest {
  if (!record(value) || value.version !== 1 || !text(value.requestId, 255) || !text(value.portalUserId, 128)) return false;
  switch (value.action) {
    case "mine":
      return true;
    // A malformed RUC still reaches the service, which answers invalid_ruc.
    case "lookup":
      return typeof value.ruc === "string" && value.ruc.length <= 11;
    case "create": {
      const hasRuc = value.ruc !== undefined;
      const validRuc = !hasRuc || (typeof value.ruc === "string" && value.ruc.length <= 11);
      const validName = hasRuc
        ? (value.name === undefined || (typeof value.name === "string" && value.name.length <= 160))
        : text(value.name, 160);
      const validSector = value.sector === undefined || (typeof value.sector === "string" && value.sector.length <= 80);
      const validCity = value.city === undefined || (typeof value.city === "string" && value.city.length <= 80);
      return validRuc && validName && validSector && validCity;
    }
    case "set_ruc":
      return tenant(value.tenantId) && typeof value.ruc === "string" && value.ruc.length <= 11;
    case "team":
    case "weekly":
    case "activity":
    case "stock_view":
    case "collections_view":
    case "reorder_view":
      return tenant(value.tenantId);
    case "collections_settings":
      return tenant(value.tenantId) && isSettingsChange(value.change);
    case "reorder_settings":
      return tenant(value.tenantId) && isReorderSettingsChange(value.change);
    case "support_view":
    case "sales_view":
      return tenant(value.tenantId);
    case "sales_settings":
      return tenant(value.tenantId) && isSalesSettingsChange(value.change);
    case "support_faq":
      return tenant(value.tenantId) && isSupportFaqChange(value.faq);
    case "invite":
      return tenant(value.tenantId) && (value.access === "view" || value.access === "full")
        && (value.phone === undefined || (typeof value.phone === "string" && value.phone.length <= 32));
    case "revoke":
      return tenant(value.tenantId) && typeof value.invitationId === "string" && UUID.test(value.invitationId);
    case "remove":
      return tenant(value.tenantId) && text(value.memberId, 128);
    case "preview":
    case "accept":
      return typeof value.token === "string" && INVITATION_TOKEN.test(value.token);
    default:
      return false;
  }
}
