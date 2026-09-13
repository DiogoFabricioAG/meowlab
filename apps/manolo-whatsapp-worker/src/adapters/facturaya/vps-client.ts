import type { SignedVpsBridgeClient } from "../bridge/signed-vps-client";
import type {
  CreditNoteInput,
  FacturayaClient,
  FacturayaCreditNote,
  FacturayaCustomer,
  FacturayaInvoice,
  FacturayaInvoiceDraft,
  FacturayaResult,
  FacturayaTenant,
  FacturayaTenantAccess,
  ImportInvoiceDraftInput,
} from "../../facturaya/contracts";
import type {
  FacturayaBridgeOperation,
  FacturayaBridgeRequest,
  FacturayaBridgeResponse,
} from "../../facturaya/bridge-contracts";
import type { RoleLog } from "../../roles/contracts";

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.byteLength));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function parseTenant(value: unknown): FacturayaTenant | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string"
    || typeof value.name !== "string"
    || (value.legalName !== null && typeof value.legalName !== "string")
    || (value.ruc !== null && typeof value.ruc !== "string")
    || (value.address !== null && typeof value.address !== "string")
    || (value.environment !== "beta" && value.environment !== "production")
    || !Array.isArray(value.permissions)
    || !value.permissions.every((permission) => typeof permission === "string")
  ) return null;
  return {
    id: value.id,
    name: value.name,
    legalName: value.legalName,
    ruc: value.ruc,
    address: value.address,
    environment: value.environment,
    permissions: value.permissions,
  };
}

function parseAccess(value: unknown): FacturayaTenantAccess | null {
  if (!isRecord(value) || !Array.isArray(value.tenants)) return null;
  const tenants = value.tenants.map(parseTenant);
  if (tenants.some((tenant) => tenant === null)) return null;
  const validTenants = tenants.filter((tenant): tenant is FacturayaTenant => tenant !== null);
  if (value.status === "authorized") {
    const tenant = parseTenant(value.tenant);
    return tenant ? { status: "authorized", tenant, tenants: validTenants } : null;
  }
  if (value.status === "selection_required") {
    return { status: "selection_required", tenant: null, tenants: validTenants };
  }
  if (value.status === "unauthorized" || value.status === "unavailable") {
    return {
      status: value.status,
      tenant: null,
      tenants: validTenants,
      ...(typeof value.message === "string" ? { message: value.message } : {}),
    };
  }
  return null;
}

function failureReason(code: string): "not_configured" | "not_found" | "unauthorized" | "forbidden" | "api_error" | "network_error" {
  if (code === "not_configured") return "not_configured";
  if (code === "not_found") return "not_found";
  if (code === "unauthorized") return "unauthorized";
  if (code === "forbidden") return "forbidden";
  if (code === "network_error") return "network_error";
  return "api_error";
}

export class VpsFacturayaClient implements FacturayaClient {
  private activeTenantId: string | null = null;

  constructor(
    private readonly bridge: SignedVpsBridgeClient | null,
    private readonly channelTenantId: string,
    private readonly contactId: number | null,
    private readonly requestSeed: string,
    private readonly log: RoleLog,
  ) {}

  async resolveTenantAccess(): Promise<FacturayaTenantAccess> {
    const response = await this.request(
      "resolve_tenant",
      this.channelTenantId,
    );
    if (!response?.ok) {
      return {
        status: response?.error?.code === "unauthorized" ? "unauthorized" : "unavailable",
        tenant: null,
        tenants: [],
        message: response?.error?.message,
      };
    }
    const access = parseAccess(response.data);
    if (!access) return { status: "unavailable", tenant: null, tenants: [] };
    this.activeTenantId = access.status === "authorized" ? access.tenant.id : null;
    return access;
  }

  async selectTenant(tenantId: string): Promise<FacturayaTenantAccess> {
    const response = await this.request("select_tenant", tenantId);
    if (!response?.ok) {
      return {
        status: response?.error?.code === "unauthorized" ? "unauthorized" : "unavailable",
        tenant: null,
        tenants: [],
        message: response?.error?.message,
      };
    }
    const access = parseAccess(response.data);
    if (!access) return { status: "unavailable", tenant: null, tenants: [] };
    this.activeTenantId = access.status === "authorized" ? access.tenant.id : null;
    return access;
  }

  async clearTenant(): Promise<boolean> {
    const response = await this.request("clear_tenant", this.channelTenantId);
    this.activeTenantId = null;
    return Boolean(response?.ok && isRecord(response.data) && response.data.cleared);
  }

  async lookupCustomer(ruc: string): Promise<FacturayaResult<FacturayaCustomer>> {
    return this.entityOperation<FacturayaCustomer>("lookup_customer", { ruc }, false);
  }

