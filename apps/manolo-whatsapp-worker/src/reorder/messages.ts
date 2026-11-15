import type { OrderSummary } from "./bridge-contracts";

/**
 * The supplier template approved in Meta for MeowLab's number (ADR-0016, point 7):
 * header «Pedido de {{1}}» (company); body «Hola {{1}}, le escribimos de parte de {{2}}. …
 * Queremos reponer estos productos: {{3}} …» (supplier, company, what is ordered).
 */
export const SUPPLIER_TEMPLATE = { name: "pedido_reposicion_proveedor", language: "es_PE" } as const;

export const soles = (cents: number) =>
  `S/ ${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const quantityText = (value: number) =>
  (Number.isInteger(value) ? String(value) : value.toLocaleString("es-PE", { maximumFractionDigits: 3 }));
export const orderCode = (number: number) => `OC-${String(number).padStart(6, "0")}`;
const shortDate = (value: string) => `${value.slice(8, 10)}/${value.slice(5, 7)}`;

/** «50 Polo blanco M, 30 Polo negro L»: one line, as the template parameter needs. */
export const itemsLine = (order: OrderSummary) =>
  order.lines.map((line) => `${quantityText(line.quantity)} ${line.item}`).join(", ");

export type SupplierTemplateParameters = { header: string[]; body: string[] };

export function supplierTemplateParameters(order: OrderSummary, companyName: string): SupplierTemplateParameters {
  return { header: [companyName], body: [order.supplier?.name ?? "proveedor", companyName, itemsLine(order)] };
}

const STATUS_LABEL: Record<OrderSummary["status"], string> = {
  proposed: "por aprobar",
  sent: "enviado, esperando respuesta",
  confirmed: "confirmado",
  partial: "llegó una parte",
  received: "recibido",
  declined: "rechazado por el proveedor",
  in_production: "en producción",
  done: "terminado",
  cancelled: "descartado",
};

/** A proposal or an order, ready for the chat. */
export function orderText(order: OrderSummary): string {
  const title = order.kind === "production"
    ? `*Producir · ${orderCode(order.number)}*`
    : `*Pedido a ${order.supplier?.name ?? "proveedor"} · ${orderCode(order.number)}*`;
  const lines = order.lines.map((line) => {
    const price = line.unitPriceCents !== null ? ` a ${soles(line.unitPriceCents)} c/u` : "";
    const received = line.receivedQty > 0 && line.receivedQty < line.quantity ? ` (llegaron ${quantityText(line.receivedQty)})` : "";
    return `• ${quantityText(line.quantity)} × ${line.item}${price}${received}`;
  });
  const total = order.confirmedCents ?? order.estimatedCents;
  const extra = [
    total !== null && order.kind === "purchase" ? `${order.confirmedCents !== null ? "Total" : "Estimado"}: ${soles(total)}` : null,
    order.deliverBy ? `Entrega: ${shortDate(order.deliverBy)}` : null,
    order.status !== "proposed" ? `Estado: ${STATUS_LABEL[order.status]}${order.escalated ? " ⚠️" : ""}` : null,
  ].filter(Boolean);
  return [title, ...lines, ...(extra.length ? [extra.join(" · ")] : [])].join("\n");
}

/** «En camino» in one line per order. */
export function openLine(order: OrderSummary): string {
  const who = order.kind === "production" ? "Producción" : order.supplier?.name ?? "Proveedor";
  return `• ${orderCode(order.number)} ${who}: ${itemsLine(order)} — ${STATUS_LABEL[order.status]}${order.deliverBy ? `, llega ${shortDate(order.deliverBy)}` : ""}${order.escalated ? " ⚠️" : ""}`;
}

/** What a supplier reads when they write back (the order goes to the owner, never decided here). */
export const supplierThanks = (companyName: string, outcome: "accepted" | "declined" | "other") =>
  outcome === "accepted"
    ? `¡Gracias! Le confirmo a ${companyName} su respuesta. Le adjunto la orden de compra.`
    : outcome === "declined"
    ? `Entendido, gracias por avisar. Se lo comunico a ${companyName}.`
    : `Gracias, le paso su mensaje a ${companyName} para que le responda.`;

export const ownerNotice = (companyName: string, body: string) => `🛒 *Reorder Cat · ${companyName}*\n${body}`;
