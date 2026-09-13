import type { IncomingDocument } from "../documents/contracts";

export type FacturayaInvoice = {
  id: string;
  number: string;
  status: string;
  document_type?: "01" | "03" | string;
  document_name?: string | null;
  sunat?: { code?: string | null; message?: string | null; notes?: string[] };
  files?: { pdf?: string | null; xml?: string | null; cdr?: string | null };
};

export type FacturayaInvoiceDraft = {
  id: string;
  status: string;
  document_type?: "01" | "03" | string;
  customer?: { document_type?: "0" | "1" | "6" | string; ruc?: string | null; name?: string | null };
  issue_date?: string | null;
  tax_mode?: "included" | "excluded" | string;
  currency?: string | null;
  items?: readonly {
    id?: number;
    description?: string;
    quantity?: number | string;
    unit_price?: number | string;
    line_total?: number | string;
  }[];
  totals?: { subtotal?: number | string; igv?: number | string; total?: number | string };
  warnings?: readonly string[];
  error?: string | null;
  invoice?: FacturayaInvoice | null;
};

export type FacturayaCreditNote = {
  id: string;
  number: string;
  status: string;
  invoice_id?: string;
  affected_document?: string | null;
  reason?: { code?: string; description?: string };
  totals?: { subtotal?: number | string; igv?: number | string; total?: number | string };
  sunat?: { code?: string | null; message?: string | null; notes?: string[] };
  files?: { xml?: string | null; cdr?: string | null };
};

export type FacturayaCustomer = {
  ruc: string;
  name: string;
  source?: string | null;
  provider?: string | null;
  status?: string | null;
  condition?: string | null;
  address?: string | null;
  ubigeo?: string | null;
};

export type FacturayaResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "not_configured" | "not_found" | "unauthorized" | "forbidden" | "api_error" | "network_error"; message?: string };

export type FacturayaTenant = {
  id: string;
  name: string;
  legalName: string | null;
  ruc: string | null;
  address: string | null;
  environment: "beta" | "production";
  permissions: readonly string[];
};

export type FacturayaTenantAccess =
  | {
      status: "authorized";
      tenant: FacturayaTenant;
      tenants: readonly FacturayaTenant[];
    }
  | {
      status: "selection_required";
      tenant: null;
      tenants: readonly FacturayaTenant[];
    }
  | {
      status: "unauthorized" | "unavailable";
      tenant: null;
      tenants: readonly FacturayaTenant[];
      message?: string;
    };

export type ImportInvoiceDraftInput = {
  documentType: "01" | "03";
  customerDocumentType: "0" | "1" | "6";
  customerRuc: string | null;
  customerName: string | null;
  issueDate: string;
  taxMode: "included" | "excluded";
  productsText?: string;
  document?: IncomingDocument | null;
};

export type CreditNoteInput = {
  issueDate: string;
  reasonCode: string;
  reasonDescription: string;
  items?: readonly {
    invoiceDraftItemId: number;
    quantity: number;
    unitPrice: number;
  }[];
};

export interface FacturayaOperations {
  lookupCustomer(ruc: string): Promise<FacturayaResult<FacturayaCustomer>>;
  importInvoiceDraft(input: ImportInvoiceDraftInput): Promise<FacturayaResult<FacturayaInvoiceDraft>>;
  listInvoiceDrafts(): Promise<FacturayaResult<readonly FacturayaInvoiceDraft[]>>;
  issueInvoice(draftId: string): Promise<FacturayaResult<FacturayaInvoice>>;
  createCreditNote(invoiceId: string, input: CreditNoteInput): Promise<FacturayaResult<FacturayaCreditNote>>;
  downloadFile(url: string): Promise<FacturayaResult<{ bytes: Uint8Array; mimeType: string; filename: string }>>;
}

export interface FacturayaClient extends FacturayaOperations {
  resolveTenantAccess(): Promise<FacturayaTenantAccess>;
  selectTenant(tenantId: string): Promise<FacturayaTenantAccess>;
  clearTenant(): Promise<boolean>;
}
