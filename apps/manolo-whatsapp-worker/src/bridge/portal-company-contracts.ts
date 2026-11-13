/**
 * Companies created from the portal (ADR-0010, phase 1). Signed with the portal's own
 * secret, like the other portal routes. The bridge re-reads the RUC from the taxpayer
 * registry on creation: the portal never supplies the legal name.
 */
export const PORTAL_COMPANY_BRIDGE_PATH = "/v1/portal/companies";

type Base = { version: 1; requestId: string; portalUserId: string };

export type PortalCompanyRequest =
  | (Base & { action: "mine" })
  | (Base & { action: "lookup"; ruc: string })
  | (Base & { action: "create"; ruc: string; name?: string });

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
  | { status: "unavailable" };

/** Max companies one account may own; more needs the MeowLab team. */
export const MAX_OWNED_COMPANIES = 3;

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
    default:
      return false;
  }
}
