/**
 * Contracts for linking a portal account (app.meowlab.tech) to a WhatsApp number
 * with a one-time code (ADR-0006). The portal signs requests to the bridge with its
 * own secret; the bridge asks the Worker to deliver the code with the Meta
 * authentication template.
 */
export const PORTAL_LINK_BRIDGE_PATH = "/v1/portal/whatsapp-link";
export const AUTH_CODE_WORKER_PATH = "/v1/internal/whatsapp-auth-code";

export const PORTAL_LINK_CODE_TTL_SECONDS = 10 * 60;
export const PORTAL_LINK_MAX_ATTEMPTS = 5;
export const PORTAL_LINK_RESEND_SECONDS = 60;
export const PORTAL_LINK_MAX_PER_PHONE_PER_HOUR = 3;
export const PORTAL_LINK_MAX_PER_USER_PER_HOUR = 5;

type Base = { version: 1; requestId: string; portalUserId: string };

export type PortalLinkRequest =
  | (Base & { action: "start"; phone: string })
  | (Base & { action: "verify"; challengeId: string; code: string })
  | (Base & { action: "status" })
  | (Base & { action: "unlink" });

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

export type AuthCodeRequest = { version: 1; requestId: string; to: string; code: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;

export function isPortalLinkRequest(value: unknown): value is PortalLinkRequest {
  if (!record(value) || value.version !== 1 || !text(value.requestId, 255) || !text(value.portalUserId, 128)) return false;
  switch (value.action) {
    case "start":
      return text(value.phone, 32);
    case "verify":
      return typeof value.challengeId === "string" && UUID.test(value.challengeId)
        && typeof value.code === "string" && /^\d{6}$/.test(value.code);
    case "status":
    case "unlink":
      return true;
    default:
      return false;
  }
}

export function isAuthCodeRequest(value: unknown): value is AuthCodeRequest {
  return record(value) && value.version === 1 && text(value.requestId, 255)
    && typeof value.to === "string" && /^[1-9]\d{7,14}$/.test(value.to)
    && typeof value.code === "string" && /^\d{6}$/.test(value.code);
}

/**
 * WhatsApp user ids are E.164 digits without "+". A bare 9-digit Peruvian mobile
 * (9XXXXXXXX) gets the 51 prefix, since that is how most users will type it.
 */
export function normalizeWhatsAppPhone(raw: string): string | null {
  const digits = raw.replace(/[\s().-]/g, "").replace(/^\+/, "").replace(/^00/, "");
  if (!/^\d+$/.test(digits)) return null;
  const withCountry = /^9\d{8}$/.test(digits) ? `51${digits}` : digits;
  return /^[1-9]\d{7,14}$/.test(withCountry) ? withCountry : null;
}

/** "+51 9•• ••• 123": enough to recognise the number, not to read it. */
export function maskWhatsAppPhone(digits: string): string {
  const country = digits.startsWith("51") ? "51" : digits.slice(0, Math.max(1, digits.length - 9));
  const local = digits.slice(country.length);
  if (local.length < 4) return `+${country} •••`;
  return `+${country} ${local[0]}•• ••• ${local.slice(-3)}`;
}
