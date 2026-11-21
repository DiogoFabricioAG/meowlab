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

export const SALES_ALIAS_CACHE_KEY = "sales:aliases";
export const SALES_ALIAS_CACHE_TTL_MS = 5 * 60_000;

/** Strips a matched custom cat name from the beginning of a chat message. */
export function stripCatAlias(text: string, catName: string | null): string {
  const trimmed = text.trim();
  if (!catName) return trimmed;
  const escaped = catName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return trimmed.replace(new RegExp(`^${escaped}(?:[\\s,.:;!?]+|$)`, "i"), "").trim();
}

export function parseSalesAliasCache(json: string | null, now = Date.now()): string[] | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as { v?: unknown; expiresAt?: unknown; aliases?: unknown };
    if (parsed?.v !== 1 || typeof parsed.expiresAt !== "number" || parsed.expiresAt <= now || !Array.isArray(parsed.aliases)) {
      return null;
    }
    return parsed.aliases.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  } catch {
    return null;
  }
}

export function serializeSalesAliasCache(aliases: readonly string[], now = Date.now()): string {
  const unique = [...new Set(aliases.map((a) => a.trim().toLowerCase()).filter(Boolean))];
  return JSON.stringify({ v: 1, expiresAt: now + SALES_ALIAS_CACHE_TTL_MS, aliases: unique });
}

export function matchesSalesAlias(text: string, aliases: readonly string[]): boolean {
  const candidate = leadingAliasCandidate(text)?.toLowerCase();
  if (!candidate || !aliases.length) return false;
  return aliases.some((alias) => alias.trim().toLowerCase() === candidate);
}