  async importInvoiceDraft(input: ImportInvoiceDraftInput): Promise<FacturayaResult<FacturayaInvoiceDraft>> {
    return this.entityOperation<FacturayaInvoiceDraft>("import_invoice_draft", {
      ...input,
      ...(input.document
        ? {
            document: {
              base64: bytesToBase64(input.document.bytes),
              mimeType: input.document.mimeType,
              filename: input.document.filename,
            },
          }
        : {}),
    });
  }

  async listInvoiceDrafts(): Promise<FacturayaResult<readonly FacturayaInvoiceDraft[]>> {
    const response = await this.operation("list_invoice_drafts");
    if (!response.ok) return response;
    if (!Array.isArray(response.data)) {
      return { ok: false, reason: "api_error", message: "El VPS devolvió una lista inválida." };
    }
    return { ok: true, data: response.data as FacturayaInvoiceDraft[] };
  }

  async issueInvoice(draftId: string): Promise<FacturayaResult<FacturayaInvoice>> {
    return this.entityOperation<FacturayaInvoice>("issue_invoice", { draftId });
  }

  async createCreditNote(invoiceId: string, input: CreditNoteInput): Promise<FacturayaResult<FacturayaCreditNote>> {
    return this.entityOperation<FacturayaCreditNote>("create_credit_note", {
      invoiceId,
      ...input,
    });
  }

  async downloadFile(url: string): Promise<FacturayaResult<{ bytes: Uint8Array; mimeType: string; filename: string }>> {
    const response = await this.operation("download_file", { url });
    if (!response.ok) return response;
    if (!isRecord(response.data)) {
      return { ok: false, reason: "api_error", message: "El VPS devolvió un archivo inválido." };
    }
    const bytes = typeof response.data.base64 === "string"
      ? base64ToBytes(response.data.base64)
      : null;
    if (
      !bytes
      || typeof response.data.mimeType !== "string"
      || typeof response.data.filename !== "string"
    ) {
      return { ok: false, reason: "api_error", message: "El VPS devolvió un archivo inválido." };
    }
    return {
      ok: true,
      data: {
        bytes,
        mimeType: response.data.mimeType,
        filename: response.data.filename,
      },
    };
  }

  private async entityOperation<T>(
    operation: FacturayaBridgeOperation,
    payload: Record<string, unknown>,
    requireId = true,
  ): Promise<FacturayaResult<T>> {
    const response = await this.operation(operation, payload);
    if (!response.ok) return response;
    if (!isRecord(response.data) || (requireId && typeof response.data.id !== "string")) {
      return { ok: false, reason: "api_error", message: "El VPS devolvió datos inválidos." };
    }
    return { ok: true, data: response.data as T };
  }

  private async operation(
    operation: FacturayaBridgeOperation,
    payload?: Record<string, unknown>,
  ): Promise<FacturayaResult<unknown>> {
    if (!this.activeTenantId) {
      const access = await this.resolveTenantAccess();
      if (access.status !== "authorized") {
        return {
          ok: false,
          reason: access.status === "unauthorized" ? "forbidden" : "not_configured",
          message: access.status === "selection_required"
            ? "Selecciona una empresa antes de continuar."
            : access.message,
        };
      }
    }
    const response = await this.request(operation, this.activeTenantId!, payload);
    if (!response) return { ok: false, reason: "network_error" };
    if (!response.ok) {
      return {
        ok: false,
        reason: failureReason(response.error?.code ?? "api_error"),
        message: response.error?.message,
      };
    }
    return { ok: true, data: response.data };
  }

  private async request(
    operation: FacturayaBridgeOperation,
    tenantId: string,
    payload?: Record<string, unknown>,
  ): Promise<FacturayaBridgeResponse | null> {
    if (!this.bridge || this.contactId === null) return null;
    const body: FacturayaBridgeRequest = {
      tenant_id: tenantId,
      contact_id: this.contactId,
      operation,
      ...(payload ? { payload } : {}),
    };
    const requestId = await this.idempotencyKey(operation, body);
    const response = await this.bridge.requestFacturayaOperation(requestId, body);
    if (!response) {
      this.log("whatsapp_facturaya_bridge_failed", { operation });
    }
    return response;
  }

  private async idempotencyKey(
    operation: FacturayaBridgeOperation,
    request: FacturayaBridgeRequest,
  ): Promise<string> {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(request)),
    );
    const suffix = Array.from(new Uint8Array(digest).slice(0, 12))
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    return `${this.requestSeed.slice(0, 180)}:facturaya:${operation}:${suffix}`;
  }
}
