import type {
  StoreDesignClient,
  StoreDesignApprovalRequest,
  StoreDesignApprovalResult,
  StoreDesignRequest,
  StoreDesignResult,
} from "../../store-designer/contracts";

const REQUEST_TIMEOUT_MS = 45_000;

type StoreDesignResponse = {
  designId?: unknown;
  accessToken?: unknown;
  version?: unknown;
  brief?: unknown;
  proposalUrl?: unknown;
  imageUrl?: unknown;
  alreadyApproved?: unknown;
  error?: unknown;
};

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function signBody(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  return `sha256=${toHex(digest)}`;
}

function validText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

export class SignedStoreDesignClient implements StoreDesignClient {
  constructor(
    private readonly endpoint: string | undefined,
    private readonly secret: string | undefined,
    private readonly log: (event: string, details?: Record<string, unknown>) => void,
  ) {}

  async generate(request: StoreDesignRequest): Promise<StoreDesignResult> {
    if (!this.endpoint?.trim() || !this.secret?.trim()) {
      this.log("whatsapp_store_design_failed", {
        reason: "api_not_configured",
      });
      return { ok: false, reason: "api_not_configured" };
    }

    const timestamp = Math.floor(Date.now() / 1_000).toString();
    const body = JSON.stringify({
      action: "generate_design",
      requestId: crypto.randomUUID(),
      tenantId: request.tenantId,
      contactId: request.contactId,
      whatsappUserId: request.whatsappUserId,
      input: request.input.slice(0, 4_000),
      currentDesign: request.currentDesign,
    });

    let controller: AbortController | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      controller = new AbortController();
      timeout = setTimeout(() => controller?.abort(), REQUEST_TIMEOUT_MS);
      const response = await fetch(this.endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "X-Store-Timestamp": timestamp,
          "X-Store-Signature": await signBody(this.secret, timestamp, body),
        },
        body,
      });
      const payload = (await response.json().catch(() => null)) as StoreDesignResponse | null;

      if (response.status === 403 && payload?.error === "design_access_invalid") {
        return { ok: false, reason: "design_access_invalid" };
      }
      if (!response.ok) {
        this.log("whatsapp_store_design_failed", {
          reason: "api_error",
          status: response.status,
        });
        return { ok: false, reason: "api_error" };
      }

      const version = payload?.version;
      if (
        !validText(payload?.designId, 160) ||
        !validText(payload?.accessToken, 160) ||
        typeof version !== "number" ||
        !Number.isInteger(version) ||
        !validText(payload?.brief, 2_000) ||
        !validText(payload?.proposalUrl, 2_000) ||
        !validText(payload?.imageUrl, 2_000)
      ) {
        this.log("whatsapp_store_design_failed", {
          reason: "invalid_response",
        });
        return { ok: false, reason: "invalid_response" };
      }

      this.log("whatsapp_store_design_generated", {
        version: payload.version,
      });
      return {
        ok: true,
        proposal: {
          designId: payload.designId,
          accessToken: payload.accessToken,
          version,
          brief: payload.brief,
          proposalUrl: payload.proposalUrl,
          imageUrl: payload.imageUrl,
        },
      };
    } catch {
      this.log("whatsapp_store_design_failed", { reason: "request_error" });
      return { ok: false, reason: "api_error" };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async approve(request: StoreDesignApprovalRequest): Promise<StoreDesignApprovalResult> {
    if (!this.endpoint?.trim() || !this.secret?.trim()) {
      this.log("whatsapp_store_design_failed", {
        operation: "approval",
        reason: "api_not_configured",
      });
      return { ok: false, reason: "api_not_configured" };
    }

    const timestamp = Math.floor(Date.now() / 1_000).toString();
    const body = JSON.stringify({
      action: "approve_design",
      requestId: crypto.randomUUID(),
      tenantId: request.tenantId,
      contactId: request.contactId,
      whatsappUserId: request.whatsappUserId,
      designId: request.designId,
      accessToken: request.accessToken,
      version: request.version,
    });

    let controller: AbortController | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      controller = new AbortController();
      timeout = setTimeout(() => controller?.abort(), REQUEST_TIMEOUT_MS);
      const response = await fetch(this.endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "X-Store-Timestamp": timestamp,
          "X-Store-Signature": await signBody(this.secret, timestamp, body),
        },
        body,
      });
      const payload = (await response.json().catch(() => null)) as StoreDesignResponse | null;

      if (response.status === 404 && payload?.error === "design_access_invalid") {
        return { ok: false, reason: "design_access_invalid" };
      }
      if (!response.ok) {
        this.log("whatsapp_store_design_failed", {
          operation: "approval",
          reason: "api_error",
          status: response.status,
        });
        return { ok: false, reason: "api_error" };
      }

      const version = payload?.version;
      if (
        !validText(payload?.designId, 160) ||
        typeof version !== "number" ||
        !Number.isInteger(version) ||
        !validText(payload?.proposalUrl, 2_000) ||
        typeof payload?.alreadyApproved !== "boolean"
      ) {
        this.log("whatsapp_store_design_failed", {
          operation: "approval",
          reason: "invalid_response",
        });
        return { ok: false, reason: "invalid_response" };
      }

      this.log("whatsapp_store_design_approved", {
        version,
        alreadyApproved: payload.alreadyApproved,
      });
      return {
        ok: true,
        approval: {
          designId: payload.designId,
          version,
          proposalUrl: payload.proposalUrl,
          alreadyApproved: payload.alreadyApproved,
        },
      };
    } catch {
      this.log("whatsapp_store_design_failed", {
        operation: "approval",
        reason: "request_error",
      });
      return { ok: false, reason: "api_error" };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
