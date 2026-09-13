import { FacturayaApiClient } from "../../adapters/facturaya/client";
import type {
  CreditNoteInput,
  FacturayaResult,
  ImportInvoiceDraftInput,
} from "../../facturaya/contracts";
import type {
  FacturayaBridgeRequest,
  FacturayaBridgeResponse,
} from "../../facturaya/bridge-contracts";
import type { IncomingDocument } from "../../documents/contracts";
import type { RoleLog } from "../../roles/contracts";
import type {
  BridgeRequestIdentity,
  BridgeRequestStore,
} from "../bridge/request-store";
import { CredentialCipher } from "../security/credential-cipher";
import { PgFacturayaTenantRepository } from "./tenant-repository";

const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;

export type FacturayaOperationServiceResult =
  | { status: "completed"; response: FacturayaBridgeResponse }
  | { status: "conflict" | "in_progress" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(
  value: unknown,
  maximum: number,
  allowEmpty = false,
): string | null {
  if (typeof value !== "string" || value.length > maximum) return null;
  const normalized = value.trim();
  return normalized || allowEmpty ? normalized : null;
}

function success(
  requestId: string,
  data: unknown,
  replayed = false,
): FacturayaBridgeResponse {
  return { request_id: requestId, ok: true, data, replayed };
}

function failure(
  requestId: string,
  code: string,
  message?: string,
  replayed = false,
): FacturayaBridgeResponse {
  return {
    request_id: requestId,
    ok: false,
    error: { code, ...(message ? { message: message.slice(0, 500) } : {}) },
    replayed,
  };
}

function permissionFor(operation: FacturayaBridgeRequest["operation"]): string {
  if (operation === "import_invoice_draft") return "create_invoice";
  if (operation === "issue_invoice") return "issue_invoice";
  if (operation === "create_credit_note") return "create_credit_note";
  return "view_invoice";
}

function isMutation(operation: FacturayaBridgeRequest["operation"]): boolean {
  return operation === "import_invoice_draft"
    || operation === "issue_invoice"
    || operation === "create_credit_note";
}

function auditOperation(request: FacturayaBridgeRequest): string {
  if (request.operation === "issue_invoice") return "invoice_issued";
  if (request.operation === "import_invoice_draft") return "invoice_modified";
  if (
    request.operation === "create_credit_note"
    && isRecord(request.payload)
    && request.payload.reasonCode === "01"
  ) return "invoice_cancelled";
  return "credit_note_created";
}

function decodeDocument(value: unknown): IncomingDocument | null {
  if (!isRecord(value)) return null;
  const base64 = boundedString(value.base64, MAX_DOCUMENT_BYTES * 2);
  const mimeType = boundedString(value.mimeType, 200);
  const filename = boundedString(value.filename, 255);
  if (!base64 || !mimeType || !filename) return null;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64, "base64");
  } catch {
    return null;
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_DOCUMENT_BYTES) return null;
  return { bytes: new Uint8Array(bytes), mimeType, filename };
}

function parseImportInput(value: unknown): ImportInvoiceDraftInput | null {
  if (!isRecord(value)) return null;
  const documentType = value.documentType === "01" || value.documentType === "03"
    ? value.documentType
    : null;
  const customerDocumentType = value.customerDocumentType === "0"
    || value.customerDocumentType === "1"
    || value.customerDocumentType === "6"
    ? value.customerDocumentType
    : null;
  const customerRuc = boundedString(value.customerRuc, 20);
  const customerName = boundedString(value.customerName, 255);
  const issueDate = boundedString(value.issueDate, 10);
  const taxMode = value.taxMode === "included" || value.taxMode === "excluded"
    ? value.taxMode
    : null;
  const productsText = value.productsText === undefined
    ? undefined
    : boundedString(value.productsText, 10_000);
  const document = value.document === undefined || value.document === null
    ? null
    : decodeDocument(value.document);
  const customerDataValid = customerDocumentType === "0"
    ? documentType === "03" && !customerRuc
    : Boolean(
        customerRuc
        && customerName
        && (customerDocumentType === "1"
          ? /^\d{8}$/.test(customerRuc)
          : /^\d{11}$/.test(customerRuc)),
      );
  if (
    !documentType
    || !customerDocumentType
    || !customerDataValid
    || !issueDate
    || !/^\d{4}-\d{2}-\d{2}$/.test(issueDate)
    || !taxMode
    || (value.productsText !== undefined && !productsText)
    || (value.document !== undefined && value.document !== null && !document)
  ) return null;
  return {
    documentType,
    customerDocumentType,
    customerRuc: customerRuc || null,
    customerName: customerName || null,
    issueDate,
    taxMode,
    ...(productsText ? { productsText } : {}),
    ...(document ? { document } : {}),
  };
}

