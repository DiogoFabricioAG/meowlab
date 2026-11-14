import { createHash } from "node:crypto";
import {
  BRIDGE_PROTOCOL_VERSION,
  CONTACT_ROLE_RESOLUTION_PATH,
  isContactRoleResolutionRequest,
  isPrintAdvisorBridgeRequest,
  isPlatformInboundSyncRequest,
  isPlatformOutboundSyncRequest,
  PRINT_ADVISOR_BRIDGE_PATH,
  PLATFORM_INBOUND_SYNC_PATH,
  PLATFORM_OUTBOUND_SYNC_PATH,
} from "../../bridge/contracts";
import type { RoleLog } from "../../roles/contracts";
import {
  FACTURAYA_BRIDGE_PATH,
  isFacturayaBridgeRequest,
} from "../../facturaya/bridge-contracts";
import type { FacturayaOperationService } from "../facturaya/operation-service";
import type { ContactRoleResolver } from "../control/contact-role-resolver";
import type { PrintAdvisorBridgeService } from "./print-advisor-service";
import {
  PlatformSyncConflictError,
  type PlatformSyncService,
} from "../platform/platform-sync-service";
import { verifyBridgeSignature } from "./signature-verifier";
import { PORTAL_LINK_BRIDGE_PATH, isPortalLinkRequest } from "../../bridge/portal-link-contracts";
import { PORTAL_BILLING_BRIDGE_PATH, isPortalBillingRequest } from "../../bridge/portal-billing-contracts";
import type { PortalBillingService } from "../portal/billing-service";
import { PORTAL_COMPANY_BRIDGE_PATH, isPortalCompanyRequest } from "../../bridge/portal-company-contracts";
import type { PortalCompanyService } from "../portal/company-service";
import { PORTAL_ENTITLEMENT_BRIDGE_PATH, isPortalEntitlementRequest } from "../../bridge/portal-entitlement-contracts";
import type { PortalEntitlementService } from "../portal/entitlement-service";
import type { PortalLinkService } from "../portal/link-service";
import { RADAR_SYNC_BRIDGE_PATH, isRadarSyncRequest } from "../../radar/sync-contracts";
import type { PgRadarSelectionService } from "../radar/selection-service";
import { SALES_BRIDGE_PATH, isSalesBridgeRequest } from "../../sales/bridge-contracts";
import { STOCK_BRIDGE_PATH, isStockBridgeRequest } from "../../stock/bridge-contracts";
import type { StockService } from "../stock/stock-service";
import type { SalesService } from "../sales/sales-service";
import type { QuotePdfService } from "../sales/quote-pdf-service";

/** Portal → bridge: a quote's public page (`/cotizacion/<code>`), signed with the portal secret. */
export const PORTAL_PUBLIC_QUOTE_PATH = "/v1/portal/public-quote";

export type BridgeHttpRequest = {
  method: string;
  path: string;
  headers: Readonly<Record<string, string | undefined>>;
  body: string;
};

export type BridgeHttpResponse = {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: string;
};

export type BridgeHttpHandlerDependencies = {
  sharedSecret: string;
  service: PrintAdvisorBridgeService;
  contactRoleResolver: ContactRoleResolver;
  platformSyncService?: PlatformSyncService;
  facturayaService?: FacturayaOperationService;
  radarSelectionService?: Pick<PgRadarSelectionService, "execute">;
  /** Portal app.meowlab.tech: its own secret, valid only for the portal route. */
  portalSecret?: string;
  portalLinkService?: Pick<PortalLinkService, "handle">;
  portalBillingService?: Pick<PortalBillingService, "handle">;
  portalCompanyService?: Pick<PortalCompanyService, "handle">;
  /** Agents a company paid for in the Plan (per company billing). */
  portalEntitlementService?: Pick<PortalEntitlementService, "handle">;
  /** Sales Cat (ADR-0011). */
  salesService?: Pick<SalesService, "process">;
  /** Stock Cat (ADR-0014). */
  stockService?: Pick<StockService, "process">;
  /** ADR-0013: the quote's PDF behind its public link code. */
  quotePdfService?: Pick<QuotePdfService, "byToken">;
  healthCheck: () => Promise<boolean>;
  log: RoleLog;
  nowSeconds?: () => number;
};

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
): BridgeHttpResponse {
  return {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
    body: JSON.stringify(body),
  };
}

