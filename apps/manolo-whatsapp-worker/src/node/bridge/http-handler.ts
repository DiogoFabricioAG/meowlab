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
import type { PortalLinkService } from "../portal/link-service";
import { RADAR_SYNC_BRIDGE_PATH, isRadarSyncRequest } from "../../radar/sync-contracts";
import type { PgRadarSelectionService } from "../radar/selection-service";

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
    if (
      request.path !== PRINT_ADVISOR_BRIDGE_PATH
      && request.path !== CONTACT_ROLE_RESOLUTION_PATH
      && request.path !== PLATFORM_INBOUND_SYNC_PATH
      && request.path !== PLATFORM_OUTBOUND_SYNC_PATH
      && request.path !== FACTURAYA_BRIDGE_PATH
      && request.path !== RADAR_SYNC_BRIDGE_PATH
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

/** Both portal routes share the portal's own secret, signature check and request-id rule. */
async function handlePortalRoute(
  request: BridgeHttpRequest,
  dependencies: BridgeHttpHandlerDependencies,
  route: "link" | "billing",
): Promise<BridgeHttpResponse> {
  if (request.method !== "POST") return jsonResponse(405, { error: "method_not_allowed" });
  const service = route === "link" ? dependencies.portalLinkService : dependencies.portalBillingService;
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
  const valid = route === "link" ? isPortalLinkRequest(payload) : isPortalBillingRequest(payload);
  if (!valid || request.headers["x-manolo-request-id"] !== (payload as { requestId?: unknown }).requestId) {
    return jsonResponse(400, { error: "invalid_request" });
  }
  const action = (payload as { action: string }).action;
  try {
    const result = route === "link"
      ? await dependencies.portalLinkService!.handle(payload as Parameters<PortalLinkService["handle"]>[0])
      : await dependencies.portalBillingService!.handle(payload as Parameters<PortalBillingService["handle"]>[0]);
    return jsonResponse(200, result as Record<string, unknown>);
  } catch {
    dependencies.log(route === "link" ? "vps_portal_link_failed" : "vps_portal_billing_failed", { action });
    return jsonResponse(503, { error: "portal_unavailable" });
  }
}
