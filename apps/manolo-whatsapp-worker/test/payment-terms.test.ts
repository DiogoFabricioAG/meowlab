import { describe, expect, it } from "vitest";
import { amountInCents, decimalAmount, explicitDates, hasExplicitAmount, isFullDate, normalizeUserAmount, parseInstallments, paymentProblems } from "../src/facturaya/payment-terms";

const credit = { paymentMethod: "credito" as const, outstandingAmount: "0.30",
  installments: [{ due_date: "2026-12-05", amount: "0.10" }, { due_date: "2026-12-10", amount: "0.20" }] };

describe("payment terms", () => {
  it.each([["12,630", "12630.00"], ["12,630.50", "12630.50"], ["12.630,50", "12630.50"],
    ["12630,50", "12630.50"], [12630, "12630.00"]])("normalizes user amount %s without relaxing fiscal decimals", (input, expected) => {
    expect(normalizeUserAmount(input)).toBe(expected);
    if (typeof input === "string") expect(hasExplicitAmount(`${input} soles`, String(expected))).toBe(true);
  });
  it.each(["12.630", "12,63,0", "-12,630", "1.0000", "1e3", "Infinity"])("rejects ambiguous or invalid user amount %s", (input) => {
    expect(normalizeUserAmount(input)).toBeNull();
    expect(hasExplicitAmount(`${input} soles`, "12630.00")).toBe(false);
  });
  it("anchors an explicit relative year to the turn date and never invents an omitted year", () => {
    expect([...explicitDates("6 de diciembre de este año", "2026-11-06")]).toEqual(["2026-12-06"]);
    expect([...explicitDates("6 de diciembre de este año", "2027-01-01")]).toEqual(["2027-12-06"]);
    expect([...explicitDates("6 de diciembre", "2026-11-06")]).toEqual([]);
    expect([...explicitDates("6 de diciembre de este año")]).toEqual([]);
    expect([...explicitDates("31 de febrero de este año", "2026-11-06")]).toEqual([]);
  });
  it("adds exact cents and accepts a balance below the total after an advance", () => {
    expect(paymentProblems(credit, "01", "2026-11-05", "1.00")).toEqual([]);
    expect(amountInCents("0.10")! + amountInCents("0.20")!).toBe(30);
    expect(decimalAmount("123")).toBe("123.00");
  });
  it("recognizes explicit amounts next to punctuation without accepting partial numbers", () => {
    expect(hasExplicitAmount("saldo 100.00, vence luego.", "100.00")).toBe(true);
    expect(hasExplicitAmount("cuota 100,00.", "100.00")).toBe(true);
    expect(hasExplicitAmount("saldo 1,000.00", "1000.00")).toBe(true);
    expect(hasExplicitAmount("saldo -100.00", "100.00")).toBe(false);
    expect(hasExplicitAmount("saldo 100.001", "100.00")).toBe(false);
  });
  it("does not treat a due date or a customer identifier as a monetary amount", () => {
    for (const amount of ["6.00", "12.00", "2026.00", "20999999999.00"]) {
      expect(hasExplicitAmount("RUC20999999999, un pago el 06 de diciembre del 2026, vence 06/12/2026", amount)).toBe(false);
    }
    expect(hasExplicitAmount("Importe 2026.00, pago el 06 de diciembre del 2026", "2026.00")).toBe(true);
  });
  it.each(["-1.00", "1.001", "1e3", "Infinity", "NaN", "1,000.00", ""]) ("rejects invalid amounts %s", (value) => {
    expect(amountInCents(value)).toBeNull();
  });
  it("requires the condition for invoices and does not demand credit on receipts", () => {
    expect(paymentProblems({}, "01", "2026-11-05").join()).toContain("contado o crédito");
    expect(paymentProblems({}, "03", "2026-11-05")).toEqual([]);
    expect(paymentProblems(credit, "03", "2026-11-05").join()).toContain("sólo");
  });
  it.each([
    { ...credit, outstandingAmount: "0.00" },
    { ...credit, outstandingAmount: "0.31" },
    { ...credit, outstandingAmount: "2.00" },
    { ...credit, installments: [] },
    { ...credit, installments: [{ due_date: "2026-11-05", amount: "0.30" }] },
    { ...credit, installments: [{ due_date: "2026-11-04", amount: "0.30" }] },
    { ...credit, installments: Array.from({ length: 13 }, () => ({ due_date: "2026-12-05", amount: "0.01" })) },
    { ...credit, installments: [{ due_date: "2026-02-30", amount: "0.30" }] },
  ])("blocks inconsistent or incomplete credit %j", (value) => {
    expect(paymentProblems(value, "01", "2026-11-05", "1.00").length).toBeGreaterThan(0);
  });
  it("cash has no balance or installments", () => {
    expect(paymentProblems({ paymentMethod: "contado", outstandingAmount: null, installments: [] }, "01", "2026-11-05")).toEqual([]);
    expect(paymentProblems({ ...credit, paymentMethod: "contado" }, "01", "2026-11-05").length).toBeGreaterThan(0);
  });
  it("never supplies a missing year or an invalid calendar date", () => {
    expect([...explicitDates("vence el 05 diciembre")]).toEqual([]);
    expect([...explicitDates("05 de diciembre de 2027, 06/12/2027, 2027-12-07")].sort())
      .toEqual(["2027-12-05", "2027-12-06", "2027-12-07"]);
    expect(isFullDate("2026-02-29")).toBe(false);
    expect(isFullDate("2028-02-29")).toBe(true);
    expect(parseInstallments([{ due_date: "05 diciembre", amount: "3.00" }])).toBeNull();
  });
});