export function createBridgeHttpHandler(
  dependencies: BridgeHttpHandlerDependencies,
): (request: BridgeHttpRequest) => Promise<BridgeHttpResponse> {
  return async (request) => {
    if (request.path === "/health") {
      if (request.method !== "GET") {
        return jsonResponse(405, { error: "method_not_allowed" });
      }
      return await dependencies.healthCheck()
        ? jsonResponse(200, { status: "ok" })
        : jsonResponse(503, { status: "unavailable" });
    }
    if (request.path === PORTAL_LINK_BRIDGE_PATH) {
      return handlePortalRoute(request, dependencies, "link");
    }
    if (request.path === PORTAL_BILLING_BRIDGE_PATH) {
      return handlePortalRoute(request, dependencies, "billing");
    }
    if (request.path === PORTAL_COMPANY_BRIDGE_PATH) {
      return handlePortalRoute(request, dependencies, "companies");
    }
    if (request.path === PORTAL_ENTITLEMENT_BRIDGE_PATH) {
      return handlePortalRoute(request, dependencies, "entitlements");
    }
    if (request.path === PORTAL_PUBLIC_QUOTE_PATH) {
      return handlePublicQuote(request, dependencies);
    }
    if (
      request.path !== PRINT_ADVISOR_BRIDGE_PATH
      && request.path !== CONTACT_ROLE_RESOLUTION_PATH
      && request.path !== PLATFORM_INBOUND_SYNC_PATH
      && request.path !== PLATFORM_OUTBOUND_SYNC_PATH
      && request.path !== FACTURAYA_BRIDGE_PATH
      && request.path !== RADAR_SYNC_BRIDGE_PATH
      && request.path !== SALES_BRIDGE_PATH
      && request.path !== STOCK_BRIDGE_PATH
    ) {
      return jsonResponse(404, { error: "not_found" });
    }
    if (request.method !== "POST") {
      return jsonResponse(405, { error: "method_not_allowed" });
    }

    const verification = verifyBridgeSignature(
      request.body,
      request.headers["x-manolo-timestamp"],
      request.headers["x-manolo-signature"],
      dependencies.sharedSecret,
      dependencies.nowSeconds?.(),
    );
    if (!verification.valid) {
      dependencies.log("vps_bridge_auth_rejected", {
        reason: verification.reason,
      });
      return jsonResponse(401, { error: "unauthorized" });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(request.body);
    } catch {
      return jsonResponse(400, { error: "invalid_json" });
    }
    const requestHash = createHash("sha256")
      .update(request.body, "utf8")
      .digest("hex");

    if (request.path === SALES_BRIDGE_PATH) {
      if (!dependencies.salesService) return jsonResponse(503, { error: "sales_unavailable" });
      const headerRequestId = request.headers["x-manolo-request-id"]?.trim();
      if (!headerRequestId || headerRequestId.length > 255 || !isSalesBridgeRequest(payload)) {
        return jsonResponse(400, { error: "invalid_request" });
      }
      try {
        const result = await dependencies.salesService.process(payload, headerRequestId, requestHash);
        if (result.status === "conflict") return jsonResponse(409, { error: "idempotency_conflict" });
        if (result.status !== "completed") return jsonResponse(409, { error: "request_in_progress" });
        return jsonResponse(200, result.response as unknown as Record<string, unknown>);
      } catch {
        dependencies.log("vps_sales_processing_failed", { operation: payload.operation });
        return jsonResponse(500, { error: "internal_error" });
      }
    }

    if (request.path === STOCK_BRIDGE_PATH) {
      if (!dependencies.stockService) return jsonResponse(503, { error: "stock_unavailable" });
      const headerRequestId = request.headers["x-manolo-request-id"]?.trim();
      if (!headerRequestId || headerRequestId.length > 255 || !isStockBridgeRequest(payload)) {
        return jsonResponse(400, { error: "invalid_request" });
      }
      try {
        const result = await dependencies.stockService.process(payload, headerRequestId, requestHash);
        if (result.status === "conflict") return jsonResponse(409, { error: "idempotency_conflict" });
        if (result.status !== "completed") return jsonResponse(409, { error: "request_in_progress" });
        return jsonResponse(200, result.response as unknown as Record<string, unknown>);
      } catch {
        dependencies.log("vps_stock_processing_failed", { operation: payload.operation });
        return jsonResponse(500, { error: "internal_error" });
      }
    }

    if (request.path === FACTURAYA_BRIDGE_PATH) {
      if (!dependencies.facturayaService) {
        return jsonResponse(503, { error: "facturaya_unavailable" });
      }
      const headerRequestId = request.headers["x-manolo-request-id"]?.trim();
      if (
        !headerRequestId
        || headerRequestId.length > 255
        || !isFacturayaBridgeRequest(payload)
      ) {
        return jsonResponse(400, { error: "invalid_request" });
      }
      try {
        const result = await dependencies.facturayaService.process(
          payload,
          headerRequestId,
          requestHash,
        );
        if (result.status === "conflict") {
          return jsonResponse(409, { error: "idempotency_conflict" });
        }
        if (result.status === "in_progress") {
          return jsonResponse(409, { error: "request_in_progress" });
        }
        if (result.status !== "completed") {
          return jsonResponse(500, { error: "internal_error" });
        }
        return jsonResponse(200, result.response);
      } catch {
        dependencies.log("vps_facturaya_processing_failed", {
          tenantId: payload.tenant_id,
          contactId: payload.contact_id,
          operation: payload.operation,
          reason: "internal_error",
        });
        return jsonResponse(500, { error: "internal_error" });
      }
    }

    const requestId = isObjectWithRequestId(payload)
      ? payload.requestId
      : null;
    if (request.headers["x-manolo-request-id"] !== requestId) {
      return jsonResponse(400, { error: "request_id_mismatch" });
    }

    if (request.path === RADAR_SYNC_BRIDGE_PATH) {
      if (!isRadarSyncRequest(payload)) return jsonResponse(400, { error: "invalid_request" });
      if (!dependencies.radarSelectionService) return jsonResponse(503, { error: "radar_unavailable" });
      try {
        const result = await dependencies.radarSelectionService.execute(payload, requestHash);
        return jsonResponse(200, result);
      } catch { dependencies.log("vps_radar_sync_failed", { reason: "database_error" }); return jsonResponse(503, { error: "radar_unavailable" }); }
    }

    if (request.path === CONTACT_ROLE_RESOLUTION_PATH) {
      if (!isContactRoleResolutionRequest(payload)) {
        return jsonResponse(400, { error: "invalid_request" });
      }
      try {
        const resolved = await dependencies.contactRoleResolver.resolve(payload);
        return jsonResponse(200, {
          version: BRIDGE_PROTOCOL_VERSION,
          requestId: payload.requestId,
          ...resolved,
        });
      } catch {
        dependencies.log("vps_contact_role_resolution_failed", {
          reason: "database_error",
        });
        return jsonResponse(500, { error: "internal_error" });
      }
    }

    if (
      request.path === PLATFORM_INBOUND_SYNC_PATH
      || request.path === PLATFORM_OUTBOUND_SYNC_PATH
    ) {
      if (!dependencies.platformSyncService) {
        return jsonResponse(503, { error: "platform_sync_unavailable" });
      }
      try {
        if (request.path === PLATFORM_INBOUND_SYNC_PATH) {
          if (!isPlatformInboundSyncRequest(payload)) {
            return jsonResponse(400, { error: "invalid_request" });
          }
          const response = await dependencies.platformSyncService.syncInbound(
            payload,
            requestHash,
          );
          return jsonResponse(200, response);
        }
        if (!isPlatformOutboundSyncRequest(payload)) {
          return jsonResponse(400, { error: "invalid_request" });
        }
        const response = await dependencies.platformSyncService.syncOutbound(
          payload,
          requestHash,
        );
        return jsonResponse(200, response);
      } catch (error) {
        if (error instanceof PlatformSyncConflictError) {
          return jsonResponse(409, { error: "idempotency_conflict" });
        }
        return jsonResponse(500, { error: "platform_sync_failed" });
      }
    }

    if (!isPrintAdvisorBridgeRequest(payload)) {
      return jsonResponse(400, { error: "invalid_request" });
    }

    try {
      const result = await dependencies.service.process(payload, requestHash);
      if (result.status === "conflict") {
        return jsonResponse(409, { error: "idempotency_conflict" });
      }
      if (result.status === "in_progress") {
        return jsonResponse(409, { error: "request_in_progress" });
      }
      return jsonResponse(200, result.response);
    } catch {
      dependencies.log("vps_bridge_processing_failed", {
        role: "print-advisor",
        reason: "internal_error",
      });
      return jsonResponse(500, { error: "internal_error" });
    }
  };
}

