import readXlsxFile from "read-excel-file/node";
import type { ItemKind, StockLineInput } from "../../stock/bridge-contracts";

export const MAX_SPREADSHEET_BYTES = 2 * 1024 * 1024;
export const MAX_SPREADSHEET_ROWS = 500;

export type SpreadsheetParseResult =
  | { status: "parsed"; lines: StockLineInput[]; skippedRows: number }
  | { status: "unknown_columns"; headers: string[]; sampleRows: string[][] }
  | { status: "empty" };

export class SpreadsheetError extends Error {
  constructor(readonly code: "file_too_large" | "too_many_rows" | "invalid_spreadsheet", readonly details?: unknown) {
    super(code);
  }
}

function normalizeHeader(raw: unknown): string {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.:_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  let cleaned = raw.trim().replace(/^s\/\s*/i, "").replace(/\s+/g, "");
  if (!cleaned) return null;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(cleaned)) {
    cleaned = cleaned.replace(/,/g, "");
  } else if (/^\d+,\d+$/.test(cleaned)) {
    cleaned = cleaned.replace(",", ".");
  } else {
    cleaned = cleaned.replace(/,/g, "");
  }
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseCsvRows(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"' && clean[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field.trim());
      field = "";
    } else if (ch === "\n") {
      row.push(field.trim());
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field.trim());
    if (row.some((cell) => cell !== "")) rows.push(row);
  }
  return rows;
}

const NAME_HEADERS = new Set([
  "producto", "productos", "nombre", "item", "descripcion", "articulo", "articulos", "insumo", "mercaderia",
]);
const QTY_HEADERS = new Set([
  "cantidad", "cant", "stock", "stock inicial", "existencia", "existencias", "unidades", "qty", "inicial",
]);
const COST_HEADERS = new Set([
  "costo", "costo unitario", "p unit", "p unitario", "precio unitario", "precio", "valor unitario", "c u", "cu",
]);
const MIN_HEADERS = new Set([
  "minimo", "stock minimo", "min", "alerta",
]);
const KIND_HEADERS = new Set(["tipo", "categoria"]);

function matchColumn(headers: string[], candidates: Set<string>): number {
  return headers.findIndex((h) => candidates.has(h));
}

export async function parseStockSpreadsheet(input: {
  filename: string;
  mimeType?: string;
  dataBase64: string;
}): Promise<SpreadsheetParseResult> {
  const buffer = Buffer.from(input.dataBase64, "base64");
  if (buffer.byteLength === 0) return { status: "empty" };
  if (buffer.byteLength > MAX_SPREADSHEET_BYTES) {
    throw new SpreadsheetError("file_too_large", { maxBytes: MAX_SPREADSHEET_BYTES, bytes: buffer.byteLength });
  }

  const lowerName = input.filename.toLowerCase();
  const isCsv = lowerName.endsWith(".csv") || input.mimeType?.toLowerCase().includes("csv");
  let rawRows: unknown[][];
  try {
    rawRows = isCsv
      ? parseCsvRows(buffer.toString("utf8"))
      : (await readXlsxFile(buffer)) as unknown as unknown[][];
  } catch {
    throw new SpreadsheetError("invalid_spreadsheet");
  }

  const nonEmptyRows = rawRows.filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""));
  if (nonEmptyRows.length === 0) return { status: "empty" };

  const headerRaw = nonEmptyRows[0].map((c) => String(c ?? "").trim());
  const headers = headerRaw.map(normalizeHeader);
  const nameIdx = matchColumn(headers, NAME_HEADERS);
  const qtyIdx = matchColumn(headers, QTY_HEADERS);
  const costIdx = matchColumn(headers, COST_HEADERS);
  const minIdx = matchColumn(headers, MIN_HEADERS);
  const kindIdx = matchColumn(headers, KIND_HEADERS);

  if (nameIdx === -1 || qtyIdx === -1) {
    return {
      status: "unknown_columns",
      headers: headerRaw.filter(Boolean).slice(0, 12),
      sampleRows: nonEmptyRows.slice(1, 4).map((r) => r.map((c) => String(c ?? "").trim()).slice(0, 12)),
    };
  }

  const dataRows = nonEmptyRows.slice(1);
  if (dataRows.length > MAX_SPREADSHEET_ROWS) {
    throw new SpreadsheetError("too_many_rows", { maxRows: MAX_SPREADSHEET_ROWS, rows: dataRows.length });
  }

  const lines: StockLineInput[] = [];
  let skippedRows = 0;
  for (const row of dataRows) {
    const name = String(row[nameIdx] ?? "").trim().replace(/\s+/g, " ").slice(0, 200);
    const qty = parseNumber(row[qtyIdx]);
    if (!name || qty === null || qty <= 0) {
      skippedRows++;
      continue;
    }
    const cost = costIdx !== -1 ? parseNumber(row[costIdx]) : null;
    const minQty = minIdx !== -1 ? parseNumber(row[minIdx]) : null;
    const rawKind = kindIdx !== -1 ? normalizeHeader(row[kindIdx]) : "";
    const kind: ItemKind | undefined = rawKind === "insumo" || rawKind === "supply"
      ? "supply"
      : rawKind === "producto" || rawKind === "product"
        ? "product"
        : undefined;

    lines.push({
      name,
      quantity: Math.round(qty * 1000) / 1000,
      ...(cost !== null && cost >= 0 ? { unitCostCents: Math.round(cost * 100) } : {}),
      ...(minQty !== null && minQty >= 0 ? { minQty: Math.round(minQty * 1000) / 1000 } : {}),
      ...(kind ? { kind } : {}),
    });
  }

  if (!lines.length) return { status: "empty" };
  return { status: "parsed", lines, skippedRows };
}
