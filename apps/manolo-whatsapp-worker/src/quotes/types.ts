export const QUOTE_ROLE_KEY = "quotes";

export type QuoteItem = {
  position: number;
  description: string;
  quantity: number;
  unitPrice: number;
};

export type QuoteConfig = {
  legalName: string;
  taxId: string;
  address: string;
  services: string[];
  bankName: string;
  bankAccount: string;
  bankCci: string;
  advisorName: string;
  advisorPhone: string;
  currency: string;
  taxRate: number;
  pricesIncludeTax: boolean;
  validDays: number;
  logoUrl: string | null;
};

export type QuoteDraftStatus =
  | "collecting"
  | "ready"
  | "confirmed"
  | "sent"
  | "cancelled";

export type QuoteDraft = {
  id: string;
  tenantId: string;
  contactId: number;
  status: QuoteDraftStatus;
  sequenceScopeId: string | null;
  quoteNumber: string | null;
  customerName: string;
  customerTaxId: string;
  customerPhone: string;
  issuedAt: string | null;
  expiresAt: string | null;
  importeLetras: string;
  items: QuoteItem[];
};

export type QuoteExtraction = {
  customer: {
    name?: string;
    taxId?: string;
    phone?: string;
  };
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
  }>;
  assistantMessage: string;
  readyToConfirm: boolean;
};

export type QuoteDraftRow = {
  id: string;
  tenant_id: string;
  contact_id: number;
  status: QuoteDraftStatus;
  sequence_scope_id: string | null;
  quote_number: string | null;
  customer_name: string;
  customer_tax_id: string;
  customer_phone: string;
  issued_at: string | null;
  expires_at: string | null;
  importe_letras: string;
};

export type QuoteItemRow = {
  position: number;
  description: string;
  quantity: number;
  unit_price: number;
};

export type QuoteConfigRow = {
  legal_name: string;
  tax_id: string;
  address: string;
  services_json: string;
  bank_name: string;
  bank_account: string;
  bank_cci: string;
  advisor_name: string;
  advisor_phone: string;
  currency: string;
  tax_rate: number;
  prices_include_tax: number;
  valid_days: number;
  logo_url: string | null;
};
