import type { QuoteConfig, QuoteDraft } from "./types";
import { formatAmountInWords } from "./amount-in-words";

const LOWERCASE_CONNECTORS = new Set([
  "a",
  "al",
  "con",
  "de",
  "del",
  "e",
  "el",
  "en",
  "la",
  "las",
  "los",
  "para",
  "por",
  "sin",
  "y",
]);

function capitalizeFirstLetter(value: string): string {
  const firstLetter = value.search(/\p{L}/u);
  if (firstLetter < 0) {
    return value;
  }

  return `${value.slice(0, firstLetter)}${value
    .charAt(firstLetter)
    .toLocaleUpperCase("es-PE")}${value.slice(firstLetter + 1)}`;
}

/** Formats product names for the document without changing the stored draft. */
export function formatQuoteDescription(value: string): string {
  return value
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .map((word, index) => {
      const normalizedWord = word.toLocaleLowerCase("es-PE");
      if (index > 0 && LOWERCASE_CONNECTORS.has(normalizedWord)) {
        return normalizedWord;
      }

      return capitalizeFirstLetter(word);
    })
    .join(" ");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function roundToTwoDecimals(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat("es-PE", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("es-PE", {
    timeZone: "America/Lima",
  }).format(date);
}

export function calculateQuoteTotals(draft: QuoteDraft, config: QuoteConfig) {
  const lineTotal = draft.items.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0,
  );
  const baseTotal = roundToTwoDecimals(lineTotal);
  const total = config.pricesIncludeTax
    ? baseTotal
    : roundToTwoDecimals(baseTotal * (1 + config.taxRate));
  const tax = config.pricesIncludeTax
    ? roundToTwoDecimals((total * config.taxRate) / (1 + config.taxRate))
    : roundToTwoDecimals(baseTotal * config.taxRate);
  const subtotal = roundToTwoDecimals(total - tax);

  return { subtotal, tax, total };
}

function renderItems(draft: QuoteDraft, config: QuoteConfig): string {
  if (draft.items.length === 0) {
    return `<tr><td colspan="4" class="empty">Añade productos desde el chat para verlos aquí</td></tr>`;
  }

  return draft.items
    .map(
      (item) => `
        <tr>
          <td>${item.quantity}</td>
          <td>${escapeHtml(formatQuoteDescription(item.description))}</td>
          <td class="number">${formatMoney(item.unitPrice, config.currency)}</td>
          <td class="number amount">${formatMoney(item.quantity * item.unitPrice, config.currency)}</td>
        </tr>`,
    )
    .join("");
}

export function renderQuoteHtml(
  config: QuoteConfig,
  draft: QuoteDraft,
): string {
  const totals = calculateQuoteTotals(draft, config);
  const importeLetras = draft.importeLetras || formatAmountInWords(totals.total);
  const issuedAt = draft.issuedAt ?? new Date().toISOString();
  const expiresAt = draft.expiresAt ?? issuedAt;
  const services = config.services
    .map((service) => `<div>${escapeHtml(service)}</div>`)
    .join("");
  const logo = config.logoUrl
    ? `<img src="${escapeHtml(config.logoUrl)}" alt="Logo" class="logo" />`
    : `<div class="brand">${escapeHtml(config.legalName)}</div>`;

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>Cotización ${escapeHtml(draft.quoteNumber ?? "Borrador")}</title>
    <style>
      @page { size: A4; margin: 10mm; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: #fff;
        color: #111827;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 12px;
      }
      .page {
        width: 100%;
        max-width: 900px;
        margin: 0 auto;
        padding: 32px;
        border: 1px solid #e5e7eb;
        box-shadow: 0 1px 2px rgb(0 0 0 / 0.05);
      }
      .header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 20px;
        flex-wrap: wrap;
        border-bottom: 1px solid #d1d5db;
        padding-bottom: 20px;
        margin-bottom: 32px;
      }
      .company {
        flex: 1 1 300px;
        min-width: 300px;
      }
      .logo {
        display: block;
        width: 100%;
        max-width: 350px;
        height: auto;
        margin-bottom: 8px;
      }
      .brand {
        max-width: 350px;
        margin-bottom: 8px;
        font-size: 24px;
        font-weight: 700;
        letter-spacing: .05em;
      }
      .company-name {
        margin-bottom: 10px;
        font-size: 14px;
        line-height: 1.65;
      }
      .services {
        color: #4b5563;
        font-size: 10px;
        line-height: 1.25;
        margin-top: 4px;
      }
      .address {
        max-width: 560px;
        margin-top: 10px;
        font-size: 14px;
      }
      .customer {
        max-width: 560px;
        margin-top: 16px;
        padding: 12px;
        background: #f9fafb;
        border: 1px solid #f3f4f6;
        border-radius: 4px;
        font-size: 14px;
        line-height: 1.65;
      }
      .meta {
        flex: 0 0 260px;
        min-width: 260px;
      }
      .box {
        overflow: hidden;
        border: 1px solid #111827;
        margin-bottom: 12px;
      }
      .box-row {
        padding: 12px;
        font-size: 14px;
        border-bottom: 1px solid #111827;
      }
      .box-row:last-child { border-bottom: 0; }
      .label {
        display: block;
        margin-bottom: 4px;
        color: #4b5563;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: .08em;
        line-height: 1.1;
        text-transform: uppercase;
      }
      .ruc-label {
        color: #111827;
        font-size: 13px;
      }
      .ruc-value {
        font-size: 24px;
        font-weight: 700;
        line-height: 1.1;
      }
      .quote-label {
        color: #111827;
        font-size: 13px;
      }
      .quote-number {
        color: #111827;
        font-size: 30px;
        font-weight: 700;
        line-height: 1.1;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 32px;
      }
      th, td {
        padding: 12px;
        border: 1px solid #d1d5db;
        text-align: left;
        font-size: 14px;
      }
      th {
        background: #f3f4f6;
        font-weight: 700;
      }
      th:first-child { width: 64px; }
      th:nth-child(3), th:nth-child(4) {
        width: 128px;
        text-align: right;
      }
      .number { text-align: right; }
      .amount { font-weight: 500; }
      .empty {
        padding: 32px;
        color: #9ca3af;
        text-align: center;
        font-style: italic;
      }
      .totals {
        width: 320px;
        margin-left: auto;
        overflow: hidden;
        border: 1px solid #d1d5db;
        border-radius: 4px;
      }
      .total-row {
        display: flex;
        justify-content: space-between;
        padding: 12px;
        border-bottom: 1px solid #d1d5db;
        font-size: 14px;
      }
      .total-row:last-child { border-bottom: 0; }
      .muted { color: #4b5563; }
      .grand-total {
        background: #f9fafb;
        color: #111827;
        font-size: 18px;
        font-weight: 700;
        border-top: 1px solid #d1d5db;
      }
      .letters {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: 12px;
        margin-top: 32px;
        padding: 12px;
        background: #f9fafb;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        font-size: 14px;
      }
      .letters-value {
        color: #4b5563;
        text-transform: uppercase;
      }
      .footer {
        display: grid;
        gap: 8px;
        max-width: 620px;
        margin: 24px auto 0;
        padding: 16px;
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        font-size: 14px;
      }
      .footer-row {
        display: grid;
        grid-template-columns: 180px 1fr;
        gap: 8px;
      }
      .footer-label { color: #374151; font-weight: 700; }
      .account { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
      @media print {
        .page { border: 0; box-shadow: none; }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="header">
        <div class="company">
          ${logo}
          <div class="company-name">
            <strong>“${escapeHtml(config.legalName)}”</strong>
            <div class="services">${services}</div>
          </div>
          <div class="address"><strong>Dirección:</strong> ${escapeHtml(config.address)}</div>
          <div class="customer">
            <div><strong>Cliente:</strong> ${escapeHtml(draft.customerName || "___________________________")}</div>
            <div><strong>DNI/RUC:</strong> ${escapeHtml(draft.customerTaxId || "________________")}</div>
            <div><strong>Teléfono:</strong> ${escapeHtml(draft.customerPhone || "________________")}</div>
          </div>
        </div>

        <div class="meta">
          <div class="box">
            <div class="box-row">
              <strong class="label ruc-label">RUC</strong>
              <div class="ruc-value">${escapeHtml(config.taxId)}</div>
            </div>
            <div class="box-row">
              <strong class="label quote-label">Cotización</strong>
              <div class="quote-number">N° ${escapeHtml(draft.quoteNumber ?? "Borrador")}</div>
            </div>
          </div>

          <div class="box">
            <div class="box-row">
              <strong class="label">Fecha de emisión</strong>
              ${escapeHtml(formatDate(issuedAt))}
            </div>
            <div class="box-row">
              <strong class="label">Fecha de vencimiento</strong>
              ${escapeHtml(formatDate(expiresAt))}
            </div>
          </div>
        </div>
      </section>

      <table>
        <thead>
          <tr>
            <th>Cant.</th>
            <th>Descripción</th>
            <th>P. Unit.</th>
            <th>Importe</th>
          </tr>
        </thead>
        <tbody>${renderItems(draft, config)}</tbody>
      </table>

      <section class="totals">
        <div class="total-row"><span class="muted">Subtotal</span><span>${formatMoney(totals.subtotal, config.currency)}</span></div>
        <div class="total-row"><span class="muted">IGV</span><span>${formatMoney(totals.tax, config.currency)}</span></div>
        <div class="total-row grand-total"><span>Total</span><span>${formatMoney(totals.total, config.currency)}</span></div>
      </section>

      <div class="letters">
        <strong>IMPORTE EN LETRAS:</strong>
        <span class="letters-value">${escapeHtml(importeLetras || "_________________________________")}</span>
      </div>

      <section class="footer">
        <div class="footer-row">
          <span class="footer-label">Cuenta bancaria ${escapeHtml(config.bankName)}:</span>
          <span class="account">${escapeHtml(config.bankAccount)}</span>
        </div>
        <div class="footer-row">
          <span class="footer-label">CCI:</span>
          <span class="account">${escapeHtml(config.bankCci)}</span>
        </div>
        <div class="footer-row">
          <span class="footer-label">Asesor:</span>
          <span>${escapeHtml(config.advisorName)} - ${escapeHtml(config.advisorPhone)}</span>
        </div>
      </section>
    </main>
  </body>
</html>`;
}

export function calculateQuoteTotal(draft: QuoteDraft): number {
  return roundToTwoDecimals(
    draft.items.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice,
      0,
    ),
  );
}
