import type { AiLogger, AiProvider } from "./contracts";

export const ENTERPRISE_INTENTS = ["invoice", "receipt", "drafts", "credit_note", "despatch", "other_options",
  "greeting", "continue", "review", "cancel", "finish", "another_action", "conversation", "unknown"] as const;
export type EnterpriseIntent = typeof ENTERPRISE_INTENTS[number];
export type IntentContext = {
  mode: string | null;
  documentKind: "invoice" | "receipt" | null;
  hasCurrentData: boolean;
  completed: boolean;
  awaitingFollowUp: boolean;
};

function greetingOnly(text: string): boolean {
  return /^(?:[¡!¿?.,\s]*(?:hola|ola|manolo|buenas|buenos d[ií]as|buenas tardes|buenas noches|qu[eé] tal|c[oó]mo est[aá]s|est[aá]s funcionando)[!¡¿?.,\s]*)+$/iu.test(text);
}
export function isEnterpriseReviewOnly(text: string): boolean {
  const value = text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[¡!¿?.,]/g, " ").replace(/\s+/g, " ").trim();
  return /^(?:manolo )?(?:por favor )?(?:(?:muestrame|muestra|mostrar|ver|revisa|revisar|ensename|quiero ver|puedes mostrarme|vuelve a mostrarme) )?(?:el )?(?:resumen|detalle|revision)(?: (?:de|del) (?:(?:la|el) )?(?:anulacion|nota de credito|factura|boleta|comprobante))?(?: por favor)?$/.test(value);
}
export function fallbackEnterpriseIntent(text: string, state: IntentContext): EnterpriseIntent {
  const value = text.trim();
  if (!value) return state.hasCurrentData ? "continue" : "unknown";
  if (greetingOnly(value)) return "greeting";
  if (isEnterpriseReviewOnly(value)) return "review";
  if (state.awaitingFollowUp && /^(?:s[ií]|claro|dale|otra(?:\s+acci[oó]n)?)[.!\s]*$/iu.test(value)) return "another_action";
  if ((state.awaitingFollowUp || state.completed) && /^(?:no(?:[,\s]+gracias)?|listo(?:[,\s]+gracias)?|eso es todo|terminar|finalizar|hasta luego)[.!\s]*$/iu.test(value)) return "finish";
  if (/^(?:cancelar|cancela(?:\s+(?:el\s+)?borrador)?)[.!\s]*$/iu.test(value)) return "cancel";
  if (/\b(?:otras?\s+opciones|otras?\s+acciones|men[uú]|opciones|ayuda)\b/iu.test(value)) return "other_options";
  if (/\b(?:consulta[r]?|ver|listar|mostrar|mu[eé]strame)\b[\s\S]*\bborradores?\b|^borradores?$/iu.test(value)) return "drafts";
  if (/\b(?:anula\p{L}*|nota\s+de\s+cr[eé]dito)\b/iu.test(value)) return "credit_note";
  if (/\bgu[ií]a(?:\s+de\s+remisi[oó]n)?\b/iu.test(value)) return "despatch";
  const request = /\b(?:hazme|hacer|crear|crea|generar|genera|quiero|necesito|preparar|prepara|nueva|otra)\b/iu.test(value);
  if ((request || /^factura$/iu.test(value)) && /\bfactura\b/iu.test(value)) return "invoice";
  if ((request || /^boleta$/iu.test(value)) && /\bboleta\b/iu.test(value)) return "receipt";
  if (/^(?:(?:ver|mostrar|mu[eé]strame)\s+(?:el\s+)?)?(?:resumen|confirmar|emitir|crear)(?:\s+(?:factura|boleta))?$/iu.test(value)) return "review";
  if (state.hasCurrentData && !state.completed) return "continue";
  if (/^(?:gracias|muchas gracias|perfecto)[.!\s]*$/iu.test(value)) return "conversation";
  return "unknown";
}

export async function classifyEnterpriseIntent(ai: AiProvider | null, model: string, text: string,
  state: IntentContext, log: AiLogger): Promise<EnterpriseIntent> {
  const fallback = fallbackEnterpriseIntent(text, state);
  if (ai?.decide && text.trim()) {
    try {
      const result = await ai.decide({ model, input: text.trim(), questions: [{
        type: "choice", name: "enterprise_intent",
        instructions: `Clasifica la intención ACTUAL del usuario, antes de responder según el estado anterior. Contexto: ${JSON.stringify(state)}.
Un saludo como Hola o Manolo es greeting incluso si hubo un comprobante emitido. Hola Manolo hazme una factura es invoice: el pedido concreto prevalece al saludo. invoice/receipt son pedidos claros para iniciar, no correcciones de datos del comprobante actual (continue). No confundas nota de crédito/anulación con factura nueva ni cancelar un borrador con anular un comprobante emitido. review/confirmar por texto sólo muestra revisión, jamás autoriza emisión. Un DNI, RUC, nombre, precio, cuota, categoría M1/L u otra información solicitada en una tarea activa es continue. Sí/No sólo responde al seguimiento si awaitingFollowUp=true. No inventes una acción para un mensaje ambiguo: unknown. La elección sólo enruta; no ejecuta operaciones.`,
        choices: [
          { value: "invoice", description: "Pedido explícito de generar una factura." },
          { value: "receipt", description: "Pedido explícito de generar una boleta." },
          { value: "drafts", description: "Consultar borradores existentes." },
          { value: "credit_note", description: "Anular factura o preparar nota de crédito." },
          { value: "despatch", description: "Preparar guía de remisión." },
          { value: "other_options", description: "Ver otras opciones o menú de acciones." },
          { value: "greeting", description: "Saludo o llamada a Manolo sin otro pedido concreto." },
          { value: "continue", description: "Aportar datos o continuar la tarea actual." },
          { value: "review", description: "Revisar resumen o pedir confirmar por texto, sin emitir." },
          { value: "cancel", description: "Cancelar el borrador actual." },
          { value: "finish", description: "No quiere otra acción, cerrar conversación." },
          { value: "another_action", description: "Quiere realizar otra acción después de terminar." },
          { value: "conversation", description: "Conversación o agradecimiento sin nueva operación." },
          { value: "unknown", description: "Intención no clara; orientar con menú." },
        ],
      }] }, log);
      const answer = result?.answers.find((item) => item.name === "enterprise_intent" && item.type === "choice");
      if (answer?.type === "choice" && ENTERPRISE_INTENTS.includes(answer.choice as EnterpriseIntent)) {
        // Exact greetings cannot become fiscal actions due to an old checkpoint.
        const intent = greetingOnly(text.trim()) ? "greeting"
          : isEnterpriseReviewOnly(text) ? "review" : answer.choice as EnterpriseIntent;
        log("whatsapp_enterprise_intent", { intent, source: "decisions" });
        return intent;
      }
    } catch { log("whatsapp_enterprise_intent_unavailable", { reason: "decision_failed" }); }
  }
  log("whatsapp_enterprise_intent", { intent: fallback, source: "fallback" });
  return fallback;
}
