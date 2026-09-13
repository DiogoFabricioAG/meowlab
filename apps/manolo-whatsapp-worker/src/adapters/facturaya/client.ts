import type { IncomingDocument } from "../../documents/contracts";
import type {
  CreditNoteInput,
  FacturayaOperations,
  FacturayaCustomer,
  FacturayaCreditNote,
  FacturayaInvoice,
  FacturayaInvoiceDraft,
  FacturayaResult,
  ImportInvoiceDraftInput,
} from "../../facturaya/contracts";

type JsonObject = Record<string, unknown>;
const MAX_JSON_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_FILE_RESPONSE_BYTES = 12 * 1024 * 1024;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asData<T>(value: unknown): T | null {
  if (!isRecord(value) || !("data" in value)) return null;
  return value.data as T;
}

function safeMessage(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.message !== "string") return undefined;
  return value.message.trim().slice(0, 300) || undefined;
}

function hasEntityId(value: unknown): value is { id: string } {
  return isRecord(value) && typeof value.id === "string" && value.id.trim().length > 0;
}

function blobPart(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

async function readBoundedBytes(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array | null> {
  if (!response.body) return new Uint8Array();
  const contentLength = Number(response.headers.get("Content-Length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("response_too_large");
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export class FacturayaApiClient implements FacturayaOperations {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string | undefined,
    private readonly token: string | undefined,
    private readonly log: (event: string, details?: Record<string, unknown>) => void,
  ) {
    this.baseUrl = (baseUrl?.trim() || "").replace(/\/$/, "");
  }

  async lookupCustomer(ruc: string): Promise<FacturayaResult<FacturayaCustomer>> {
    if (!this.isConfigured()) return { ok: false, reason: "not_configured" };
    const normalizedRuc = ruc.replace(/\D/g, "");
    if (!/^\d{11}$/.test(normalizedRuc)) {
      return { ok: false, reason: "not_found", message: "El RUC debe tener 11 dígitos." };
    }

    const result = await this.request(`/api/customers/lookup/${encodeURIComponent(normalizedRuc)}`, {
      method: "GET",
    });
    if (!result.ok) return result;
    const customer = asData<{ ruc?: unknown; name?: unknown }>(result.payload);
    if (!customer || customer.ruc !== normalizedRuc || typeof customer.name !== "string" || !customer.name.trim()) {
      return { ok: false, reason: "api_error", message: "FacturaYa no devolvió una razón social válida." };
    }
    const meta = isRecord(result.payload) && isRecord(result.payload.meta) ? result.payload.meta : {};
    return {
      ok: true,
      data: {
        ruc: normalizedRuc,
        name: customer.name.trim().slice(0, 255),
        source: typeof meta.source === "string" ? meta.source : null,
        provider: typeof meta.provider === "string" ? meta.provider : null,
        status: typeof meta.status === "string" ? meta.status : null,
        condition: typeof meta.condition === "string" ? meta.condition : null,
        address: typeof meta.address === "string" ? meta.address : null,
        ubigeo: typeof meta.ubigeo === "string" ? meta.ubigeo : null,
      },
    };
  }

  async importInvoiceDraft(input: ImportInvoiceDraftInput): Promise<FacturayaResult<FacturayaInvoiceDraft>> {
    if (!this.isConfigured()) return { ok: false, reason: "not_configured" };

    const form = new FormData();
    form.append("document_type", input.documentType);
    form.append("customer_document_type", input.customerDocumentType);
    if (input.customerRuc?.trim()) form.append("customer_ruc", input.customerRuc.trim());
    if (input.customerName?.trim()) form.append("customer_name", input.customerName.trim());
    form.append("issue_date", input.issueDate);
    form.append("tax_mode", input.taxMode);
    if (input.productsText?.trim()) form.append("products_text", input.productsText.trim());
    if (input.document) {
      form.append(
        "file",
        new Blob([blobPart(input.document.bytes)], { type: input.document.mimeType }),
        input.document.filename,
      );
    }

    const result = await this.request("/api/invoice-drafts/import", {
      method: "POST",
      body: form,
    });
    if (!result.ok) return result;
    const draft = asData<FacturayaInvoiceDraft>(result.payload);
    return hasEntityId(draft)
      ? { ok: true, data: draft }
      : { ok: false, reason: "api_error", message: "FacturaYa no devolvió un borrador válido." };
  }

  async listInvoiceDrafts(): Promise<FacturayaResult<readonly FacturayaInvoiceDraft[]>> {
    if (!this.isConfigured()) return { ok: false, reason: "not_configured" };
    const result = await this.request("/api/invoice-drafts?per_page=100", { method: "GET" });
    if (!result.ok) return result;
    const data = asData<unknown>(result.payload);
    if (!Array.isArray(data)) return { ok: false, reason: "api_error", message: "FacturaYa no devolvió sus comprobantes." };
    return { ok: true, data: data as FacturayaInvoiceDraft[] };
  }

  async issueInvoice(draftId: string): Promise<FacturayaResult<FacturayaInvoice>> {
    if (!this.isConfigured()) return { ok: false, reason: "not_configured" };
    const result = await this.request(`/api/invoice-drafts/${encodeURIComponent(String(draftId))}/issue`, {
      method: "POST",
    });
    if (!result.ok) return result;
    const invoice = asData<FacturayaInvoice>(result.payload);
    return hasEntityId(invoice)
      ? { ok: true, data: invoice }
      : { ok: false, reason: "api_error", message: "FacturaYa no devolvió el comprobante emitido." };
  }

  async createCreditNote(invoiceId: string, input: CreditNoteInput): Promise<FacturayaResult<FacturayaCreditNote>> {
    if (!this.isConfigured()) return { ok: false, reason: "not_configured" };
    const payload = {
      issue_date: input.issueDate,
      reason_code: input.reasonCode,
      reason_description: input.reasonDescription,
      ...(input.items && input.items.length > 0
        ? {
            items: input.items.map((item) => ({
              invoice_draft_item_id: item.invoiceDraftItemId,
              quantity: item.quantity,
              unit_price: item.unitPrice,
            })),
          }
        : {}),
    };
    const result = await this.request(`/api/invoices/${encodeURIComponent(String(invoiceId))}/credit-notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!result.ok) return result;
    const creditNote = asData<FacturayaCreditNote>(result.payload);
    return hasEntityId(creditNote)
      ? { ok: true, data: creditNote }
      : { ok: false, reason: "api_error", message: "FacturaYa no devolvió la nota de crédito." };
  }

  async downloadFile(url: string): Promise<FacturayaResult<{ bytes: Uint8Array; mimeType: string; filename: string }>> {
    if (!this.isConfigured()) return { ok: false, reason: "not_configured" };
    let target: URL;
    try {
      target = new URL(url, `${this.baseUrl}/`);
      const base = new URL(`${this.baseUrl}/`);
      if (target.origin !== base.origin) return { ok: false, reason: "api_error", message: "FacturaYa devolvió un enlace externo no permitido." };
    } catch {
      return { ok: false, reason: "api_error", message: "FacturaYa devolvió un enlace inválido." };
    }

    try {
      const response = await fetch(target, { headers: { Authorization: `Bearer ${this.token}` } });
      if (!response.ok) return this.mapHttpError(response.status);
      const bytes = await readBoundedBytes(response, MAX_FILE_RESPONSE_BYTES);
      if (!bytes) {
        return { ok: false, reason: "api_error", message: "El archivo de FacturaYa excede el límite permitido." };
      }
      const filename = target.pathname.split("/").pop() || "comprobante.pdf";
      return {
        ok: true,
        data: {
          bytes,
          mimeType: response.headers.get("Content-Type") || "application/octet-stream",
          filename,
        },
      };
    } catch {
      return { ok: false, reason: "network_error" };
    }
  }

  private isConfigured(): boolean {
    return Boolean(this.baseUrl && this.token?.trim());
  }

  private async request(
    path: string,
    init: RequestInit,
  ): Promise<
    | { ok: true; payload: unknown }
    | { ok: false; reason: "not_configured" | "not_found" | "unauthorized" | "forbidden" | "api_error" | "network_error"; message?: string }
  > {
    if (!this.isConfigured()) return { ok: false, reason: "not_configured" };
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.token}`,
          ...(init.headers ?? {}),
        },
      });
      let payload: unknown = null;
      const responseBytes = await readBoundedBytes(response, MAX_JSON_RESPONSE_BYTES);
      if (responseBytes === null) {
        return { ok: false, reason: "api_error", message: "FacturaYa devolvió una respuesta demasiado grande." };
      }
      try {
        payload = JSON.parse(new TextDecoder().decode(responseBytes));
      } catch {
        // FacturaYa puede devolver una respuesta vacía en errores de infraestructura.
      }
      if (!response.ok) return this.mapHttpError(response.status, payload);
      return { ok: true, payload };
    } catch {
      this.log("whatsapp_facturaya_failed", { reason: "network_error" });
      return { ok: false, reason: "network_error" };
    }
  }

  private mapHttpError(
    status: number,
    payload?: unknown,
  ): { ok: false; reason: "not_found" | "unauthorized" | "api_error"; message?: string } {
    const reason = status === 404
      ? "not_found"
      : status === 401 || status === 403
        ? "unauthorized"
        : "api_error";
    this.log("whatsapp_facturaya_failed", { reason, status });
    return { ok: false, reason, message: safeMessage(payload) };
  }
}
