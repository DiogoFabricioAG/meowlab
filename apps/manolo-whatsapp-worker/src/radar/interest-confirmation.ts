import type { RadarAlertContext } from "./presentation";

export type ResolvedBasesSource =
  | { kind: "bases"; title: string; url: string }
  | { kind: "ficha"; url: string; code: string; ambiguous: boolean }
  | { kind: "search"; url: string; code: string }
  | { kind: "none" };

const SEACE_FICHA_RE = /^https:\/\/prod4\.seace\.gob\.pe\/openegocio\/#\/ficha\/idProceso\/tipo\/\d+\/2$/;
const OECE_PROCESS_RE = /^https:\/\/contratacionesabiertas\.oece\.gob\.pe\/proceso\/.+$/;
const NON_BASES_TITLE_RE = /\b(?:absolucion|consultas|observaciones)\b/iu;

function normalizeTitle(title: string): string {
  return title.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es").replace(/\s+/gu, " ").trim();
}

function cleanInline(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f*_~`]/gu, "").replace(/\s+/gu, " ").trim().slice(0, max);
}

/**
 * Resolve the official bases link for a specific alert delivery.
 * Falls back to the official SEACE/OECE process ficha when bases are missing or ambiguous,
 * or to the official searcher if only a generic search URL is available.
 */
export function resolveOfficialBasesSource(context: RadarAlertContext | null): ResolvedBasesSource {
  if (!context) return { kind: "none" };
  const docs = context.evidence?.documents ?? [];
  const candidateBases = docs.filter((doc) => {
    const normalized = normalizeTitle(doc.title);
    return /\bbases\b/iu.test(normalized) && !NON_BASES_TITLE_RE.test(normalized);
  });
  const integrated = candidateBases.filter((doc) => /\bbases integradas\b/iu.test(normalizeTitle(doc.title)));

  if (integrated.length === 1) {
    return { kind: "bases", title: integrated[0]!.title.trim(), url: integrated[0]!.url };
  }
  if (integrated.length === 0 && candidateBases.length === 1) {
    return { kind: "bases", title: candidateBases[0]!.title.trim(), url: candidateBases[0]!.url };
  }

  const ambiguous = integrated.length > 1 || (integrated.length === 0 && candidateBases.length > 1);
  const code = cleanInline(context.alert.code, 120);
  if (context.evidence?.sourceUrl) {
    return { kind: "ficha", url: context.evidence.sourceUrl, code, ambiguous };
  }

  const alertUrl = context.alert.sourceUrl;
  if (SEACE_FICHA_RE.test(alertUrl) || OECE_PROCESS_RE.test(alertUrl)) {
    return { kind: "ficha", url: alertUrl, code, ambiguous };
  }
  return { kind: "search", url: alertUrl, code };
}

/**
 * Build the confirmation reply after persisting «Me interesa».
 * Uses only verified official labels and URLs, never promising operational analysis or reception.
 */
export function buildInterestConfirmation(context: RadarAlertContext | null): string {
  const code = context ? cleanInline(context.alert.code, 120) : "";
  const opening = code
    ? `¡Listo! Guardé ${code} como de tu interés.`
    : "¡Listo! Guardé esta oportunidad como de tu interés.";
  const source = resolveOfficialBasesSource(context);

  if (source.kind === "bases") {
    return [
      opening,
      `${source.title}:\n${source.url}`,
      "Cuando descargues el documento, compártelo por este mismo chat.",
    ].join("\n\n");
  }
  if (source.kind === "ficha") {
    const guidance = source.ambiguous
      ? "Hay más de un archivo de bases en el aviso; entra a la ficha oficial para ubicar y descargar el documento correcto, y compártelo por este mismo chat."
      : "Entra a la ficha oficial para ubicar y descargar las bases, y compártelo por este mismo chat.";
    return [
      opening,
      `Ficha oficial${source.code ? ` (${source.code})` : ""}:\n${source.url}`,
      guidance,
    ].join("\n\n");
  }
  if (source.kind === "search") {
    return [
      opening,
      `Buscador oficial SEACE${source.code ? ` (busca ${source.code})` : ""}:\n${source.url}`,
      "Ubica la convocatoria para descargar las bases y comparte ese documento por este mismo chat.",
    ].join("\n\n");
  }
  return [
    opening,
    "Si ya tienes el documento de las bases de esta convocatoria, compártelo por este mismo chat.",
  ].join("\n\n");
}
