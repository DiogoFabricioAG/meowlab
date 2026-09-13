import { describe, expect, it } from "vitest";
import { formatAmountInWords } from "../src/quotes/amount-in-words";
import {
  calculateQuoteTotals,
  formatQuoteDescription,
  renderQuoteHtml,
} from "../src/quotes/template";
import type { QuoteConfig, QuoteDraft } from "../src/quotes/types";

const config: QuoteConfig = {
  legalName: "Empresa de prueba",
  taxId: "20123456789",
  address: "Lima",
  services: ["Decoración"],
  bankName: "BCP",
  bankAccount: "123456789",
  bankCci: "987654321",
  advisorName: "Asesor",
  advisorPhone: "999999999",
  currency: "PEN",
  taxRate: 0.18,
  pricesIncludeTax: true,
  validDays: 15,
  logoUrl: null,
};

const draft: QuoteDraft = {
  id: "draft-1",
  tenantId: "tenant-1",
  contactId: 1,
  status: "confirmed",
  sequenceScopeId: null,
  quoteNumber: "COT-0001",
  customerName: "Cliente de prueba",
  customerTaxId: "12345678",
  customerPhone: "999999999",
  issuedAt: "2026-07-24T00:00:00.000Z",
  expiresAt: "2026-08-08T00:00:00.000Z",
  importeLetras: "",
  items: [
    { position: 1, description: "celular", quantity: 1, unitPrice: 50 },
    {
      position: 2,
      description: "auriculares bluetooth",
      quantity: 2,
      unitPrice: 100,
    },
    {
      position: 3,
      description: "servicio de transporte",
      quantity: 1,
      unitPrice: 500,
    },
  ],
};

describe("quote presentation", () => {
  it("capitalizes product descriptions while preserving Spanish connectors", () => {
    expect(formatQuoteDescription("celular")).toBe("Celular");
    expect(formatQuoteDescription("auriculares bluetooth")).toBe(
      "Auriculares Bluetooth",
    );
    expect(formatQuoteDescription("servicio de transporte")).toBe(
      "Servicio de Transporte",
    );
  });

  it("converts amounts to legal-style Spanish wording without an LLM", () => {
    expect(formatAmountInWords(750)).toBe(
      "Setecientos cincuenta y 00/100 soles",
    );
    expect(formatAmountInWords(1_234.56)).toBe(
      "Mil doscientos treinta y cuatro y 56/100 soles",
    );
  });

  it("renders capitalized descriptions and the amount in letters", () => {
    const html = renderQuoteHtml(config, draft);

    expect(html).toContain(">Celular<");
    expect(html).toContain(">Auriculares Bluetooth<");
    expect(html).toContain(">Servicio de Transporte<");
    expect(html).toContain("Setecientos cincuenta y 00/100 soles");
    expect(html).not.toContain("_________________________________");
  });

  it("separates included IGV from the total and rounds to two decimals", () => {
    const totals = calculateQuoteTotals(draft, config);

    expect(totals.total).toBe(750);
    expect(totals.tax).toBe(114.41);
    expect(totals.subtotal).toBe(635.59);
  });

  it("preserves two decimal places in fractional totals", () => {
    const fractionalDraft: QuoteDraft = {
      ...draft,
      items: [
        { position: 1, description: "Servicio", quantity: 1, unitPrice: 10.11 },
      ],
    };
    const totals = calculateQuoteTotals(fractionalDraft, config);

    expect(totals.total).toBe(10.11);
    expect(totals.tax).toBe(1.54);
    expect(totals.subtotal).toBe(8.57);
  });
});
