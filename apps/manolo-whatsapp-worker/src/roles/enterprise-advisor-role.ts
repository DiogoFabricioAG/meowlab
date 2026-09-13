import type { AiMessage } from "../ai/contracts";
import type {
  FacturayaClient,
  FacturayaInvoiceDraft,
  FacturayaTenant,
  FacturayaTenantAccess,
} from "../facturaya/contracts";
import { FinanceRoleHandler } from "./finance-role";
import type { RoleHandler, RoleHandlerContext, TenantContext } from "./contracts";

export const ENTERPRISE_ADVISOR_ROLE_KEY = "enterprise-advisor";

const STATE_KEY = ENTERPRISE_ADVISOR_ROLE_KEY;
const SESSION_TTL_MS = 20 * 60 * 1_000;
const FINANCE_BUTTON_ID = "enterprise_finance";
const BILLING_BUTTON_ID = "enterprise_billing";
const INVOICE_BUTTON_ID = "enterprise_invoice";
const RECEIPT_BUTTON_ID = "enterprise_receipt";
const ISSUE_BUTTON_ID = "enterprise_issue_invoice";
const CHANGE_BUTTON_ID = "enterprise_change_invoice";
const CANCEL_BUTTON_ID = "enterprise_cancel";
const CHANGE_COMPANY_BUTTON_ID = "enterprise_change_company";
const COMPANY_BUTTON_PREFIX = "enterprise_company:";
const MAX_SOURCE_TEXT = 10_000;

type EnterpriseMode = "finance" | "billing";
type BillingDocumentKind = "invoice" | "receipt";
type BillingProductField = "product_or_service" | "quantity" | "unit_price_or_total";
type AuthorizedFacturayaTenantAccess = Extract<
  FacturayaTenantAccess,
  { status: "authorized" }
>;

type BillingState = {
  customerRuc: string;
  customerName: string;
  issueDate: string;
  taxMode: "included" | "excluded";
  productsText: string;
  productsReady: boolean;
  missingProductFields: BillingProductField[];
  documentKey?: string;
  documentFilename?: string;
  draftId?: string;
};

type EnterpriseState = {
  version: 1;
  startedAt: number;
  expiresAt: number;
  mode: EnterpriseMode | null;
  facturayaTenantId: string | null;
  billingDocumentKind: BillingDocumentKind | null;
  billing?: BillingState;
};

