import type { DebtSummary, PaymentOptions } from "./bridge-contracts";
import type { Buckets, CollectionsAnswer, Reminder } from "./client";

/** Texts of Collections Cat (ADR-0015): to the team and, prepared, to the customer. */

export const soles = (cents: number) =>
  `S/ ${(cents / 100).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"];
export const shortDate = (day: string) => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;

const METHOD_LABEL: Record<string, string> = {
  yape: "Yape", plin: "Plin", transferencia: "transferencia", efectivo: "efectivo", tarjeta: "tarjeta", enlace: "enlace de pago",
  nota_credito: "nota de crédito", otro: "otro medio",
};
export const methodLabel = (method: string) => METHOD_LABEL[method] ?? method;

const phoneGroups = (phone: string) => phone.replace(/^(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3");

/** «vence el 30 nov», «vence hoy», «venció hace 5 días». */
export function dueText(debt: Pick<DebtSummary, "daysLate" | "dueOn">): string {
  if (debt.daysLate < 0) return `vence el ${shortDate(debt.dueOn)}`;
  if (debt.daysLate === 0) return "vence hoy";
  return `venció hace ${debt.daysLate} ${debt.daysLate === 1 ? "día" : "días"}`;
}

export function debtLine(debt: DebtSummary): string {
  const what = debt.document ?? debt.description;
  return `• ${debt.customer}: ${soles(debt.balanceCents)}, ${dueText(debt)}${what ? ` (${what})` : ""}`;
}

export function paymentBlock(payment: PaymentOptions): string {
  const lines = [
    payment.yapePhone ? `• Yape: ${phoneGroups(payment.yapePhone)}` : "",
    payment.plinPhone ? `• Plin: ${phoneGroups(payment.plinPhone)}` : "",
    payment.bankText ? `• Transferencia: ${payment.bankText}` : "",
    payment.paymentLink ? `• Enlace de pago: ${payment.paymentLink}` : "",
  ].filter(Boolean);
  return lines.length ? `Puedes pagar por:\n${lines.join("\n")}` : "Respóndenos este mensaje para coordinar el pago.";
}

export const hasPaymentOptions = (payment: PaymentOptions) =>
  Boolean(payment.yapePhone || payment.plinPhone || payment.bankText || payment.paymentLink);

/**
 * The message for the customer, firmer as days go by (ADR-0015, point 6). It never threatens
 * and never adds interest (point 13).
 */
export function reminderText(reminder: Reminder): string {
  const { debt, companyName, customerBalanceCents, openDebts } = reminder;
  const name = debt.customer.split(/\s+/)[0];
  const amount = soles(customerBalanceCents);
  const what = openDebts > 1 ? ` (${openDebts} pendientes)` : debt.document ? ` (${debt.document})` : debt.description ? ` (${debt.description})` : "";
  const opening = reminder.tone === "friendly"
    ? `Hola ${name}, te saluda ${companyName}. 😊 Te recordamos que tienes un saldo de ${amount}${what} que ${debt.daysLate === 0 ? "vence hoy" : `vence el ${shortDate(debt.dueOn)}`}.`
    : reminder.tone === "firm"
      ? `Hola ${name}, te escribimos de ${companyName}. Tu saldo de ${amount}${what} venció el ${shortDate(debt.dueOn)}. Te agradeceremos regularizarlo a la brevedad.`
      : `Hola ${name}, te escribimos de ${companyName} por tu saldo de ${amount}${what}, vencido desde el ${shortDate(debt.dueOn)}. Necesitamos que lo regularices o nos digas en qué fecha podrás pagar.`;
  return [opening, paymentBlock(reminder.payment), "Si ya pagaste, envíanos la captura y lo validamos. ¡Gracias!"].join("\n\n");
}

/** Opens a chat with the customer with the reminder already written. */
export const whatsappLink = (phone: string, text: string) => `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;

export function bucketLines(buckets: Buckets): string {
  return [
    buckets.current ? `• Al día: ${soles(buckets.current)}` : "",
    buckets.d1_30 ? `• Vencido 1 a 30 días: ${soles(buckets.d1_30)}` : "",
    buckets.d31_60 ? `• Vencido 31 a 60 días: ${soles(buckets.d31_60)}` : "",
    buckets.d61 ? `• Vencido más de 60 días: ${soles(buckets.d61)}` : "",
  ].filter(Boolean).join("\n");
}

const PERIOD_LABEL = { today: "hoy", week: "esta semana", month: "este mes" } as const;

export function formatAnswer(answer: CollectionsAnswer): string {
  if ("period" in answer) {
    const when = PERIOD_LABEL[answer.period];
    if (!answer.payments.length) return `No registré pagos ${when}.`;
    return `*Te pagaron ${soles(answer.totalCents)} ${when}:*\n${answer.payments.slice(0, 15)
      .map((payment) => `• ${payment.customer}: ${soles(payment.amountCents)} por ${methodLabel(payment.method)} (${shortDate(payment.paidOn)})`).join("\n")}`;
  }
  if ("lateCount" in answer) {
    if (!answer.totalCents) return "Nadie te debe nada. 👍";
    return `*Te deben ${soles(answer.totalCents)}* (${answer.customers} ${answer.customers === 1 ? "cliente" : "clientes"}).\n${bucketLines(answer.buckets)}`;
  }
  if (!answer.customers.length) return "Nadie te debe nada. 👍";
  return `*Quiénes te deben (${soles(answer.totalCents)} en total):*\n${answer.customers.map((entry) => {
    const late = entry.oldestDaysLate > 0 ? `, lo más antiguo venció hace ${entry.oldestDaysLate} ${entry.oldestDaysLate === 1 ? "día" : "días"}` : ", al día";
    return `• ${entry.customer}: ${soles(entry.balanceCents)}${late}${entry.escalated ? " · conviene que le hables tú" : ""}`;
  }).join("\n")}`;
}
