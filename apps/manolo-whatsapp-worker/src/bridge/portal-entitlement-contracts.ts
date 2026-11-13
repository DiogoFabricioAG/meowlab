/**
 * Agents a company paid for in the portal's Plan (ADR-0007, per company since 13/11/2026).
 * Signed with the portal's secret like the other portal routes. The portal sends the end of
 * the paid period; the bridge enables the agent until then and never shortens it.
 */
export const PORTAL_ENTITLEMENT_BRIDGE_PATH = "/v1/portal/entitlements";

/** Billing keys the platform can switch on by itself; the rest are skipped. */
export const ENTITLED_AGENTS = ["sales"] as const;

export type PortalEntitlementRequest = {
  version: 1;
  requestId: string;
  portalUserId: string;
  tenantId: string;
  agents: string[];
  /** ISO instant: end of the paid period. */
  activeUntil: string;
};

export type PortalEntitlementResponse =
  | { status: "ok"; applied: string[]; skipped: string[] }
  | { status: "not_found" };

const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;

export function isPortalEntitlementRequest(value: unknown): value is PortalEntitlementRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  if (body.version !== 1 || !text(body.requestId, 255) || !text(body.portalUserId, 128)) return false;
  if (typeof body.tenantId !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(body.tenantId)) return false;
  if (!Array.isArray(body.agents) || body.agents.length < 1 || body.agents.length > 10
    || !body.agents.every((agent) => typeof agent === "string" && /^[a-z][a-z0-9_]{1,31}$/.test(agent))) return false;
  if (typeof body.activeUntil !== "string" || body.activeUntil.length > 40) return false;
  return !Number.isNaN(Date.parse(body.activeUntil));
}
