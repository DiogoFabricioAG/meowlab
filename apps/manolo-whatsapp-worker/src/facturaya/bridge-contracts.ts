export const FACTURAYA_BRIDGE_PATH = "/v1/facturaya/execute";

export type FacturayaBridgeOperation =
  | "resolve_tenant"
  | "select_tenant"
  | "clear_tenant"
  | "lookup_customer"
  | "import_invoice_draft"
  | "list_invoice_drafts"
  | "issue_invoice"
  | "create_credit_note"
  | "download_file";

export type FacturayaBridgeRequest = {
  tenant_id: string;
  contact_id: number;
  operation: FacturayaBridgeOperation;
  payload?: unknown;
};

export type FacturayaBridgeResponse = {
  request_id: string;
  ok: boolean;
  data?: unknown;
  error?: {
    code: string;
    message?: string;
  };
  replayed: boolean;
};

const OPERATIONS = new Set<FacturayaBridgeOperation>([
  "resolve_tenant",
  "select_tenant",
  "clear_tenant",
  "lookup_customer",
  "import_invoice_draft",
  "list_invoice_drafts",
  "issue_invoice",
  "create_credit_note",
  "download_file",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isFacturayaBridgeRequest(
  value: unknown,
): value is FacturayaBridgeRequest {
  if (!isRecord(value)) return false;
  return typeof value.tenant_id === "string"
    && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/.test(value.tenant_id)
    && Number.isInteger(value.contact_id)
    && Number(value.contact_id) > 0
    && typeof value.operation === "string"
    && OPERATIONS.has(value.operation as FacturayaBridgeOperation)
    && (value.payload === undefined || isRecord(value.payload));
}

export function isFacturayaBridgeResponse(
  value: unknown,
): value is FacturayaBridgeResponse {
  if (!isRecord(value)) return false;
  if (
    typeof value.request_id !== "string"
    || value.request_id.length === 0
    || value.request_id.length > 255
    || typeof value.ok !== "boolean"
    || typeof value.replayed !== "boolean"
  ) return false;
  if (value.ok) return value.error === undefined;
  return isRecord(value.error)
    && typeof value.error.code === "string"
    && value.error.code.length > 0
    && value.error.code.length <= 120
    && (value.error.message === undefined || typeof value.error.message === "string");
}
