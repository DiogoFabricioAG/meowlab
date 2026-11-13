/**
 * Read-only billing data for the portal (ADR-0006, phase 3). Signed with the portal's
 * own secret, like the WhatsApp link route. The bridge decides which companies an
 * account may see: linked number → contact → active membership with view_invoice.
 */
export const PORTAL_BILLING_BRIDGE_PATH = "/v1/portal/billing";

type Base = { version: 1; requestId: string; portalUserId: string };

export type PortalBillingRequest =
  | (Base & { action: "companies" })
  | (Base & { action: "documents"; tenantId: string; from?: string; to?: string; type?: "01" | "03" | "07"; page?: number })
  | (Base & { action: "summary"; tenantId: string; year: number })
  | (Base & { action: "despatches"; tenantId: string; page?: number })
  | (Base & { action: "file"; tenantId: string; kind: "invoice" | "credit_note" | "despatch"; id: string; fileType: "pdf" | "xml" | "cdr" });

export type PortalCompany = {
  id: string;
  name: string;
  legalName: string | null;
  ruc: string | null;
  environment: "beta" | "production";
};

export type PortalBillingResponse =
  | { status: "ok"; companies: PortalCompany[] }
  | { status: "ok"; data: unknown; meta?: unknown }
  | { status: "ok"; file: { base64: string; mimeType: string; filename: string } }
  | { status: "not_linked" }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "unavailable" };

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const date = (value: unknown) => value === undefined || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value));
const page = (value: unknown) => value === undefined || (Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 1000);
const tenant = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);

export function isPortalBillingRequest(value: unknown): value is PortalBillingRequest {
  if (!record(value) || value.version !== 1 || !text(value.requestId, 255) || !text(value.portalUserId, 128)) return false;
  switch (value.action) {
    case "companies":
      return true;
    case "documents":
      return tenant(value.tenantId) && date(value.from) && date(value.to) && page(value.page)
        && (value.type === undefined || value.type === "01" || value.type === "03" || value.type === "07");
    case "summary":
      return tenant(value.tenantId) && Number.isInteger(value.year) && Number(value.year) >= 2020 && Number(value.year) <= 2100;
    case "despatches":
      return tenant(value.tenantId) && page(value.page);
    case "file":
      return tenant(value.tenantId)
        && (value.kind === "invoice" || value.kind === "credit_note" || value.kind === "despatch")
        && typeof value.id === "string" && /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/.test(value.id)
        && (value.fileType === "pdf" || value.fileType === "xml" || value.fileType === "cdr")
        // FacturaYa only renders PDFs for invoices and receipts.
        && (value.fileType !== "pdf" || value.kind === "invoice");
    default:
      return false;
  }
}
