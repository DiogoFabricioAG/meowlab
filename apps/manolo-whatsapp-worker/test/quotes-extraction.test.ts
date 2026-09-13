import { describe, expect, it } from "vitest";
import {
  extractQuoteFactsFromText,
  normalizeQuoteExtraction,
} from "../src/quotes/extraction";

describe("quote extraction safeguards", () => {
  it("extracts multiple explicit products and preserves unit prices", () => {
    const extraction = extractQuoteFactsFromText(
      "Necesito una cotización.\n" +
        "Tela 15m, 2 unidades a 10 soles cada una\n" +
        "Agrega 2 floreros a 40 soles cada uno",
    );

    expect(extraction.items).toEqual([
      { description: "Tela 15m", quantity: 2, unitPrice: 10 },
      { description: "floreros", quantity: 2, unitPrice: 40 },
    ]);
  });

  it("uses the referenced product instead of treating unidades as a product", () => {
    const extraction = extractQuoteFactsFromText(
      "Falta el 2do producto, el de la tela de 15m, compré 2 unidades y me salió por completo unos 5 soles",
    );

    expect(extraction.items).toEqual([
      { description: "tela 15m", quantity: 2, unitPrice: 2.5 },
    ]);
  });

  it("discards generic model items", () => {
    const extraction = normalizeQuoteExtraction({
      items: [
        { description: "unidades", quantity: 2, unitPrice: 2.5 },
        { description: "tela 15m", quantity: 2, unitPrice: 2.5 },
      ],
      customer: {},
      assistantMessage: "",
      readyToConfirm: false,
    });

    expect(extraction?.items).toEqual([
      { description: "tela 15m", quantity: 2, unitPrice: 2.5 },
    ]);
  });
});