function parseCreditNoteInput(value: unknown): {
  invoiceId: string;
  input: CreditNoteInput;
} | null {
  if (!isRecord(value)) return null;
  const invoiceId = boundedString(value.invoiceId, 80);
  const issueDate = boundedString(value.issueDate, 10);
  const reasonCode = boundedString(value.reasonCode, 10);
  const reasonDescription = boundedString(value.reasonDescription, 250);
  if (
    !invoiceId
    || !issueDate
    || !/^\d{4}-\d{2}-\d{2}$/.test(issueDate)
    || !reasonCode
    || !reasonDescription
  ) return null;
  return {
    invoiceId,
    input: { issueDate, reasonCode, reasonDescription },
  };
}

function errorFromApi<T>(result: FacturayaResult<T>): {
  code: string;
  message?: string;
} {
  if (result.ok) return { code: "internal_error" };
  return { code: result.reason, ...(result.message ? { message: result.message } : {}) };
}

export class FacturayaOperationService {
  constructor(
    private readonly repository: PgFacturayaTenantRepository,
    private readonly requestStore: BridgeRequestStore,
    private readonly cipher: CredentialCipher,
    private readonly baseUrl: string,
    private readonly log: RoleLog,
  ) {}

  async process(
    request: FacturayaBridgeRequest,
    requestId: string,
    requestHash: string,
  ): Promise<FacturayaOperationServiceResult> {
    const identity: BridgeRequestIdentity = {
      requestId,
      tenantId: request.tenant_id,
      roleKey: `facturaya:${request.operation}`,
      requestHash,
    };
    const claim = await this.requestStore.claim(identity);
    if (claim.status === "conflict" || claim.status === "in_progress") {
      return { status: claim.status };
    }
    if (claim.status === "completed") {
      try {
        const stored = JSON.parse(claim.replyText) as FacturayaBridgeResponse;
        return {
          status: "completed",
          response: { ...stored, replayed: true },
        };
      } catch {
        await this.requestStore.fail(identity, "stored_response_invalid");
        return { status: "in_progress" };
      }
    }

    try {
      const response = await this.execute(request, requestId);
      await this.requestStore.complete(identity, JSON.stringify(response));
      return { status: "completed", response };
    } catch (error) {
      await this.requestStore.fail(identity, "facturaya_internal_error");
      this.log("vps_facturaya_operation_failed", {
        tenantId: request.tenant_id,
        contactId: request.contact_id,
        operation: auditOperation(request),
        reason: error instanceof Error ? error.name : "unknown",
      });
      return {
        status: "completed",
        response: failure(requestId, "internal_error"),
      };
    }
  }

