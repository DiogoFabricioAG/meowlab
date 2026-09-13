const SMALL_NUMBERS = [
  "cero",
  "uno",
  "dos",
  "tres",
  "cuatro",
  "cinco",
  "seis",
  "siete",
  "ocho",
  "nueve",
  "diez",
  "once",
  "doce",
  "trece",
  "catorce",
  "quince",
  "dieciséis",
  "diecisiete",
  "dieciocho",
  "diecinueve",
] as const;

const TWENTIES = [
  "veinte",
  "veintiuno",
  "veintidós",
  "veintitrés",
  "veinticuatro",
  "veinticinco",
  "veintiséis",
  "veintisiete",
  "veintiocho",
  "veintinueve",
] as const;

const TENS = [
  "",
  "",
  "",
  "treinta",
  "cuarenta",
  "cincuenta",
  "sesenta",
  "setenta",
  "ochenta",
  "noventa",
] as const;

const HUNDREDS = [
  "",
  "ciento",
  "doscientos",
  "trescientos",
  "cuatrocientos",
  "quinientos",
  "seiscientos",
  "setecientos",
  "ochocientos",
  "novecientos",
] as const;

function numberBelowThousandToWords(value: number): string {
  if (value < 20) {
    return SMALL_NUMBERS[value];
  }

  if (value < 30) {
    return TWENTIES[value - 20];
  }

  if (value < 100) {
    const tens = Math.floor(value / 10);
    const units = value % 10;
    return units === 0 ? TENS[tens] : `${TENS[tens]} y ${SMALL_NUMBERS[units]}`;
  }

  if (value === 100) {
    return "cien";
  }

  const hundreds = Math.floor(value / 100);
  const remainder = value % 100;
  return remainder === 0
    ? HUNDREDS[hundreds]
    : `${HUNDREDS[hundreds]} ${numberBelowThousandToWords(remainder)}`;
}

function numberToSpanish(value: number): string {
  if (value < 1_000) {
    return numberBelowThousandToWords(value);
  }

  if (value < 1_000_000) {
    const thousands = Math.floor(value / 1_000);
    const remainder = value % 1_000;
    const thousandsText = thousands === 1
      ? "mil"
      : `${numberBelowThousandToWords(thousands)} mil`;
    return remainder === 0
      ? thousandsText
      : `${thousandsText} ${numberBelowThousandToWords(remainder)}`;
  }

  const millions = Math.floor(value / 1_000_000);
  const remainder = value % 1_000_000;
  const millionsText = millions === 1
    ? "un millón"
    : `${numberToSpanish(millions)} millones`;
  if (remainder === 0) {
    return millionsText;
  }

  return `${millionsText} ${numberToSpanish(remainder)}`;
}

function capitalizeSentence(value: string): string {
  return `${value.charAt(0).toLocaleUpperCase("es-PE")}${value.slice(1)}`;
}

/**
 * Formats a positive amount using the legal-style wording used by the quote
 * template. This is intentionally deterministic: arithmetic and document
 * formatting should not depend on an LLM response.
 */
export function formatAmountInWords(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) {
    return "";
  }

  const totalCents = Math.round(amount * 100);
  const integerPart = Math.floor(totalCents / 100);
  const cents = totalCents % 100;

  return `${capitalizeSentence(numberToSpanish(integerPart))} y ${cents
    .toString()
    .padStart(2, "0")}/100 soles`;
}