function isObjectWithRequestId(
  value: unknown,
): value is { requestId: string } {
  return typeof value === "object"
    && value !== null
    && "requestId" in value
    && typeof value.requestId === "string";
}

/** Every portal route shares the portal's own secret, signature check and request-id rule. */
async function handlePublicQuote(
  request: BridgeHttpRequest,
  dependencies: BridgeHttpHandlerDependencies,
): Promise<BridgeHttpResponse> {
  if (request.method !== "POST") return jsonResponse(405, { error: "method_not_allowed" });
  if (!dependencies.portalSecret || !dependencies.quotePdfService) return jsonResponse(503, { error: "portal_unavailable" });
  const verification = verifyBridgeSignature(
    request.body,
    request.headers["x-manolo-timestamp"],
    request.headers["x-manolo-signature"],
    dependencies.portalSecret,
    dependencies.nowSeconds?.(),
  );
  if (!verification.valid) {
    dependencies.log("vps_bridge_auth_rejected", { reason: verification.reason, route: "public_quote" });
    return jsonResponse(401, { error: "unauthorized" });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(request.body);
  } catch {
    return jsonResponse(400, { error: "invalid_json" });
  }
  const body = payload as { version?: unknown; requestId?: unknown; token?: unknown };
  if (body?.version !== 1 || typeof body.requestId !== "string" || typeof body.token !== "string"
    || request.headers["x-manolo-request-id"] !== body.requestId) {
    return jsonResponse(400, { error: "invalid_request" });
  }
  try {
    const pdf = await dependencies.quotePdfService.byToken(body.token);
    return jsonResponse(200, pdf
      ? { status: "ok", pdf: { number: pdf.number, filename: pdf.filename, contentBase64: Buffer.from(pdf.bytes).toString("base64") } }
      : { status: "not_found" });
  } catch {
    dependencies.log("vps_public_quote_failed");
    return jsonResponse(503, { error: "portal_unavailable" });
  }
}

