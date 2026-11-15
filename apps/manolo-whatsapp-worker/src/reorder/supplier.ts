import type { AiProvider } from "../ai/contracts";
import type { RoleLog, TenantContext } from "../roles/contracts";
import type { WhatsAppClient } from "../whatsapp/contracts";
import type { ReorderClient, SupplierMatch } from "./client";
import { extractSupplierReply } from "./extractor";
import { SUPPLIER_TEMPLATE, itemsLine, ownerNotice, supplierThanks, supplierTemplateParameters } from "./messages";

const LIMA_OFFSET_MS = 5 * 60 * 60 * 1000;
const limaToday = (now: Date) => new Date(now.getTime() - LIMA_OFFSET_MS).toISOString().slice(0, 10);

/**
 * A supplier wrote to MeowLab's number about an order (ADR-0016, points 7, 9 and 21): the
 * answer is read, recorded on the order, thanked, and the owner is told. The PDF goes to
 * the supplier the first time they write, now that the 24-hour window is open. Returns the
 * text sent to the supplier, for the conversation history.
 */
export async function handleSupplierMessage(input: {
  matches: SupplierMatch[];
  text: string;
  supplierPhone: string;
  phoneNumberId: string;
  client: ReorderClient;
  whatsapp: WhatsAppClient;
  /** Writes to the supplier in this conversation, so the history keeps it. */
  replyToSupplier: (text: string) => Promise<unknown>;
  ai: AiProvider | null;
  tenant: TenantContext;
  log: RoleLog;
  now?: Date;
}): Promise<string> {
  const match = input.matches[0];
  const reply = await extractSupplierReply(input.ai, input.tenant, {
    message: input.text, order: match.order.lines.map((line) => `${line.quantity} ${line.item}`), today: limaToday(input.now ?? new Date()),
  }, input.log) ?? { outcome: "other" as const, note: input.text.slice(0, 500) };
  const saved = await input.client.supplierReply(match.companyId, match.order.id, input.supplierPhone, reply);
  if (!saved.ok) {
    input.log("whatsapp_reorder_supplier_reply_failed", { code: saved.code });
    const text = `Gracias, le paso su mensaje a ${match.companyName}.`;
    await input.replyToSupplier(text);
    return text;
  }
  const result = saved.data;
  const thanks = result.sendPdf || reply.outcome !== "accepted"
    ? supplierThanks(result.companyName, reply.outcome)
    : `¡Gracias! Le confirmo a ${result.companyName} su respuesta.`;
  await input.replyToSupplier(thanks);
  if (result.sendPdf && reply.outcome !== "declined") {
    const pdf = await input.client.orderPdf(match.companyId, match.order.id);
    if (pdf.ok) {
      await input.whatsapp.sendDocument(input.supplierPhone, new Blob([pdf.data.bytes], { type: "application/pdf" }), pdf.data.filename,
        `Orden de compra de ${result.companyName}`, input.phoneNumberId);
    }
  }
  await notifyOwner(input.client, input.whatsapp, match.companyId, result.companyName, result.notice, result.ownerPhones, input.phoneNumberId);
  return thanks;
}

/**
 * Tries to tell the owner now. Outside their 24-hour window Meta refuses free text: the
 * notice stays pending and shows when they open /reorder or the portal.
 */
async function notifyOwner(client: ReorderClient, whatsapp: WhatsAppClient, companyId: string, companyName: string,
  notice: { id: string; body: string }, ownerPhones: string[], phoneNumberId: string) {
  let delivered = false;
  for (const phone of ownerPhones) {
    const sent = await whatsapp.sendText(phone, ownerNotice(companyName, notice.body), phoneNumberId);
    delivered ||= sent.status === "sent";
  }
  if (delivered) await client.noticesDelivered(companyId, [notice.id]);
}

/**
 * The cron (ADR-0016, point 10): one reminder to suppliers that did not answer, with the
 * same template, and the owner hears about the ones that still did not after the wait.
 */
export async function runReorderFollowups(client: ReorderClient, whatsapp: WhatsAppClient, fallbackPhoneNumberId: string | null, log: RoleLog): Promise<void> {
  const due = await client.followups();
  if (!due.ok) {
    log("reorder_followups_failed", { code: due.code });
    return;
  }
  for (const reminder of due.data.reminders) {
    const phoneNumberId = reminder.phoneNumberId ?? fallbackPhoneNumberId;
    const phone = reminder.order.supplier?.phone;
    if (!phoneNumberId || !phone || !whatsapp.sendTemplate) continue;
    const sent = await whatsapp.sendTemplate(phone, SUPPLIER_TEMPLATE.name, SUPPLIER_TEMPLATE.language,
      supplierTemplateParameters(reminder.order, reminder.companyName), phoneNumberId);
    log("reorder_supplier_reminded", { status: sent.status, lines: itemsLine(reminder.order).length > 0 });
  }
  for (const escalation of due.data.escalations) {
    const phoneNumberId = escalation.phoneNumberId ?? fallbackPhoneNumberId;
    if (!phoneNumberId) continue;
    await notifyOwner(client, whatsapp, escalation.companyId, escalation.companyName, escalation.notice, escalation.ownerPhones, phoneNumberId);
  }
}
