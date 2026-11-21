import type { ParsedSupplierRow, SuppliersSpreadsheetParseResult } from "../../reorder/bridge-contracts";
import { normalizePhone } from "../../reorder/extractor";
import { matchColumn, readSpreadsheetRows, SpreadsheetError } from "../stock/spreadsheet";

export { SpreadsheetError };

const NAME_HEADERS = new Set([
  "proveedor", "proveedores", "nombre", "empresa", "razon social", "supplier", "vendor",
]);
const PHONE_HEADERS = new Set([
  "telefono", "celular", "whatsapp", "wsp", "numero", "cel", "tel", "phone", "movil",
]);
const RUC_HEADERS = new Set(["ruc"]);
const ITEMS_HEADERS = new Set([
  "producto", "productos", "item", "items", "insumo", "insumos", "articulo", "articulos", "compra", "compras", "productos que vende",
]);
const DELIVERY_HEADERS = new Set([
  "dias de entrega", "dia de entrega", "entrega", "dias", "plazo", "plazo de entrega", "tiempo de entrega", "lead days", "delivery days",
]);

function splitItems(raw: unknown): string[] {
  const text = String(raw ?? "").trim();
  if (!text) return [];
  return text
    .split(/[,;\n]+/)
    .map((part) => part.trim().replace(/\s+/g, " ").slice(0, 200))
    .filter(Boolean);
}

export async function parseSuppliersSpreadsheet(input: {
  filename: string;
  mimeType?: string;
  dataBase64: string;
  knownItems?: ReadonlyMap<string, string>;
}): Promise<SuppliersSpreadsheetParseResult> {
  const read = await readSpreadsheetRows(input);
  if (read.status === "empty") return { status: "empty" };

  const { rawHeaders, headers, dataRows } = read;
  const nameIdx = matchColumn(headers, NAME_HEADERS);
  const phoneIdx = matchColumn(headers, PHONE_HEADERS);
  const rucIdx = matchColumn(headers, RUC_HEADERS);
  const itemsIdx = matchColumn(headers, ITEMS_HEADERS);
  const deliveryIdx = matchColumn(headers, DELIVERY_HEADERS);

  if (nameIdx === -1 || phoneIdx === -1) {
    return {
      status: "unknown_columns",
      headers: rawHeaders.filter(Boolean).slice(0, 12),
      sampleRows: dataRows.slice(0, 3).map((r) => r.map((c) => String(c ?? "").trim()).slice(0, 12)),
    };
  }

  const byPhone = new Map<string, ParsedSupplierRow>();
  const itemKeysByPhone = new Map<string, Set<string>>();
  const doubtful: string[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const rowNum = i + 2;
    const name = String(row[nameIdx] ?? "").trim().replace(/\s+/g, " ").slice(0, 200);
    const rawPhone = String(row[phoneIdx] ?? "").trim();
    const phone = normalizePhone(rawPhone);

    if (!name) {
      doubtful.push(`Fila ${rowNum}: falta el nombre del proveedor.`);
      continue;
    }
    if (!phone) {
      doubtful.push(`Fila ${rowNum} (${name}): teléfono inválido${rawPhone ? ` «${rawPhone.slice(0, 30)}»` : ""}.`);
      continue;
    }

    const rawRuc = rucIdx !== -1 ? String(row[rucIdx] ?? "").trim() : "";
    const ruc = /^[0-9]{11}$/.test(rawRuc) ? rawRuc : null;
    const rawDelivery = deliveryIdx !== -1 ? String(row[deliveryIdx] ?? "").trim().replace(/\s+/g, " ").slice(0, 100) : "";
    const deliveryDays = rawDelivery || null;

    const rawItems = itemsIdx !== -1 ? splitItems(row[itemsIdx]) : [];
    const validItems: string[] = [];
    for (const item of rawItems) {
      if (input.knownItems) {
        const canonical = input.knownItems.get(item.toLowerCase());
        if (!canonical) {
          doubtful.push(`Fila ${rowNum} (${name}): producto «${item}» no está en el inventario.`);
          continue;
        }
        validItems.push(canonical);
      } else {
        validItems.push(item);
      }
    }

    const existing = byPhone.get(phone);
    if (existing) {
      if (!existing.ruc && ruc) existing.ruc = ruc;
      if (!existing.deliveryDays && deliveryDays) existing.deliveryDays = deliveryDays;
      const seen = itemKeysByPhone.get(phone)!;
      for (const item of validItems) {
        const key = item.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          existing.items.push(item);
        }
      }
    } else {
      const seen = new Set<string>();
      const deduped: string[] = [];
      for (const item of validItems) {
        const key = item.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          deduped.push(item);
        }
      }
      itemKeysByPhone.set(phone, seen);
      byPhone.set(phone, {
        name,
        phone,
        ...(ruc ? { ruc } : {}),
        ...(deliveryDays ? { deliveryDays } : {}),
        items: deduped,
      });
    }
  }

  if (byPhone.size === 0 && doubtful.length === 0) return { status: "empty" };
  return { status: "parsed", suppliers: [...byPhone.values()], doubtful };
}
