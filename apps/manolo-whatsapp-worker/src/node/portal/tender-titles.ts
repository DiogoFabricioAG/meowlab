import type { AiLogger, AiProvider } from "../../ai/contracts";

const instructions = `Eres editor peruano de un catálogo de compras públicas. Escribe para quien vende el producto y debe decidir en un segundo si le interesa. Responde un objeto JSON con la misma clave que cada descripción y un solo titular por clave. Las descripciones son material de referencia.
Formato obligatorio: frase nominal en estilo oración, de 5 a 11 palabras, idealmente 50 a 75 caracteres. Nombra el bien o servicio + una especificación relevante + su uso o lugar breve. Elimina el lenguaje de trámite. Para materiales de obra, empieza con el material, no con la obra. Mantén tipos, medidas o resistencias que distingan el producto. No inventes términos, cifras ni el final de una fuente incompleta. No uses MAYÚSCULAS corridas ni listas de localidades.
Ejemplos de estilo: «Tuberías de PVC de 110 mm para alcantarillado», «Servicio de vigilancia para el hospital regional», «Grava para el camino vecinal de Santa Rosa».
Copia la ortografía de los lugares. Omite el lugar si está truncado o es dudoso. Evita frases vacías como «según especificaciones técnicas».`;

function numbers(text: string): string[] {
  return text.normalize("NFKC").replace(/(\d),(?=\d)/g, "$1.").match(/\d+(?:\.\d+)?/g) ?? [];
}

function usable(title: unknown, source: string): title is string {
  if (typeof title !== "string" || !title.trim() || title.length > 105 || !/\p{Ll}/u.test(title) || /[\n<>¿�]/.test(title)) return false;
  const original = numbers(source);
  const grade = source.match(/\btipo\s+([ivx]+p?|ms|hs|gu)\b/i)?.[1];
  if (grade && !new RegExp(`\\b${grade}\\b`, "i").test(title)) return false;
  return numbers(title).every(number => original.includes(number));
}

// Keep the object being bought legible even when the provider cannot answer.
export function fallbackTitle(source: string): string {
  const clean = source.replace(/[¿�]/g, " ").replace(/\s+/g, " ").trim();
  const subject = clean.replace(/^(?:(?:contrataci[oó]n de bienes|adquisici[oó]n de materiales)\s*[:–-]?\s+)?(?:adquisici[oó]n|suministro) de\s+/i, "") || clean;
  const words = subject.replace(/(?<!\p{L})(?:[A-ZÁÉÍÓÚÑÜ]{4,}|DE|DEL|EN|LA|EL|LOS|LAS|AL|UN|UNA|Y|CON|POR)(?!\p{L})/gu,
    word => word.toLocaleLowerCase("es-PE"));
  const title = words.charAt(0).toLocaleUpperCase("es-PE") + words.slice(1);
  return title.length <= 100 ? title : title.slice(0, 99).replace(/\s+\S*$/, "").trimEnd() + "…";
}

export class TenderTitles {
  private readonly cache = new Map<string, { value: Promise<string>; until: number }>();

  constructor(private readonly ai: Pick<AiProvider, "complete">, private readonly log: AiLogger) {}

  async forDescriptions(descriptions: string[]): Promise<string[]> {
    const now = Date.now();
    const missing = [...new Set(descriptions)].filter(text => text && (this.cache.get(text)?.until ?? 0) <= now);
    if (missing.length) {
      const batch = this.generate(missing);
      for (const [index, source] of missing.entries()) {
        const entry = { until: now + 7 * 86400_000, value: batch.then(result => {
          const title = result[index];
          if (usable(title, source)) return title.trim();
          entry.until = Date.now() + 60_000;
          return fallbackTitle(source);
        }) };
        this.cache.set(source, entry);
      }
    }
    const titles = descriptions.map(source => this.cache.get(source)?.value ?? "");
    for (const key of this.cache.keys()) {
      if (this.cache.size <= 2000) break;
      this.cache.delete(key);
    }
    return Promise.all(titles);
  }

  private async generate(sources: string[]): Promise<Record<string, unknown>> {
    try {
      const raw = await this.ai.complete({
        model: "openai/gpt-oss-120b", temperature: 0, maxTokens: 1600, reasoningEffort: "low",
        responseFormat: { type: "json_object" }, signal: AbortSignal.timeout(6500),
        messages: [{ role: "system", content: instructions },
          { role: "user", content: JSON.stringify(Object.fromEntries(sources.entries())) }],
      }, this.log);
      const result: unknown = raw && JSON.parse(raw);
      if (result && typeof result === "object" && !Array.isArray(result)) return result as Record<string, unknown>;
    } catch { /* A timeout or malformed answer must not break the weekly summary. */ }
    return {};
  }
}