type BillingIntent = {
  action: "invoice" | "receipt" | "credit_note" | "unknown";
  customerRuc: string | null;
  customerName: string | null;
  issueDate: string | null;
  taxMode: "included" | "excluded" | null;
  productsText: string | null;
  productsReady: boolean | null;
  missingProductFields: BillingProductField[];
  invoiceNumber: string | null;
  reasonCode: string | null;
  reasonDescription: string | null;
};

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeCustomerName(value: unknown, allowGenericCustomer = false): string {
  const name = cleanText(value, 255);
  if (!name || /^\d+$/u.test(name)) return "";
  const placeholder = allowGenericCustomer
    ? /^(?:ruc|raz[oó]n social|nombre|pendiente|no indicado)$/iu
    : /^(?:ruc|cliente|raz[oó]n social|nombre|pendiente|no indicado)$/iu;
  return placeholder.test(name)
    ? ""
    : name;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function isSessionResetCommand(value: string): boolean {
  return /^(?:\/)?(?:reiniciar|reiniciar\s+(?:la\s+)?sesi[oó]n|empezar\s+de\s+nuevo|nueva\s+sesi[oó]n|reset(?:ear)?)$/iu.test(
    value.trim(),
  );
}

function parseDate(value: unknown): string | null {
  const candidate = cleanText(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : null;
}

function blobPart(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function parseCustomerDocument(value: unknown): string | null {
  const candidate = cleanText(value, 20).replace(/\D/g, "");
  return /^(?:\d{8}|\d{11})$/.test(candidate) ? candidate : null;
}

function parseFacturayaId(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 80);
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? String(value)
    : null;
}

function customerDocumentFromText(value: string, kind: BillingDocumentKind): string | null {
  const pattern = kind === "receipt" ? "\\d{8}|\\d{11}" : "\\d{11}";
  const match = value.match(new RegExp(`(?<!\\d)(${pattern})(?!\\d)`));
  return match ? parseCustomerDocument(match[1]) : null;
}

function customerNameFromText(value: string): string | null {
  const match = value.match(
    /\b(?:a\s+nombre\s+de|nombre\s+(?:del|de)\s+cliente)\s*[:#-]?\s*([\p{L}][\p{L}\p{M}.'-]*(?:\s+[\p{L}][\p{L}\p{M}.'-]*){0,5})(?=\s+(?:concepto|detalle|producto|servicio|cantidad|precio|costo|monto|importe|total|valor|por|con)\b|[,;.\n]|$)/iu,
  );
  return match ? normalizeCustomerName(match[1], true) || null : null;
}

function positiveAmount(value: string): boolean {
  const amount = Number.parseFloat(value.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(amount) && amount > 0;
}

function hasPositivePriceEvidence(value: string): boolean {
  const text = cleanText(value, MAX_SOURCE_TEXT);
  if (!text) return false;
  const amount = "(\\d{1,9}(?:[.,]\\d{1,2})?)";
  const patterns = [
    new RegExp(`(?:s\\/?\\.?|pen|usd|us\\$|\\$)\\s*${amount}`, "iu"),
    new RegExp(`${amount}\\s*(?:sol(?:es)?|pen|d[oó]lares?|usd)\\b`, "iu"),
    new RegExp(`\\b(?:precio|costo|coste|monto|importe|total|valor)\\s*(?:unitario|final|total)?\\s*(?:es|de|a|:|-)?\\s*(?:s\\/?\\.?|pen|usd|us\\$|\\$)?\\s*${amount}`, "iu"),
    new RegExp(`\\b(?:c\\/?u|cada\\s+(?:uno|una|unidad))\\s*(?:a|es|:|-)?\\s*(?:s\\/?\\.?|pen|usd|us\\$|\\$)?\\s*${amount}`, "iu"),
    new RegExp(`${amount}\\s*(?:c\\/?u|cada\\s+(?:uno|una|unidad))\\b`, "iu"),
  ];
  return patterns.some((pattern) => {
    const match = text.match(pattern);
    return Boolean(match?.[1] && positiveAmount(match[1]));
  });
}

function productTerms(value: string): Set<string> {
  const ignored = /^(?:para|como|este|esta|estos|estas|cada|total|monto|precio|costo|soles|unidad|unidades|producto|productos|servicio|servicios|con|por|del|las|los)$/iu;
  return new Set(
    value.toLocaleLowerCase("es")
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .match(/[a-z]{4,}/g)
      ?.filter((term) => !ignored.test(term)) ?? [],
  );
}

function sharesProductTerms(previous: string, incoming: string): boolean {
  const previousTerms = productTerms(previous);
  return [...productTerms(incoming)].some((term) => previousTerms.has(term));
}

function mergeProductsText(previous: string, incoming: string | null, rawMessage: string): string {
  const current = cleanText(incoming, MAX_SOURCE_TEXT);
  if (!previous) return current;
  if (!hasPositivePriceEvidence(previous) && hasPositivePriceEvidence(rawMessage)) {
    if (current && sharesProductTerms(previous, current)) return current;
    const priceDetail = current || cleanText(rawMessage, MAX_SOURCE_TEXT);
    return priceDetail ? `${previous}. ${priceDetail}`.slice(0, MAX_SOURCE_TEXT) : previous;
  }
  return current || previous;
}

function parseMissingProductFields(value: unknown): BillingProductField[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<BillingProductField>([
    "product_or_service",
    "quantity",
    "unit_price_or_total",
  ]);
  return [...new Set(value.filter((field): field is BillingProductField =>
    typeof field === "string" && allowed.has(field as BillingProductField),
  ))];
}

function fallbackProductsText(value: string): string | null {
  const candidate = cleanText(value, MAX_SOURCE_TEXT)
    .replace(/\b(?:(?:ruc|dni)\s*[:#-]?\s*\d{8,11}|\d{8,11}\s*(?:ruc|dni))\b/giu, " ")
    .replace(
      /\b(?:(?:quiero|necesito|deseo|puedes|favor de|por favor)?\s*(?:realizar|crear|hacer|generar|preparar|emitir)?\s*(?:una\s+)?(?:factura|boleta)(?:\s+electr[oó]nica)?(?:\s+(?:por|de))?)\b/giu,
      " ",
    )
    .replace(/\s+/g, " ")
    .replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, "")
    .trim();
  if (!candidate) return null;

  const withoutMoneyAndMetadata = candidate
    .replace(/(?:s\/?\s*)?\d+(?:[.,]\d{1,2})?\s*(?:sol(?:es)?|pen)\b/giu, " ")
    .replace(/\b(?:monto|importe|total|incluido|incluye|igv)\b/giu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const meaningfulWords = withoutMoneyAndMetadata
    .split(/\s+/u)
    .filter((word) => word.length > 2 && !/^(?:del|por|para|con|una|uno|los|las|que|ruc)$/iu.test(word));
  const hasProductCue = /\b(?:detalle|concepto|producto|servicio|cantidad|unidades?)\b/iu.test(candidate);
  const isChangeInstruction = /^(?:cambiar|cambia|modificar|modifica|actualizar|actualiza|corregir|corrige)\b/iu.test(candidate);
  const isCustomerOnly = /^(?:\s*(?:dni|ruc)\s*[:#-]?\s*)?\d{8,11}\s+[\p{L}\p{M}][\p{L}\p{M}\s.'-]*$/iu.test(candidate);
  const hasQuantityWithDescription = /\b\d{1,4}(?:[.,]\d+)?\s+(?!sol(?:es)?\b|pen\b)[\p{L}][\p{L}\p{M}-]*/iu.test(candidate);
  if (isChangeInstruction && !hasProductCue) return null;
  if (isCustomerOnly && !hasProductCue) return null;
  if (!hasProductCue && !hasQuantityWithDescription && meaningfulWords.length < 2) return null;
  return candidate;
}

function fallbackBillingIntent(text: string, kind: BillingDocumentKind): BillingIntent {
  const productsText = fallbackProductsText(text);
  const productsReady = productsText ? hasPositivePriceEvidence(productsText) : null;
  return {
    action: /\bnota\s+de\s+cr[eé]dito\b/iu.test(text)
      ? "credit_note"
      : /\bboleta\b/iu.test(text)
        ? "receipt"
      : /\bfactur(?:a|ar|aci[oó]n)\b/iu.test(text)
        ? "invoice"
        : "unknown",
    customerRuc: customerDocumentFromText(text, kind),
    customerName: customerNameFromText(text),
    issueDate: null,
    taxMode: null,
    productsText,
    productsReady,
    missingProductFields: productsText && !productsReady ? ["unit_price_or_total"] : [],
    invoiceNumber: null,
    reasonCode: null,
    reasonDescription: null,
  };
}

function mergeBillingIntent(
  extracted: BillingIntent | null,
  fallback: BillingIntent,
): BillingIntent {
  if (!extracted) return fallback;
  return {
    action: extracted.action === "unknown" ? fallback.action : extracted.action,
    customerRuc: extracted.customerRuc ?? fallback.customerRuc,
    customerName: extracted.customerName ?? fallback.customerName,
    issueDate: extracted.issueDate ?? fallback.issueDate,
    taxMode: extracted.taxMode ?? fallback.taxMode,
    productsText: extracted.productsText ?? fallback.productsText,
    productsReady: extracted.productsReady ?? fallback.productsReady,
    missingProductFields: extracted.productsReady === null
      ? fallback.missingProductFields
      : extracted.missingProductFields,
    invoiceNumber: extracted.invoiceNumber ?? fallback.invoiceNumber,
    reasonCode: extracted.reasonCode ?? fallback.reasonCode,
    reasonDescription: extracted.reasonDescription ?? fallback.reasonDescription,
  };
}

function normalizeStoredProducts(value: unknown): string {
  const text = cleanText(value, MAX_SOURCE_TEXT);
  if (!text) return "";
  const metadataOnly = /^(?:(?:ruc|dni)\s*[:#-]?\s*\d{8,11}|\d{8,11}\s*(?:ruc|dni)|(?:monto|importe|total)\s*[:#-]?\s*(?:s\/?\s*)?\d+(?:[.,]\d{1,2})?)$/iu;
  return metadataOnly.test(text) ? "" : text;
}

function parseState(raw: string | null): EnterpriseState | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== 1) return null;
    const startedAt = typeof value.startedAt === "number" ? value.startedAt : 0;
    const expiresAt = typeof value.expiresAt === "number" ? value.expiresAt : 0;
    const mode = value.mode === "finance" || value.mode === "billing" ? value.mode : null;
    if (!Number.isFinite(startedAt) || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      return null;
    }
    const storedCustomerDocument = isRecord(value.billing)
      ? parseCustomerDocument(value.billing.customerRuc)
      : null;
    const draftId = isRecord(value.billing) ? parseFacturayaId(value.billing.draftId) : null;
    const billingDocumentKind = value.billingDocumentKind === "invoice" || value.billingDocumentKind === "receipt"
      ? value.billingDocumentKind
      : storedCustomerDocument?.length === 8
        ? "receipt"
        : storedCustomerDocument?.length === 11 || draftId
          ? "invoice"
          : null;
    const billing = isRecord(value.billing)
      ? {
          customerRuc: storedCustomerDocument ?? "",
          customerName: normalizeCustomerName(value.billing.customerName, billingDocumentKind === "receipt"),
          issueDate: parseDate(value.billing.issueDate) ?? today(),
          taxMode: value.billing.taxMode === "excluded" ? "excluded" as const : "included" as const,
          productsText: normalizeStoredProducts(value.billing.productsText),
          productsReady: typeof value.billing.productsReady === "boolean"
            ? value.billing.productsReady
            : hasPositivePriceEvidence(normalizeStoredProducts(value.billing.productsText)),
          missingProductFields: parseMissingProductFields(value.billing.missingProductFields),
          ...(cleanText(value.billing.documentKey, 500) ? { documentKey: cleanText(value.billing.documentKey, 500) } : {}),
          ...(cleanText(value.billing.documentFilename, 255) ? { documentFilename: cleanText(value.billing.documentFilename, 255) } : {}),
          ...(draftId ? { draftId } : {}),
        }
      : undefined;
    const facturayaTenantId = cleanText(value.facturayaTenantId, 120) || null;
    return {
      version: 1,
      startedAt,
      expiresAt,
      mode,
      facturayaTenantId,
      billingDocumentKind,
      ...(billing ? { billing } : {}),
    };
  } catch {
    return null;
  }
}

function documentKeyFromRaw(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) && isRecord(value.billing) && cleanText(value.billing.documentKey, 500)
      ? cleanText(value.billing.documentKey, 500)
      : null;
  } catch {
    return null;
  }
}

function jsonCandidate(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
}

function parseIntent(content: string, kind: BillingDocumentKind): BillingIntent | null {
  try {
    const value: unknown = JSON.parse(jsonCandidate(content));
    if (!isRecord(value)) return null;
    const action = value.action === "invoice" || value.action === "receipt" || value.action === "credit_note"
      ? value.action
      : "unknown";
    return {
      action,
      customerRuc: customerDocumentFromText(
        cleanText(value.customer_document ?? value.customer_ruc, 20),
        kind,
      ),
      customerName: normalizeCustomerName(value.customer_name, kind === "receipt") || null,
      issueDate: parseDate(value.issue_date),
      taxMode: value.tax_mode === "excluded" || value.tax_mode === "included" ? value.tax_mode : null,
      productsText: cleanText(value.products_text, MAX_SOURCE_TEXT) || null,
      productsReady: typeof value.products_ready === "boolean" ? value.products_ready : null,
      missingProductFields: parseMissingProductFields(value.missing_product_data),
      invoiceNumber: cleanText(value.invoice_number, 80) || null,
      reasonCode: cleanText(value.reason_code, 10) || null,
      reasonDescription: cleanText(value.reason_description, 250) || null,
    };
  } catch {
    return null;
  }
}

function asHistoryMessage(context: RoleHandlerContext, state: EnterpriseState): AiMessage[] {
  return context.history
    .filter((item) => {
      if (!item.createdAt) return true;
      const normalized = item.createdAt.includes("T") ? item.createdAt : `${item.createdAt.replace(" ", "T")}Z`;
      const timestamp = Date.parse(normalized);
      return !Number.isFinite(timestamp) || timestamp >= state.startedAt;
    })
    .slice(-40)
    .map((item): AiMessage => ({ role: item.role, content: item.content }));
}

async function getState(context: RoleHandlerContext): Promise<EnterpriseState | null> {
  if (!context.roleState || context.persisted.contactId === null) return null;
  const raw = await context.roleState.get(context.tenant.tenantId, context.persisted.contactId, STATE_KEY);
  const state = parseState(raw);
  if (!state && raw) {
    const expiredDocumentKey = documentKeyFromRaw(raw);
    if (expiredDocumentKey && context.documentStore) {
      await context.documentStore.delete(expiredDocumentKey);
    }
    await context.roleState.clear(context.tenant.tenantId, context.persisted.contactId, STATE_KEY);
  }
  return state;
}

async function saveState(context: RoleHandlerContext, state: EnterpriseState): Promise<boolean> {
  if (!context.roleState || context.persisted.contactId === null) return false;
  return context.roleState.set(
    context.tenant.tenantId,
    context.persisted.contactId,
    STATE_KEY,
    JSON.stringify(state),
  );
}

async function deleteStoredDocument(context: RoleHandlerContext, state: EnterpriseState | null): Promise<void> {
  if (state?.billing?.documentKey && context.documentStore) {
    await context.documentStore.delete(state.billing.documentKey);
  }
}

async function clearState(context: RoleHandlerContext, state: EnterpriseState | null): Promise<void> {
  await deleteStoredDocument(context, state);
  if (context.roleState && context.persisted.contactId !== null) {
    await context.roleState.clear(context.tenant.tenantId, context.persisted.contactId, STATE_KEY);
  }
}

async function showModeMenu(context: RoleHandlerContext, message = "¿Qué deseas hacer hoy?"): Promise<void> {
  if (context.sendButtons) {
    await context.sendButtons(message, [
      { id: FINANCE_BUTTON_ID, title: "Finanzas" },
      { id: BILLING_BUTTON_ID, title: "Facturación" },
    ]);
    return;
  }
  await context.reply(`${message}\n\nResponde Finanzas o Facturación.`);
}

async function showBillingDocumentMenu(
  context: RoleHandlerContext,
  message = "¿Qué comprobante deseas crear?",
): Promise<void> {
  if (context.sendButtons) {
    await context.sendButtons(message, [
      { id: INVOICE_BUTTON_ID, title: "Factura" },
      { id: RECEIPT_BUTTON_ID, title: "Boleta" },
    ]);
    return;
  }
  await context.reply(`${message}\n\nResponde Factura o Boleta.`);
}

function companyInteractionId(tenantId: string): string {
  return `${COMPANY_BUTTON_PREFIX}${tenantId}`.slice(0, 250);
}

function selectedCompanyId(interactionId: string | null): string | null {
  if (!interactionId?.startsWith(COMPANY_BUTTON_PREFIX)) return null;
  const tenantId = interactionId.slice(COMPANY_BUTTON_PREFIX.length).trim();
  return /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/.test(tenantId)
    ? tenantId
    : null;
}

function isChangeCompanyRequest(interactionId: string | null, text: string): boolean {
  return interactionId === CHANGE_COMPANY_BUTTON_ID
    || /^(?:cambiar|seleccionar|elegir)\s+empresa$/iu.test(text.trim());
}

async function showCompanySelection(
  context: RoleHandlerContext,
  tenants: readonly FacturayaTenant[],
): Promise<void> {
  const body = "Tienes acceso a varias empresas. Elige con cuál deseas facturar:";
  if (context.sendList) {
    await context.sendList(body, "Elegir empresa", [{
      title: "Empresas autorizadas",
      rows: tenants.slice(0, 10).map((tenant) => ({
        id: companyInteractionId(tenant.id),
        title: (tenant.legalName || tenant.name).slice(0, 24),
        description: [
          tenant.ruc ? `RUC ${tenant.ruc}` : null,
          tenant.environment === "beta" ? "Pruebas" : "Producción",
        ].filter(Boolean).join(" · ").slice(0, 72),
      })),
    }]);
    return;
  }
  await context.reply([
    body,
    ...tenants.map((tenant, index) =>
      `${index + 1}. ${tenant.legalName || tenant.name}${tenant.ruc ? ` — RUC ${tenant.ruc}` : ""}`,
    ),
  ].join("\n"));
}

async function ensureFacturayaTenant(
  context: RoleHandlerContext,
): Promise<AuthorizedFacturayaTenantAccess | null> {
  const client = context.facturaya;
  if (!client) {
    await context.reply("La conexión segura con FacturaYa todavía no está disponible.");
    return null;
  }
  const selectedId = selectedCompanyId(context.message.interactionId);
  if (selectedId) {
    const selected = await client.selectTenant(selectedId);
    if (selected.status !== "authorized") {
      await context.reply("No tienes autorización para usar esa empresa.");
      return null;
    }
    await context.reply(`Empresa activa: ${selected.tenant.legalName || selected.tenant.name}${selected.tenant.ruc ? ` · RUC ${selected.tenant.ruc}` : ""}.`);
    return selected;
  }
  if (isChangeCompanyRequest(context.message.interactionId, context.message.text)) {
    await client.clearTenant();
  }
  const access = await client.resolveTenantAccess();
  if (access.status === "authorized") return access;
  if (access.status === "selection_required") {
    await showCompanySelection(context, access.tenants);
    return null;
  }
  if (access.status === "unauthorized") {
    await context.reply("Tu número no está autorizado para usar FacturaYa. Solicita a un administrador que te agregue a una empresa.");
    return null;
  }
  await context.reply(access.message || "No pude consultar tus empresas en este momento. Intenta nuevamente en unos segundos.");
  return null;
}

function billingDocumentKindFromMessage(
  interactionId: string | null,
  text: string,
): BillingDocumentKind | null {
  if (interactionId === INVOICE_BUTTON_ID || /^factura(?:\s+electr[oó]nica)?$/iu.test(text.trim())) {
    return "invoice";
  }
  if (interactionId === RECEIPT_BUTTON_ID || /^boleta(?:\s+electr[oó]nica)?$/iu.test(text.trim())) {
    return "receipt";
  }
  return null;
}

function documentContract(kind: BillingDocumentKind, billing: BillingState): {
  documentType: "01" | "03";
  customerDocumentType: "0" | "1" | "6";
  customerRuc: string | null;
  customerName: string | null;
} {
  if (kind === "receipt" && !billing.customerRuc) {
    return {
      documentType: "03",
      customerDocumentType: "0",
      customerRuc: null,
      customerName: billing.customerName || null,
    };
  }
  return {
    documentType: kind === "receipt" ? "03" : "01",
    customerDocumentType: kind === "receipt" ? (billing.customerRuc?.length === 11 ? "6" : "1") : "6",
    customerRuc: billing.customerRuc || null,
    customerName: billing.customerName || null,
  };
}

function documentName(kind: BillingDocumentKind): "factura" | "boleta" {
  return kind === "receipt" ? "boleta" : "factura";
}

function customerDocumentLabel(kind: BillingDocumentKind, customerRuc?: string | null): "DNI" | "RUC" {
  return kind === "receipt" && customerRuc?.length === 11 ? "RUC" : kind === "receipt" ? "DNI" : "RUC";
}

function billingActivationMessage(kind: BillingDocumentKind): string {
  return kind === "receipt"
    ? "Boleta activada. Puedes emitirla como consumidor final sin DNI hasta S/ 700.00. Si deseas identificar al cliente, envíame su DNI y nombre, junto con el texto, PDF o documento de los productos."
    : "Factura activada. Envíame el RUC del cliente y luego el texto, PDF o documento con los productos.";
}

function newSession(): EnterpriseState {
  const now = Date.now();
  return {
    version: 1,
    startedAt: now,
    expiresAt: now + SESSION_TTL_MS,
    mode: null,
    facturayaTenantId: null,
    billingDocumentKind: null,
  };
}

function touch(state: EnterpriseState): EnterpriseState {
  return { ...state, expiresAt: Date.now() + SESSION_TTL_MS };
}

async function extractBillingIntent(
  context: RoleHandlerContext,
  state: EnterpriseState,
  kind: BillingDocumentKind,
): Promise<BillingIntent> {
  const text = context.message.text.trim();
  const fallback = fallbackBillingIntent(text, kind);
  if (!text && context.document) {
    return {
      action: kind,
      customerRuc: null,
      customerName: null,
      issueDate: null,
      taxMode: null,
      productsText: null,
      productsReady: null,
      missingProductFields: [],
      invoiceNumber: null,
      reasonCode: null,
      reasonDescription: null,
    };
  }

  if (!context.ai) return fallback;
  const system = `Eres el extractor estructurado de un asistente empresarial peruano. Devuelve SOLO JSON válido.
El comprobante seleccionado en esta sesión es ${documentName(kind)}.
Clasifica la solicitud como invoice (crear factura), receipt (crear boleta), credit_note (crear nota de crédito) o unknown.
Extrae únicamente datos explícitos. No inventes documentos, nombres, precios, números ni motivos.
Para una factura, customer_document es un RUC de 11 dígitos. Para una boleta identificada, customer_document es un DNI de 8 dígitos o un RUC de 11 dígitos. Si el comprador no solicita identificación, devuelve customer_document como null y se usará consumidor final; FacturaYa valida el límite de S/ 700.00. Si el mensaje incluye un nombre explícito como "a nombre de Patricia M" aunque no incluya DNI o RUC, conserva ese nombre en customer_name como referencia comercial opcional y deja customer_document en null; nunca conviertas ese nombre en un documento ni lo descartes.
Evalúa la información comercial de cada producto o servicio usando el mensaje actual, el historial y el estado de la sesión. Para estar listo debe existir una descripción, una cantidad positiva y un precio unitario positivo o un costo total positivo. Una cantidad física nunca cuenta como precio.
Si falta algún dato, products_ready debe ser false y missing_product_data debe contener únicamente los códigos faltantes: product_or_service, quantity o unit_price_or_total. Si todo está completo, products_ready debe ser true y missing_product_data debe ser [].
products_text debe conservar descripción, cantidad y precio. Cuando el usuario complete o cambie productos, devuelve el texto COMPLETO consolidado con los datos anteriores de la sesión y los nuevos; no devuelvas solamente el dato modificado ni olvides productos previos.
La sesión ya contiene datos previos. Para los demás campos, si el usuario está corrigiendo o cambiando algo, devuelve únicamente el dato modificado y usa null para lo que no cambió. Nunca solicites de nuevo datos que ya estén registrados.
reason_code permitido: 01 anulación, 02 error de RUC, 03 corrección de descripción, 04 descuento global, 05 descuento por ítem, 06 devolución total, 07 devolución por ítem, 09 disminución de valor, 10 otros.
Formato exacto: {"action":"invoice|receipt|credit_note|unknown","customer_document":string|null,"customer_name":string|null,"issue_date":"YYYY-MM-DD"|null,"tax_mode":"included|excluded"|null,"products_text":string|null,"products_ready":boolean,"missing_product_data":["product_or_service|quantity|unit_price_or_total"],"invoice_number":string|null,"reason_code":string|null,"reason_description":string|null}.
La sesión actual ya tiene estos datos: ${JSON.stringify(state.billing ?? {})}`;
  const content = await context.ai.complete(
    {
      model: context.tenant.aiModel,
      messages: [
        { role: "system", content: system },
        ...asHistoryMessage(context, state),
        {
          role: "user",
          content: context.document
            ? `${text}\n[Se adjuntó el documento ${context.document.filename} para extraer productos o servicios.]`
            : text,
        },
      ],
      temperature: 0,
      maxTokens: 1_200,
      reasoningEffort: "high",
      responseFormat: { type: "json_object" },
    },
    context.log,
  );
  const parsed = content ? parseIntent(content, kind) : null;
  return mergeBillingIntent(parsed, fallback);
}

function hasIdentifiedCustomer(billing: BillingState, kind: BillingDocumentKind): boolean {
  return kind === "invoice" || Boolean(billing.customerRuc);
}

function missingBillingFields(billing: BillingState, kind: BillingDocumentKind): string[] {
  const missing: string[] = [];
  if (hasIdentifiedCustomer(billing, kind)) {
    if (!billing.customerRuc) missing.push(`el ${customerDocumentLabel(kind)} del cliente`);
    if (!billing.customerName) {
      missing.push(kind === "receipt" ? "el nombre del cliente" : "la razón social o el nombre del cliente");
    }
  }
  if (!billing.productsText && !billing.documentKey) {
    missing.push("los productos o servicios, con sus cantidades y precios");
  } else if (!billing.documentKey && !billing.productsReady) {
    const labels: Record<BillingProductField, string> = {
      product_or_service: "la descripción del producto o servicio",
      quantity: "la cantidad",
      unit_price_or_total: "el costo total o precio unitario",
    };
    const productFields = billing.missingProductFields.length > 0
      ? billing.missingProductFields
      : ["unit_price_or_total" as const];
    missing.push(...productFields.map((field) => labels[field]));
  }
  return missing;
}

function draftMissingPricing(draft: FacturayaInvoiceDraft): boolean {
  const total = Number(draft.totals?.total ?? Number.NaN);
  if (!Number.isFinite(total) || total <= 0) return true;
  const items = draft.items ?? [];
  return items.length === 0 || items.some((item) => {
    const lineTotal = Number(item.line_total ?? Number.NaN);
    return !Number.isFinite(lineTotal) || lineTotal <= 0;
  });
}

function isAnonymousReceiptDraft(draft: FacturayaInvoiceDraft, kind: BillingDocumentKind): boolean {
  const documentType = draft.customer?.document_type;
  return kind === "receipt"
    && (documentType === "0" || (!documentType && !draft.customer?.ruc));
}

function anonymousReceiptRequiresIdentification(
  draft: FacturayaInvoiceDraft,
  kind: BillingDocumentKind,
): boolean {
  if (!isAnonymousReceiptDraft(draft, kind)) return false;
  const currency = (draft.currency || "PEN").toUpperCase();
  const total = Number(draft.totals?.total ?? NaN);
  return currency !== "PEN" || (Number.isFinite(total) && total > 700);
}

function billingProgressFallback(billing: BillingState, kind: BillingDocumentKind): string {
  const captured: string[] = [];
  if (billing.customerRuc) captured.push(`${customerDocumentLabel(kind, billing.customerRuc)} ${billing.customerRuc}`);
  if (billing.customerName) captured.push(`cliente ${billing.customerName}`);
  if (billing.productsText) captured.push("el detalle de los productos");
  const missing = missingBillingFields(billing, kind);
  const prefix = captured.length > 0
    ? `He guardado ${captured.join(" y ")}. `
    : "He recibido tu información. ";
  if (missing.length === 1 && missing[0] === "el costo total o precio unitario") {
    return `${prefix}Ahora me falta este dato: costo total o precio unitario.`;
  }
  return `${prefix}Para continuar me falta ${missing.join(" y ")}. Puedes enviarlo todo junto o por mensajes separados.`;
}

async function replyBillingProgress(
  context: RoleHandlerContext,
  billing: BillingState,
  kind: BillingDocumentKind,
): Promise<void> {
  const missing = missingBillingFields(billing, kind);
  const fallback = billingProgressFallback(billing, kind);
  if (!context.ai || missing.length === 0) {
    await context.reply(fallback);
    return;
  }

  const content = await context.ai.complete(
    {
      model: context.tenant.aiModel,
      messages: [
        {
          role: "system",
          content: `Eres un asesor serio de facturación peruana. Redacta una respuesta breve, clara y natural en español para ayudar al usuario a completar una ${documentName(kind)}.
Reconoce específicamente la información nueva del último mensaje, menciona lo que ya quedó registrado y solicita únicamente los datos faltantes. Responde de forma contextual y evita repetir literalmente respuestas anteriores. No inventes datos, no digas que la factura ya fue creada y no hables de modelos, JSON, campos internos ni programación.
Datos registrados: ${JSON.stringify({
            customerRuc: billing.customerRuc || null,
            customerName: billing.customerName || null,
            hasProducts: Boolean(billing.productsText),
            productsReady: billing.productsReady,
            missingProductFields: billing.missingProductFields,
            hasDocument: Boolean(billing.documentKey),
          })}
Datos faltantes: ${JSON.stringify(missing)}
Máximo 3 frases.`,
        },
        { role: "user", content: context.message.text.trim() || "El usuario adjuntó un documento." },
      ],
      temperature: 0.4,
      maxTokens: 900,
      reasoningEffort: context.tenant.aiReasoningEffort ?? "high",
    },
    context.log,
  );
  const reply = content?.trim();
  const naturalReply = reply && !reply.startsWith("{") ? reply : fallback;
  const customerConfirmation = kind === "invoice" && billing.customerRuc && billing.customerName
    ? `Encontré ${billing.customerName} para el RUC ${billing.customerRuc}.`
    : "";
  const includesCustomerName = billing.customerName
    ? naturalReply.toLocaleLowerCase("es").includes(billing.customerName.toLocaleLowerCase("es"))
    : true;
  await context.reply(customerConfirmation && !includesCustomerName
    ? `${customerConfirmation}\n${naturalReply}`
    : naturalReply);
}

function invoiceSummary(draft: FacturayaInvoiceDraft, kind: BillingDocumentKind): string {
  const items = (draft.items ?? []).slice(0, 20).map((item) =>
    `• ${item.quantity ?? 1} × ${cleanText(item.description, 120)} — S/ ${Number(item.line_total ?? 0).toFixed(2)}`,
  );
  const total = Number(draft.totals?.total ?? 0).toFixed(2);
  const name = documentName(kind);
  const anonymousReceipt = isAnonymousReceiptDraft(draft, kind);
  const customerName = anonymousReceipt
    ? (draft.customer?.name || "Consumidor final")
    : draft.customer?.name || "pendiente";
  const customerDocument = anonymousReceipt
    ? "Sin documento"
    : draft.customer?.ruc || "pendiente";
  const nextStep = anonymousReceiptRequiresIdentification(draft, kind)
    ? "La boleta supera el límite para consumidor final. Selecciona Cambiar datos e indica el DNI o RUC del cliente."
    : "¿Deseas emitirla ante SUNAT?";
  return [
    `Borrador de ${name} creado:`,
    `Cliente: ${customerName}`,
    `${anonymousReceipt ? "Documento" : customerDocumentLabel(kind, draft.customer?.ruc)}: ${customerDocument}`,
    `Fecha: ${draft.issue_date || today()}`,
    "",
    "Productos:",
    ...(items.length > 0 ? items : ["• Revisa los conceptos en FacturaYa"]),
    "",
    `Total: S/ ${total}`,
    "",
    nextStep,
  ].join("\n");
}

async function replyDraft(
  context: RoleHandlerContext,
  draft: FacturayaInvoiceDraft,
  kind: BillingDocumentKind,
): Promise<void> {
  const body = invoiceSummary(draft, kind);
  if (context.sendButtons) {
    await context.sendButtons(body, [
      ...(!anonymousReceiptRequiresIdentification(draft, kind)
        ? [{ id: ISSUE_BUTTON_ID, title: `Emitir ${documentName(kind)}` }]
        : []),
      { id: CHANGE_BUTTON_ID, title: "Cambiar datos" },
      { id: CANCEL_BUTTON_ID, title: "Cancelar" },
    ]);
    return;
  }
  await context.reply(`${body}\n\nResponde emitir, cambiar o cancelar.`);
}

function facturayaFailure(result: { reason: string; message?: string }): string {
  if (result.reason === "not_configured") return "La conexión con FacturaYa todavía no está configurada para esta empresa.";
  if (result.reason === "unauthorized") return "FacturaYa rechazó la conexión de esta empresa. Revisa su token de API.";
  return result.message || "FacturaYa no pudo procesar la solicitud. Intenta nuevamente en unos segundos.";
}

async function emitInvoice(context: RoleHandlerContext, state: EnterpriseState, client: FacturayaClient): Promise<void> {
  const draftId = state.billing?.draftId;
  if (!draftId) {
    await context.reply("Todavía no hay un borrador listo para emitir.");
    return;
  }
  const result = await client.issueInvoice(draftId);
  if (!result.ok) {
    await context.reply(facturayaFailure(result));
    return;
  }

  const invoice = result.data;
  const kind: BillingDocumentKind = invoice.document_type === "03"
    ? "receipt"
    : state.billingDocumentKind ?? "invoice";
  const displayName = documentName(kind);
  const status = invoice.status === "accepted" ? "aceptada por SUNAT" : `quedó en estado ${invoice.status}`;
  await context.reply(`${displayName === "boleta" ? "Boleta" : "Factura"} ${invoice.number}: ${status}.\n${invoice.sunat?.message || ""}`.trim());
  if (invoice.status === "accepted" && invoice.files?.pdf && context.sendDocument) {
    const pdf = await client.downloadFile(invoice.files.pdf);
    if (pdf.ok) {
      await context.sendDocument({
        pdf: new Blob([blobPart(pdf.data.bytes)], { type: pdf.data.mimeType }),
        filename: `${invoice.number}.pdf`,
        caption: `${displayName === "boleta" ? "Boleta" : "Factura"} ${invoice.number} aceptada por SUNAT.`,
      });
    }
  }
  await clearState(context, state);
}

function inferReasonCode(text: string): string | null {
  const normalized = text.toLocaleLowerCase("es");
  if (normalized.includes("devolución total") || normalized.includes("devolucion total")) return "06";
  if (normalized.includes("error en el ruc") || normalized.includes("error de ruc")) return "02";
  if (normalized.includes("anul")) return "01";
  if (normalized.includes("descripción") || normalized.includes("descripcion")) return "03";
  if (normalized.includes("descuento global")) return "04";
  if (normalized.includes("disminución") || normalized.includes("disminucion")) return "09";
  return null;
}

async function handleCreditNote(
  context: RoleHandlerContext,
  state: EnterpriseState,
  intent: BillingIntent,
  client: FacturayaClient,
): Promise<void> {
  const invoiceNumber = intent.invoiceNumber || (state.billing?.productsText ?? "").match(/[A-Z]{1,4}\d{1,4}-\d+/i)?.[0] || null;
  const reasonCode = intent.reasonCode || inferReasonCode(context.message.text);
  const reasonDescription = intent.reasonDescription || context.message.text.trim();
  if (!invoiceNumber || !reasonCode || !reasonDescription) {
    await context.reply("Para crear la nota de crédito necesito el número de factura y el motivo. Ejemplo: “anula la F001-123 por devolución total”.");
    return;
  }

  const drafts = await client.listInvoiceDrafts();
  if (!drafts.ok) {
    await context.reply(facturayaFailure(drafts));
    return;
  }
  const target = drafts.data.find((draft) => draft.invoice?.number?.toLocaleLowerCase() === invoiceNumber.toLocaleLowerCase());
  if (!target?.invoice) {
    await context.reply(`No encontré la factura ${invoiceNumber} en la empresa. Verifica el número y vuelve a intentarlo.`);
    return;
  }

  const result = await client.createCreditNote(target.invoice.id, {
    issueDate: intent.issueDate || today(),
    reasonCode,
    reasonDescription,
  });
  if (!result.ok) {
    await context.reply(facturayaFailure(result));
    return;
  }
  await context.reply(`Nota de crédito ${result.data.number}: ${result.data.status}.\n${result.data.sunat?.message || ""}`.trim());
  await clearState(context, state);
}

async function handleBilling(
  context: RoleHandlerContext,
  state: EnterpriseState,
): Promise<void> {
  const kind = state.billingDocumentKind;
  if (!kind) {
    await showBillingDocumentMenu(context);
    return;
  }
  const client = context.facturaya;
  if (!client) {
    await context.reply("La conexión con FacturaYa todavía no está disponible para esta empresa.");
    return;
  }

  if (context.message.interactionId === CANCEL_BUTTON_ID || /^cancelar$/iu.test(context.message.text.trim())) {
    await clearState(context, state);
    await context.reply("Operación cancelada. No emití ningún comprobante.");
    return;
  }
  if (context.message.interactionId === ISSUE_BUTTON_ID || /^(?:emitir|emitir (?:factura|boleta)|confirmar)$/iu.test(context.message.text.trim())) {
    await emitInvoice(context, state, client);
    return;
  }
  if (context.message.interactionId === CHANGE_BUTTON_ID || /^(?:cambiar|cambiar datos)$/iu.test(context.message.text.trim())) {
    const next = touch({
      ...state,
      billing: state.billing
        ? { ...state.billing, draftId: undefined }
        : undefined,
    });
    await saveState(context, next);
    await context.reply(`Perfecto. Conservo los datos actuales de la ${documentName(kind)}. Indícame solamente qué deseas cambiar; luego volveré a mostrarte las opciones para emitirla o seguir modificándola.`);
    return;
  }

  const intent = await extractBillingIntent(context, state, kind);
  if (intent.action === "credit_note") {
    await handleCreditNote(context, state, intent, client);
    return;
  }

  const productsText = mergeProductsText(
    state.billing?.productsText || "",
    intent.productsText,
    context.message.text,
  );
  const productsChanged = Boolean(intent.productsText)
    || (!hasPositivePriceEvidence(state.billing?.productsText || "")
      && hasPositivePriceEvidence(context.message.text));
  const productsReady = intent.productsReady
    ?? (productsChanged
      ? hasPositivePriceEvidence(productsText)
      : state.billing?.productsReady ?? hasPositivePriceEvidence(productsText));
  const missingProductFields = intent.productsReady === false
    ? intent.missingProductFields
    : productsReady
      ? []
      : state.billing?.missingProductFields ?? intent.missingProductFields;

  let billing: BillingState = {
    customerRuc: intent.customerRuc || state.billing?.customerRuc || "",
    customerName: intent.customerName || state.billing?.customerName || "",
    issueDate: intent.issueDate || state.billing?.issueDate || today(),
    taxMode: intent.taxMode || state.billing?.taxMode || "included",
    productsText,
    productsReady,
    missingProductFields,
    ...(state.billing?.documentKey ? { documentKey: state.billing.documentKey, documentFilename: state.billing.documentFilename } : {}),
  };
  const detectedCustomerDocument = customerDocumentFromText(context.message.text, kind);
  if (!billing.customerRuc && detectedCustomerDocument) billing.customerRuc = detectedCustomerDocument;
  if (kind === "invoice" && billing.customerRuc && !billing.customerName) {
    const customer = await client.lookupCustomer(billing.customerRuc);
    if (customer.ok) {
      billing.customerName = customer.data.name;
      context.log("whatsapp_facturaya_customer_resolved", {
        source: customer.data.source || "unknown",
        provider: customer.data.provider || "unknown",
        status: customer.data.status || "unknown",
      });
    } else {
      context.log("whatsapp_facturaya_customer_lookup_failed", {
        reason: customer.reason,
      });
    }
  }

  if (context.document) {
    if (!context.documentStore || context.persisted.contactId === null) {
      await context.reply("No pude guardar temporalmente el documento. Intenta enviarlo nuevamente.");
      return;
    }
    if (billing.documentKey) await context.documentStore.delete(billing.documentKey);
    const key = `enterprise/${context.tenant.tenantId}/${state.facturayaTenantId || "unselected"}/${context.persisted.contactId}/${crypto.randomUUID()}-${context.document.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120)}`;
    if (!(await context.documentStore.put(key, context.document))) {
      await context.reply("No pude guardar el documento para procesarlo. Intenta nuevamente.");
      return;
    }
    billing = { ...billing, documentKey: key, documentFilename: context.document.filename };
  }

  if (missingBillingFields(billing, kind).length > 0) {
    await saveState(context, touch({ ...state, billing }));
    await replyBillingProgress(context, billing, kind);
    return;
  }

  const document = billing.documentKey && context.documentStore
    ? await context.documentStore.get(billing.documentKey)
    : null;
  const result = await client.importInvoiceDraft({
    ...documentContract(kind, billing),
    issueDate: billing.issueDate,
    taxMode: billing.taxMode,
    productsText: billing.productsText || undefined,
    document: document || context.document,
  });
  if (!result.ok) {
    await context.reply(facturayaFailure(result));
    return;
  }

  if (draftMissingPricing(result.data)) {
    const incompleteBilling: BillingState = {
      ...billing,
      draftId: undefined,
      productsReady: false,
      missingProductFields: ["unit_price_or_total"],
    };
    await saveState(context, touch({ ...state, billing: incompleteBilling }));
    context.log("whatsapp_facturaya_incomplete_draft_blocked", {
      reason: "missing_positive_price",
      documentType: documentContract(kind, billing).documentType,
    });
    await context.reply("Conservé los productos, pero FacturaYa no pudo determinar un importe válido. Ahora me falta este dato: costo total o precio unitario.");
    return;
  }

  const next = touch({ ...state, billing: { ...billing, draftId: result.data.id, documentKey: undefined } });
  if (billing.documentKey && context.documentStore) await context.documentStore.delete(billing.documentKey);
  await saveState(context, next);
  await replyDraft(context, result.data, kind);
}

async function handleFinance(context: RoleHandlerContext): Promise<void> {
  const financeRole = new FinanceRoleHandler();
  const configured = financeRole.configure(context.tenant);
  await financeRole.handle({
    ...context,
    tenant: {
      ...configured,
      aiProvider: context.tenant.aiProvider,
      aiModel: context.tenant.aiModel,
      temperature: context.tenant.temperature,
      maxTokens: context.tenant.maxTokens,
    },
  });
}

export class EnterpriseAdvisorRoleHandler implements RoleHandler {
  readonly key = ENTERPRISE_ADVISOR_ROLE_KEY;

  configure(tenant: TenantContext): TenantContext {
    return {
      ...tenant,
      roleKey: ENTERPRISE_ADVISOR_ROLE_KEY,
      temperature: 0.2,
      maxTokens: Math.max(tenant.maxTokens, 1_800),
      systemPrompt: "Eres el asesor empresarial serio de la empresa. Ayudas con finanzas y comprobantes electrónicos peruanos. Sé preciso, claro y prudente; nunca inventes datos tributarios ni confirmes una emisión sin respuesta de FacturaYa/SUNAT.",
    };
  }

  async handle(context: RoleHandlerContext): Promise<void> {
    let state = await getState(context);
    if (isSessionResetCommand(context.message.text)) {
      await clearState(context, state);
      state = newSession();
      await saveState(context, state);
      await showModeMenu(context, "Sesión reiniciada. ¿Qué deseas hacer ahora?");
      return;
    }

    if (!state) {
      state = newSession();
      await saveState(context, state);
      await showModeMenu(context);
      return;
    }

    state = touch(state);
    if (context.message.interactionId === FINANCE_BUTTON_ID) {
      await deleteStoredDocument(context, state);
      state = {
        ...state,
        mode: "finance",
        facturayaTenantId: null,
        billingDocumentKind: null,
        billing: undefined,
      };
      await saveState(context, state);
      await context.reply("Finanzas activadas. Puedes registrar entradas, salidas o consultar tu balance durante los próximos 20 minutos.");
      return;
    }
    if (context.message.interactionId === BILLING_BUTTON_ID) {
      await deleteStoredDocument(context, state);
      const access = await ensureFacturayaTenant(context);
      state = {
        ...state,
        mode: "billing",
        facturayaTenantId: access?.tenant.id ?? null,
        billingDocumentKind: null,
        billing: undefined,
      };
      await saveState(context, state);
      if (!access) return;
      await showBillingDocumentMenu(context);
      return;
    }

    if (
      state.mode === "billing"
      && (
        selectedCompanyId(context.message.interactionId)
        || isChangeCompanyRequest(context.message.interactionId, context.message.text)
      )
    ) {
      const access = await ensureFacturayaTenant(context);
      if (!access) return;
      await deleteStoredDocument(context, state);
      state = {
        ...state,
        facturayaTenantId: access.tenant.id,
        billingDocumentKind: null,
        billing: undefined,
      };
      await saveState(context, state);
      await showBillingDocumentMenu(
        context,
        `Empresa activa: ${access.tenant.legalName || access.tenant.name}. ¿Qué comprobante deseas crear?`,
      );
      return;
    }

    const selectedBillingDocument = billingDocumentKindFromMessage(
      context.message.interactionId,
      context.message.text,
    );
    if (selectedBillingDocument && state.mode !== "finance") {
      const access = await ensureFacturayaTenant(context);
      if (!access) return;
      await deleteStoredDocument(context, state);
      state = {
        ...state,
        mode: "billing",
        facturayaTenantId: access.tenant.id,
        billingDocumentKind: selectedBillingDocument,
        billing: undefined,
      };
      await saveState(context, state);
      await context.reply(billingActivationMessage(selectedBillingDocument));
      return;
    }
    if (!state.mode) {
      await saveState(context, state);
      await showModeMenu(context, "Elige una opción para comenzar:");
      return;
    }

    if (state.mode === "finance") {
      await saveState(context, state);
      await handleFinance({ ...context, history: context.history });
      return;
    }

    if (!state.billingDocumentKind) {
      const access = await ensureFacturayaTenant(context);
      if (!access) return;
      state = { ...state, facturayaTenantId: access.tenant.id };
      await saveState(context, state);
      await showBillingDocumentMenu(context, "Elige el tipo de comprobante para continuar:");
      return;
    }

    const access = await ensureFacturayaTenant(context);
    if (!access) return;
    if (state.facturayaTenantId && state.facturayaTenantId !== access.tenant.id) {
      await deleteStoredDocument(context, state);
      state = {
        ...state,
        facturayaTenantId: access.tenant.id,
        billingDocumentKind: null,
        billing: undefined,
      };
      await saveState(context, state);
      await showBillingDocumentMenu(
        context,
        `La empresa activa cambió a ${access.tenant.legalName || access.tenant.name}. Descarté el borrador temporal anterior para mantener los datos separados. ¿Qué comprobante deseas crear?`,
      );
      return;
    }
    state = { ...state, facturayaTenantId: access.tenant.id };
    await saveState(context, state);
    await handleBilling(context, state);
  }
}
