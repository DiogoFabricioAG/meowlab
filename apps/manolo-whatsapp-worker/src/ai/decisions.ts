import type { AiLogger, AiProvider } from "./contracts";

export async function isElaborateUserRequest(
  ai: AiProvider | null | undefined,
  model: string,
  text: string,
  log: AiLogger,
): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed) return false;

  if (ai?.decide) {
    const result = await ai.decide(
      {
        model: model || "gpt-6-luna",
        input: trimmed,
        questions: [
          {
            type: "choice",
            name: "request_nature",
            instructions:
              "Clasifica el mensaje del usuario en una de dos categorías. Devuelve 'elaborate_request' si el usuario formula una pregunta elaborada, consulta específica o con requerimientos detallados (por ejemplo: 'Me puedes mostrar las facturas que hice esta ultima semana', consultar historial, balances, o dar detalles comerciales de un comprobante). Devuelve 'greeting_or_ambiguous' si el mensaje es un saludo, una frase corta, un inicio de conversación o una consulta ambigua/simple que requiere botones interactivos para guiar al usuario.",
            choices: ["greeting_or_ambiguous", "elaborate_request"],
          },
        ],
      },
      log,
    );

    const choiceAnswer = result?.answers.find((a) => a.name === "request_nature" && a.type === "choice");
    if (choiceAnswer && choiceAnswer.type === "choice") {
      log("whatsapp_decisions_evaluated", {
        choice: choiceAnswer.choice,
        confidence: choiceAnswer.confidence,
      });
      return choiceAnswer.choice === "elaborate_request";
    }

    const predicateAnswer = result?.answers.find((a) => a.type === "predicate");
    if (predicateAnswer && predicateAnswer.type === "predicate") {
      log("whatsapp_decisions_evaluated", {
        probability: predicateAnswer.probability,
      });
      return predicateAnswer.probability >= 0.5;
    }
  }

  return isElaborateRequestFallback(trimmed);
}

export function isElaborateRequestFallback(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  // Short greetings, start commands, or ambiguous phrases
  if (
    /^(?:hola|buenas|buenos d[ií]as|buenas tardes|buenas noches|ola|empezar|inicio|menu|menú|ayuda|opciones|manolo)\b/iu.test(
      trimmed,
    ) &&
    trimmed.length < 35
  ) {
    return false;
  }

  // Very short text without domain terms or numbers
  if (trimmed.length < 15 && !/\d{8,11}/.test(trimmed)) {
    return false;
  }

  // Detailed requests (invoices, time frames, reports, etc.)
  if (
    /\b(?:facturas?|boletas?|semana|mes|historial|mostrar|listar|reporte|ayer|hoy|anular|ruc|dni)\b/iu.test(
      trimmed,
    )
  ) {
    return true;
  }

  return trimmed.split(/\s+/).length >= 5;
}
