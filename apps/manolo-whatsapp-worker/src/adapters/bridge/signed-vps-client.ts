import {
  CONTACT_ROLE_RESOLUTION_PATH,
  isContactRoleResolutionResponse,
  isPrintAdvisorBridgeResponse,
  isPlatformSyncResponse,
  PRINT_ADVISOR_BRIDGE_PATH,
  PLATFORM_INBOUND_SYNC_PATH,
  PLATFORM_OUTBOUND_SYNC_PATH,
  type ContactRoleResolutionRequest,
  type ContactRoleResolutionResponse,
  type PlatformInboundSyncRequest,
  type PlatformOutboundSyncRequest,
  type PlatformSyncResponse,
  type PrintAdvisorBridgeRequest,
  type PrintAdvisorBridgeResponse,
} from "../../bridge/contracts";
import { signBridgePayload } from "../../bridge/signature";
import type { RoleLog } from "../../roles/contracts";
import {
  FACTURAYA_BRIDGE_PATH,
  isFacturayaBridgeResponse,
  type FacturayaBridgeRequest,
  type FacturayaBridgeResponse,
} from "../../facturaya/bridge-contracts";

const DEFAULT_TIMEOUT_MS = 25_000;
const ROLE_RESOLUTION_TIMEOUT_MS = 3_000;
const PLATFORM_SYNC_TIMEOUT_MS = 3_000;
const MAX_RESPONSE_BYTES = 16 * 1024;
const MAX_FACTURAYA_RESPONSE_BYTES = 20 * 1024 * 1024;

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

async function readBoundedText(
  response: Response,
  maximumBytes: number,
): Promise<string | null> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel("response_too_large");
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function endpointFor(baseUrl: string, path: string): URL | null {
  try {
    const base = new URL(baseUrl);
    if (base.protocol !== "https:") return null;
    base.pathname = `${base.pathname.replace(/\/$/, "")}${path}`;
    base.search = "";
    base.hash = "";
    return base;
  } catch {
    return null;
  }
}

export class SignedVpsBridgeClient {
  constructor(
    private readonly baseUrl: string | undefined,
    private readonly secret: string | undefined,
    private readonly log: RoleLog,
    private readonly fetcher: Fetcher = (input, init) => fetch(input, init),
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  async requestPrintAdvisorReply(
    request: PrintAdvisorBridgeRequest,
  ): Promise<PrintAdvisorBridgeResponse | null> {
    return this.requestSignedJson(
      PRINT_ADVISOR_BRIDGE_PATH,
      request.requestId,
      request,
      isPrintAdvisorBridgeResponse,
      "print_advisor_reply",
      this.timeoutMs,
    );
  }

  async resolveContactRole(
    request: ContactRoleResolutionRequest,
  ): Promise<ContactRoleResolutionResponse | null> {
    return this.requestSignedJson(
      CONTACT_ROLE_RESOLUTION_PATH,
      request.requestId,
      request,
      isContactRoleResolutionResponse,
      "contact_role_resolution",
      Math.min(this.timeoutMs, ROLE_RESOLUTION_TIMEOUT_MS),
    );
  }

  async mirrorInbound(
    request: PlatformInboundSyncRequest,
  ): Promise<PlatformSyncResponse | null> {
    return this.requestSignedJson(
      PLATFORM_INBOUND_SYNC_PATH,
      request.requestId,
      request,
      isPlatformSyncResponse,
      "platform_inbound_sync",
      Math.min(this.timeoutMs, PLATFORM_SYNC_TIMEOUT_MS),
    );
  }

  async mirrorOutbound(
    request: PlatformOutboundSyncRequest,
  ): Promise<PlatformSyncResponse | null> {
    return this.requestSignedJson(
      PLATFORM_OUTBOUND_SYNC_PATH,
      request.requestId,
      request,
      isPlatformSyncResponse,
      "platform_outbound_sync",
      Math.min(this.timeoutMs, PLATFORM_SYNC_TIMEOUT_MS),
    );
  }

  async requestFacturayaOperation(
    requestId: string,
    request: FacturayaBridgeRequest,
  ): Promise<FacturayaBridgeResponse | null> {
    return this.requestSignedJson(
      FACTURAYA_BRIDGE_PATH,
      requestId,
      request,
      isFacturayaBridgeResponse,
      "facturaya_operation",
      this.timeoutMs,
      (value) => value.request_id === requestId,
      MAX_FACTURAYA_RESPONSE_BYTES,
    );
  }

  private async requestSignedJson<T>(
    path: string,
    requestId: string,
    payload: unknown,
    isResponse: (value: unknown) => value is T,
    operation: string,
    timeoutMs: number,
    matchesRequest: (value: T) => boolean = (value) => hasMatchingRequestId(value, requestId),
    maximumResponseBytes = MAX_RESPONSE_BYTES,
  ): Promise<T | null> {
    const endpoint = endpointFor(this.baseUrl?.trim() ?? "", path);
    const secret = this.secret?.trim();
    if (!endpoint || !secret) {
      this.log("vps_bridge_request_failed", {
        operation,
        reason: "missing_or_invalid_configuration",
      });
      return null;
    }

    const body = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const signature = await signBridgePayload(secret, timestamp, body);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.fetcher(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-Manolo-Request-Id": requestId,
          "X-Manolo-Timestamp": timestamp,
          "X-Manolo-Signature": signature,
        },
        body,
        signal: controller.signal,
      });
      if (!response.ok) {
        this.log("vps_bridge_request_failed", {
          operation,
          reason: "api_error",
          status: response.status,
        });
        return null;
      }

      const responseText = await readBoundedText(response, maximumResponseBytes);
      if (responseText === null) {
        this.log("vps_bridge_request_failed", {
          operation,
          reason: "response_too_large",
        });
        return null;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(responseText);
      } catch {
        payload = null;
      }
      if (
        !isResponse(payload)
        || !matchesRequest(payload)
      ) {
        this.log("vps_bridge_request_failed", {
          operation,
          reason: "invalid_response",
        });
        return null;
      }

      this.log("vps_bridge_request_completed", {
        operation,
      });
      return payload;
    } catch (error) {
      this.log("vps_bridge_request_failed", {
        operation,
        reason: error instanceof DOMException && error.name === "AbortError"
          ? "timeout"
          : "request_error",
        errorName: error instanceof Error ? error.name : "unknown",
      });
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function hasMatchingRequestId(
  value: unknown,
  requestId: string,
): value is { requestId: string } {
  return typeof value === "object"
    && value !== null
    && "requestId" in value
    && value.requestId === requestId;
}
