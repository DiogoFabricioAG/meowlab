const RESERVED_CAT_NAMES = new Set([
  "meowlab",
  "sales",
  "salescat",
  "invoice",
  "invoicecat",
  "stock",
  "stockcat",
  "collections",
  "collectionscat",
  "cobranza",
  "reorder",
  "reordercat",
  "support",
  "supportcat",
  "soporte",
  "tender",
  "tendercat",
  "radar",
  "facturaya",
  "manolo",
  "luna",
  "salir",
  "exit",
  "ayuda",
  "help",
]);

const normalizeReserved = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^\/+/, "")
    .replace(/[\s_-]+/g, "");

export type CatNameValidation =
  | { ok: true; name: string }
  | { ok: false; reason: "length" | "link" | "reserved" };

/** Validates a company's custom name for Sales Cat (ADR-0011, decision 2). */
export function validateCatName(raw: string): CatNameValidation {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 20) return { ok: false, reason: "length" };
  if (/https?:\/\/|www\.|[a-z0-9-]+\.[a-z]{2,}|\//i.test(name)) return { ok: false, reason: "link" };
  if (RESERVED_CAT_NAMES.has(normalizeReserved(name))) return { ok: false, reason: "reserved" };
  return { ok: true, name };
}

/** Extracts the leading alias token if a message starts with a word rather than a slash command. */
export function leadingAliasCandidate(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith("/")) return null;
  const match = trimmed.match(/^([^\s,.:;!?]{2,20})(?:[\s,.:;!?]|$)/);
  return match ? match[1] : null;
}

/** Strips a matched custom cat name from the beginning of a chat message. */
export function stripCatAlias(text: string, catName: string | null): string {
  const trimmed = text.trim();
  if (!catName) return trimmed;
  const escaped = catName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return trimmed.replace(new RegExp(`^${escaped}(?:[\\s,.:;!?]+|$)`, "i"), "").trim();
}
