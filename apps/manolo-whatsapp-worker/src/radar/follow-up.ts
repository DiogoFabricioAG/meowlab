import type { WhatsAppReplyButton } from "../whatsapp/contracts";

export const FOLLOW_UP_ACTIONS = {
  interest: { title: "Me interesa", prompt: "Me interesa esta convocatoria." },
  detail: { title: "Ver detalle", prompt: "Muéstrame los ítems, cantidades, fechas por etapa, monto, documentos disponibles y fuente oficial de esta convocatoria." },
  summary: { title: "Ver detalle", prompt: "Muéstrame el detalle ampliado de esta convocatoria." },
  dismiss: { title: "Descartar", prompt: "No me interesa esta convocatoria." },
  info: { title: "Saber más", prompt: "Deseo saber más información sobre esta convocatoria. Resume qué compra la entidad, quién compra y el plazo confirmado, sin repetir datos técnicos innecesarios." },
  products: { title: "Ver productos", prompt: "Quiero revisar los productos solicitados. Distingue el producto mencionado en el objeto de cantidades, tallas, materiales y especificaciones que no están disponibles. No inventes un desglose; dime qué falta verificar en las bases y haz una pregunta útil." },
  evaluate: { title: "Evaluar si participo", prompt: "Quiero evaluar si me conviene participar. Usa sólo los hechos del aviso; distingue orientación general de requisitos confirmados. Pregunta primero por mi capacidad para abastecer el producto, sin afirmar que califico ni inventar costos o márgenes." },
  source: { title: "Ver fuente oficial", prompt: "Muéstrame la fuente oficial de esta convocatoria." },
} as const;
export type FollowUpAction = keyof typeof FOLLOW_UP_ACTIONS;
const deliveryPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export function followUpButtons(deliveryId: string, current?: FollowUpAction): WhatsAppReplyButton[] {
  if (!deliveryPattern.test(deliveryId)) return [];
  const actions: FollowUpAction[] = ["interest", "detail", "dismiss"];
  return actions
    .map(action => ({ id: `radar:alert:${deliveryId}:${action}`, title: FOLLOW_UP_ACTIONS[action].title }));
}

export function parseFollowUp(id: string): { deliveryId: string; action: FollowUpAction } | null {
  const match = /^radar:alert:([^:]+):(interest|detail|summary|dismiss|info|products|evaluate|source)$/.exec(id);
  return match && deliveryPattern.test(match[1]!)
    ? { deliveryId: match[1]!, action: match[2] as FollowUpAction } : null;
}

export function interactiveAlert(to: string, body: string, deliveryId: string) {
  const buttons = followUpButtons(deliveryId);
  if (!buttons.length || body.length > 1024) throw Error("invalid_interactive_alert");
  return { messaging_product: "whatsapp", recipient_type: "individual", to, type: "interactive",
    interactive: { type: "button", body: { text: body },
      action: { buttons: buttons.map(reply => ({ type: "reply", reply })) } } };
}