async function handlePortalRoute(
  request: BridgeHttpRequest,
  dependencies: BridgeHttpHandlerDependencies,
  route: "link" | "billing" | "companies" | "entitlements",
): Promise<BridgeHttpResponse> {
  if (request.method !== "POST") return jsonResponse(405, { error: "method_not_allowed" });
  const service = route === "link" ? dependencies.portalLinkService
    : route === "billing" ? dependencies.portalBillingService
    : route === "entitlements" ? dependencies.portalEntitlementService
    : dependencies.portalCompanyService;
  if (!dependencies.portalSecret || !service) {
    return jsonResponse(503, { error: "portal_unavailable" });
  }
  const verification = verifyBridgeSignature(
    request.body,
    request.headers["x-manolo-timestamp"],
    request.headers["x-manolo-signature"],
    dependencies.portalSecret,
    dependencies.nowSeconds?.(),
  );
  if (!verification.valid) {
    dependencies.log("vps_bridge_auth_rejected", { reason: verification.reason, route: "portal" });
    return jsonResponse(401, { error: "unauthorized" });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(request.body);
  } catch {
    return jsonResponse(400, { error: "invalid_json" });
  }
  const valid = route === "link" ? isPortalLinkRequest(payload)
    : route === "billing" ? isPortalBillingRequest(payload)
    : route === "entitlements" ? isPortalEntitlementRequest(payload)
    : isPortalCompanyRequest(payload);
  if (!valid || request.headers["x-manolo-request-id"] !== (payload as { requestId?: unknown }).requestId) {
    return jsonResponse(400, { error: "invalid_request" });
  }
  const action = (payload as { action: string }).action;
  try {
    const result = route === "link"
      ? await dependencies.portalLinkService!.handle(payload as Parameters<PortalLinkService["handle"]>[0])
      : route === "billing"
        ? await dependencies.portalBillingService!.handle(payload as Parameters<PortalBillingService["handle"]>[0])
        : route === "entitlements"
          ? await dependencies.portalEntitlementService!.handle(payload as Parameters<PortalEntitlementService["handle"]>[0])
          : await dependencies.portalCompanyService!.handle(payload as Parameters<PortalCompanyService["handle"]>[0]);
    return jsonResponse(200, result as Record<string, unknown>);
  } catch {
    dependencies.log(`vps_portal_${route}_failed`, { action });
    return jsonResponse(503, { error: "portal_unavailable" });
  }
}