  private async execute(
    request: FacturayaBridgeRequest,
    requestId: string,
  ): Promise<FacturayaBridgeResponse> {
    if (request.operation === "resolve_tenant") {
      const access = await this.repository.resolveAccess(
        request.tenant_id,
        request.contact_id,
      );
      return success(requestId, access);
    }
    if (request.operation === "select_tenant") {
      const access = await this.repository.selectTenant(
        request.tenant_id,
        request.contact_id,
      );
      return access.status === "authorized"
        ? success(requestId, access)
        : failure(requestId, "unauthorized", "No perteneces a esa empresa.");
    }
    if (request.operation === "clear_tenant") {
      const cleared = await this.repository.clearTenant(
        request.tenant_id,
        request.contact_id,
      );
      return success(requestId, { cleared });
    }

    const integration = await this.repository.resolveIntegration(
      request.tenant_id,
      request.contact_id,
      permissionFor(request.operation),
    );
    if (!integration) {
      return failure(
        requestId,
        "forbidden",
        "La empresa activa, la integración o tus permisos ya no están disponibles.",
      );
    }

    let token: string;
    try {
      token = this.cipher.decrypt(integration.encryptedToken);
    } catch {
      return failure(requestId, "not_configured", "No pudimos abrir las credenciales de esta empresa.");
    }
    const client = new FacturayaApiClient(this.baseUrl, token, (event, details) => {
      this.log(event, {
        tenantId: integration.tenant.id,
        operation: auditOperation(request),
        ...(details ?? {}),
      });
    });

    if (isMutation(request.operation)) {
      await this.repository.recordAudit({
        tenantId: integration.tenant.id,
        contactId: request.contact_id,
        operation: auditOperation(request),
        idempotencyKey: requestId,
        status: "started",
        metadata: { environment: integration.tenant.environment },
      });
    }

    const response = await this.executeApiOperation(
      client,
      request,
      requestId,
    );
    if (isMutation(request.operation)) {
      const responseData = response.ok && isRecord(response.data)
        ? response.data
        : null;
      await this.repository.recordAudit({
        tenantId: integration.tenant.id,
        contactId: request.contact_id,
        operation: auditOperation(request),
        idempotencyKey: requestId,
        status: response.ok ? "completed" : "failed",
        resourceType: request.operation === "create_credit_note"
          ? "credit_note"
          : request.operation === "issue_invoice"
            ? "invoice"
            : "invoice_draft",
        resourceId: responseData && typeof responseData.id === "string"
          ? responseData.id
          : null,
        metadata: {
          environment: integration.tenant.environment,
          ...(responseData && typeof responseData.status === "string"
            ? { resultStatus: responseData.status.slice(0, 80) }
            : {}),
        },
      });
    }
    return response;
  }

  private async executeApiOperation(
    client: FacturayaApiClient,
    request: FacturayaBridgeRequest,
    requestId: string,
  ): Promise<FacturayaBridgeResponse> {
    if (request.operation === "lookup_customer") {
      const ruc = isRecord(request.payload)
        ? boundedString(request.payload.ruc, 20)
        : null;
      if (!ruc) return failure(requestId, "invalid_request");
      return this.apiResponse(requestId, await client.lookupCustomer(ruc));
    }
    if (request.operation === "import_invoice_draft") {
      const input = parseImportInput(request.payload);
      if (!input) return failure(requestId, "invalid_request");
      return this.apiResponse(requestId, await client.importInvoiceDraft(input));
    }
    if (request.operation === "list_invoice_drafts") {
      return this.apiResponse(requestId, await client.listInvoiceDrafts());
    }
    if (request.operation === "issue_invoice") {
      const draftId = isRecord(request.payload)
        ? boundedString(request.payload.draftId, 80)
        : null;
      if (!draftId) return failure(requestId, "invalid_request");
      return this.apiResponse(requestId, await client.issueInvoice(draftId));
    }
    if (request.operation === "create_credit_note") {
      const parsed = parseCreditNoteInput(request.payload);
      if (!parsed) return failure(requestId, "invalid_request");
      return this.apiResponse(
        requestId,
        await client.createCreditNote(parsed.invoiceId, parsed.input),
      );
    }
    if (request.operation === "download_file") {
      const url = isRecord(request.payload)
        ? boundedString(request.payload.url, 2_000)
        : null;
      if (!url) return failure(requestId, "invalid_request");
      const result = await client.downloadFile(url);
      if (!result.ok) {
        const error = errorFromApi(result);
        return failure(requestId, error.code, error.message);
      }
      return success(requestId, {
        base64: Buffer.from(result.data.bytes).toString("base64"),
        mimeType: result.data.mimeType,
        filename: result.data.filename,
      });
    }
    return failure(requestId, "invalid_operation");
  }

  private apiResponse<T>(
    requestId: string,
    result: FacturayaResult<T>,
  ): FacturayaBridgeResponse {
    if (result.ok) return success(requestId, result.data);
    const error = errorFromApi(result);
    return failure(requestId, error.code, error.message);
  }
}
