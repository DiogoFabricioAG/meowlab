export type PaymentMethod = "contado" | "credito";
export type PaymentInstallment = { due_date: string; amount: string };
export type PaymentSelection = {
  paymentMethod?: PaymentMethod | null;
  outstandingAmount?: string | null;
  installments?: PaymentInstallment[];
  paymentError?: string;
};

// Decimal arithmetic is performed in cents, never with rounded floating point sums.
export function amountInCents(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{1,12}(?:\.\d{1,2})?$/.test(value)) return null;
  const [units, fraction = ""] = value.split(".");
  const cents = Number(units) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function decimalAmount(value: unknown): string | null {
  const cents = amountInCents(value);
  return cents === null ? null : `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function isFullDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseInstallments(value: unknown): PaymentInstallment[] | null {
  if (!Array.isArray(value) || value.length > 12) return null;
  const result: PaymentInstallment[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const { due_date, amount } = item as Record<string, unknown>;
    const normalized = decimalAmount(amount);
    if (!isFullDate(due_date) || normalized === null || amountInCents(normalized)! <= 0) return null;
    result.push({ due_date, amount: normalized });
  }
  return result;
}

export function paymentProblems(
  payment: PaymentSelection, documentType: "01" | "03", issueDate: string, total?: unknown,
): string[] {
  if (payment.paymentError) return [payment.paymentError];
  if (!payment.paymentMethod) return documentType === "01" ? ["la condición de pago: ¿contado o crédito?"] : [];
  if (payment.paymentMethod === "contado") {
    return payment.outstandingAmount != null || (payment.installments?.length ?? 0) > 0
      ? ["para contado, el saldo debe ser nulo y no debe haber cuotas"] : [];
  }
  if (documentType !== "01") return ["el crédito sólo está disponible para facturas; la boleta debe ser al contado"];
  const saldo = amountInCents(payment.outstandingAmount);
  const installments = parseInstallments(payment.installments);
  const problems: string[] = [];
  if (!isFullDate(issueDate)) problems.push("una fecha de emisión válida para verificar los vencimientos");
  if (saldo === null || saldo <= 0) problems.push("el monto pendiente de pago, descontando cualquier anticipo");
  if (!installments?.length) problems.push("las cuotas (máximo 12), cada una con importe y vencimiento completo con año");
  else {
    if (installments.some((item) => item.due_date <= issueDate)) problems.push("vencimientos posteriores a la fecha de emisión");
    if (saldo !== null && installments.reduce((sum, item) => sum + amountInCents(item.amount)!, 0) !== saldo) {
      problems.push("cuotas cuya suma sea exactamente igual al saldo pendiente");
    }
  }
  if (total !== undefined) {
    const totalCents = amountInCents(typeof total === "number" ? String(total) : total);
    if (totalCents === null || totalCents <= 0) problems.push("un total válido del borrador para verificar el crédito");
    else if (saldo !== null && saldo > totalCents) problems.push("un saldo pendiente que no supere el total del comprobante");
  }
  return problems;
}

// An extractor may normalize dates, but may not supply a missing year/day/amount.
export function explicitDates(text: string, referenceDate?: string): Set<string> {
  const dates = new Set<string>();
  for (const match of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) dates.add(match[0]);
  for (const match of text.matchAll(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/g)) {
    dates.add(`${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`);
  }
  const months = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  for (const match of text.toLocaleLowerCase("es").matchAll(/\b(\d{1,2})\s+(?:de\s+)?([a-z]+)\s+(?:de(?:l)?\s+)?(\d{4})\b/g)) {
    const month = months.indexOf(match[2]);
    if (month >= 0) dates.add(`${match[3]}-${String(month + 1).padStart(2, "0")}-${match[1].padStart(2, "0")}`);
  }
  // An explicit relative year is anchored to the current turn, never to an
  // invoice issue date or to a later replay of historical evidence.
  if (isFullDate(referenceDate)) {
    for (const match of text.toLocaleLowerCase("es").matchAll(/\b(\d{1,2})\s+(?:de\s+)?([a-z]+)\s+(?:de\s+)?este\s+año\b/g)) {
      const month = months.indexOf(match[2]);
      const date = `${referenceDate.slice(0, 4)}-${String(month + 1).padStart(2, "0")}-${match[1].padStart(2, "0")}`;
      if (month >= 0 && isFullDate(date)) dates.add(date);
    }
  }
  return dates;
}

export function hasExplicitAmount(text: string, amount: string): boolean {
  const cents = amountInCents(amount);
  if (cents === null) return false;
  const monetaryText = text
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{4})?\b/g, " ")
    .replace(/\b\d{1,2}\s+(?:de\s+)?(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?:\s+(?:de(?:l)?\s+)?\d{4})?\b/giu, " ")
    .replace(/\b(?:dni|ruc)\s*[:#-]?\s*\d{8,11}\b/giu, " ");
  return [...monetaryText.matchAll(/(?<![\p{L}\d.,])[-+]?\d+(?:[.,]\d+)*(?![\p{L}\d])/gu)]
    .some((match) => {
      if (/^\d{8}$|^\d{11}$/.test(match[0]) && !/\b(?:saldo|importe|monto|total|soles|pen|usd)\b|S\//iu.test(text)) return false;
      const parsed = normalizeUserAmount(match[0]);
      return parsed !== null && amountInCents(parsed) === cents;
    });
}

// User input only: fiscal payloads retain their strict canonical decimal contract.
export function normalizeUserAmount(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  let input = String(value).trim();
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(input)) input = input.replaceAll(",", "");
  else if (/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(input)) input = input.replaceAll(".", "").replace(",", ".");
  else if (/^\d+,\d{1,2}$/.test(input)) input = input.replace(",", ".");
  return decimalAmount(input);
}
