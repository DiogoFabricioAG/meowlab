import type { RadarAlert } from "./contracts";
import type { RadarEvidence } from "./evidence";

export const EDITORIAL_ALERT_HEADING = "*Una compra para revisar*";

export interface RadarAlertWriter {
  draft(alert: RadarAlert, evidence?: RadarEvidence): Promise<string | null>;
}

export type RadarAlertContext = {
  deliveryId?: string;
  evidence?: import("./evidence").RadarEvidence;
  alert: RadarAlert;
  sentAt: number;
  expiresAt: number;
};

const plain = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es").replace(/\s+/gu, " ").trim();
const words = (value: string) => plain(value).match(/[a-zñ]{4,}/gu) ?? [];
const general = new Set(words("adquisicion adquisiciones compra compras contratacion suministro servicio servicios proyecto proyectos mejoramiento proveedores proveedor necesita necesitan busca buscan requiere requieren solicita solicitan entidad nacional regional distrital para este esta estos estas mediante como sobre correspondiente destinado destinada"));
function sharesSubject(text: string, source: string): boolean {
  const terms = words(source).filter(word => !general.has(word));
  return words(text).some(word => !general.has(word) && terms.some(term =>
    term === word || term + "s" === word || term + "es" === word || word + "s" === term || word + "es" === term));
}

export function safeAlertDraft(value: unknown, alert?: RadarAlert, evidence?: RadarEvidence): string | null {
  if (typeof value !== "string") return null;
  const paragraphs = value.trim().split(/\n\s*\n/u).map(p => p.replace(/\s+/gu, " ").trim());
  if (paragraphs.length > 2 || paragraphs.some(p => !p || p.length > 180)) return null;
  const text = paragraphs.join("\n\n");
  // Dates, amounts, URLs and qualification claims are never delegated to a draft.
  if (text.length < 15 || text.length > 360 || /[\u0000-\u0009\u000b-\u001f*~`<>]|https?:|www\.|OCID|SEACEV3|ACTIVAR|BAJA|\.{3}|…|[A-Z]{2,}-\d/iu.test(text)
    || /rentab|ganancia|margen|garantiz|adjudic|cumples|cumple con|calificas|califica para|exclusiv|asegurad/iu.test(text)) return null;
  const source = `${alert?.description ?? ""} ${evidence?.items.map(i => i.description).join(" ") ?? ""}`;
  // Product designations such as A4 may be preserved verbatim; no generated figures or route codes.
  const numericTokens = text.match(/[\p{L}\p{N}]+(?:[.,/-][\p{L}\p{N}]+)*/gu)?.filter(token => /\d/u.test(token)) ?? [];
  const sourceTokens = new Set(plain(source).match(/[\p{L}\p{N}]+(?:[.,/-][\p{L}\p{N}]+)*/gu) ?? []);
  if (numericTokens.some(token => !/\p{L}/u.test(token) || !sourceTokens.has(plain(token)))) return null;
  if (alert) {
    // Allow natural paraphrases. A buyer name alone is not evidence of what is purchased.
    if (!sharesSubject(paragraphs[0]!, source)) return null;
  }
  return text;
}

/** Quotes ground the two AI-written fields in public evidence; quotes themselves are never displayed. */
export function groundedAlertDraft(value: unknown, alert: RadarAlert, evidence?: RadarEvidence): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 4 || typeof input.what !== "string" || typeof input.objectQuote !== "string"
    || (input.purpose !== null && typeof input.purpose !== "string")
    || (input.purposeQuote !== null && typeof input.purposeQuote !== "string")) return null;
  const sources = [alert.description, ...evidence?.items.map(i => i.description) ?? []].map(plain);
  const quoted = (quote: string, minimum: number) => quote.trim().length >= minimum && quote.length <= 240 && sources.some(source => source.includes(plain(quote)));
  if (!quoted(input.objectQuote, 5) || !sharesSubject(input.what, input.objectQuote)) return null;
  // A plain-language purpose may have no literal vocabulary overlap ("transitabilidad
  // vial" -> "caminos entre localidades"). Require its source quote, not a word whitelist.
  if (input.purpose !== null && (input.purposeQuote === null || !quoted(input.purposeQuote, 8))) return null;
  if (input.purpose === null && input.purposeQuote !== null) return null;
  return safeAlertDraft([input.what, input.purpose].filter(Boolean).join("\n\n"), alert, evidence);
}

export function friendlyAlertText(alert: RadarAlert, draft: string | null, evidence?: import("./evidence").RadarEvidence): string {
  const summary = safeAlertDraft(draft, alert, evidence);
  if (!summary) throw Error("editorial_summary_required");
  const [what, purpose] = summary.split("\n\n");
  const date = Date.parse(alert.deadline);
  const deadline = Number.isFinite(date)
    ? `${evidence?.registrationDeadline && Date.parse(evidence.registrationDeadline) === date ? "Registro de participantes hasta" : "Fecha indicada en el aviso"}: ${new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(date)} (hora de Perú).`
    : "La fecha de cierre está pendiente de confirmar.";
  const money = /^(PEN|USD)\s+(\d+(?:\.\d{1,2})?)$/.exec(alert.amount);
  const amount = money && Number.isFinite(Number(money[2]))
    ? `Monto referencial: ${new Intl.NumberFormat("es-PE", { style: "currency", currency: money[1] }).format(Number(money[2]))}.` : null;
  const entity = alert.buyer.replace(/[*_~`]/gu, "").replace(/\s+/gu, " ").trim().slice(0, 300) || "Entidad por confirmar";
  const render = (includePurpose: boolean) => [EDITORIAL_ALERT_HEADING, `*Entidad*\n${entity}`, `*Qué necesitan*\n${what}`,
    includePurpose && purpose ? `*Para qué*\n${purpose}` : null, deadline, amount,
    "¿Te interesa? Puedes guardarla o abrir el detalle."].filter(Boolean).join("\n\n");
  const full = render(true);
  // Preserve the entity and factual fields; omit optional purpose rather than cutting a sentence.
  return full.length <= 1024 ? full : render(false);
}
