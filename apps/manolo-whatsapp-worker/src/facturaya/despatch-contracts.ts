import type { FacturayaResult } from "./contracts";
import { isFullDate } from "./payment-terms";

export type DespatchPayload = {
  vehicle_category?: "M1" | "L" | "other";
  invoice_id: string;
  issue_date: string;
  transfer_date: string;
  origin: { ubigeo: string; address: string };
  destination: { ubigeo: string; address: string };
  weight_kg: string;
  vehicle?: { plate: string };
  driver?: { dni: string; first_name: string; last_name: string; license: string };
  items: { description: string; quantity: string; unit: "NIU" | "KGM" | "MTR" | "LTR" }[];
};
export type CreateDespatchInput = DespatchPayload & { idempotency_key: string };
export type FacturayaDespatch = {
  id: string;
  confirmation_digest: string;
  payload: DespatchPayload;
  status: string;
  series: string;
  environment: string;
  is_demo: boolean;
  ticket?: string | null;
  correlative?: number | null;
  message?: string | null;
};
export interface FacturayaDespatchOperations {
  create(input: CreateDespatchInput): Promise<FacturayaResult<FacturayaDespatch>>;
  get(id: string): Promise<FacturayaResult<FacturayaDespatch>>;
  issue(id: string, digest: string): Promise<FacturayaResult<FacturayaDespatch>>;
  refresh(id: string): Promise<FacturayaResult<FacturayaDespatch>>;
}

export function peruDate(): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  return ["year", "month", "day"].map((name) => parts.find((part) => part.type === name)!.value).join("-");
}
export function positiveDecimal3(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,9}(?:\.\d{1,3})?$/.test(value) && Number(value) > 0;
}
export function despatchProblems(value: DespatchPayload, invoiceDate?: string): string[] {
  const missing: string[] = [];
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(value.invoice_id)) missing.push("elegir una factura aceptada de esta empresa");
  if (!isFullDate(value.issue_date) || value.issue_date > peruDate()
    || (invoiceDate && value.issue_date < invoiceDate)) missing.push("fecha completa de emisión de guía, no futura ni anterior a la factura");
  if (!isFullDate(value.transfer_date) || value.transfer_date < value.issue_date) missing.push("fecha completa de traslado, no anterior a emisión");
  for (const [name, address] of [["partida", value.origin], ["llegada", value.destination]] as const) {
    if (!/^\d{6}$/.test(address.ubigeo)) missing.push(`ubigeo de ${name} de seis dígitos`);
    if (!address.address.trim() || address.address.length > 500) missing.push(`dirección completa de ${name}`);
  }
  if (!positiveDecimal3(value.weight_kg)) missing.push("peso total en kg, positivo con hasta tres decimales");
  if (value.vehicle_category !== "M1" && value.vehicle_category !== "L") {
    if (!/^[A-Z0-9]{6}$/.test(value.vehicle?.plate ?? "")) missing.push("placa principal de seis caracteres");
    if (!/^\d{8}$/.test(value.driver?.dni ?? "")) missing.push("DNI del conductor de ocho dígitos");
    if (!value.driver?.first_name.trim() || value.driver.first_name.length > 100) missing.push("nombres del conductor");
    if (!value.driver?.last_name.trim() || value.driver.last_name.length > 100) missing.push("apellidos del conductor");
    if (!/^[A-Z0-9]{6,15}$/.test(value.driver?.license ?? "")) missing.push("licencia del conductor");
  } else if (value.vehicle !== undefined || value.driver !== undefined) missing.push("omitir vehículo y conductor para categoría M1/L");
  if (!value.items.length || value.items.length > 100 || value.items.some((item) => !item.description.trim()
    || item.description.length > 500 || !positiveDecimal3(item.quantity) || !["NIU", "KGM", "MTR", "LTR"].includes(item.unit))) {
    missing.push("bienes confirmados con descripción, cantidad positiva y unidad NIU/KGM/MTR/LTR (máximo 100)");
  }
  return missing;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function parseDespatchPayload(value: unknown): DespatchPayload | null {
  if (!record(value) || !record(value.origin) || !record(value.destination)
    || !Array.isArray(value.items) || value.items.length > 100) return null;
  const category = value.vehicle_category;
  if (category !== undefined && category !== "M1" && category !== "L" && category !== "other") return null;
  const exempt = category === "M1" || category === "L";
  if (exempt ? ("vehicle" in value || "driver" in value) : (!record(value.vehicle) || !record(value.driver))) return null;
  const input = value as Record<string, unknown>;
  if (!["invoice_id", "issue_date", "transfer_date", "weight_kg"].every((key) => typeof input[key] === "string")) return null;
  if (![value.origin, value.destination].every((item) => typeof item.ubigeo === "string" && typeof item.address === "string")
    || (!exempt && (!record(value.vehicle) || typeof value.vehicle.plate !== "string"
      || !record(value.driver) || !["dni", "first_name", "last_name", "license"].every((key) => typeof (value.driver as Record<string, unknown>)[key] === "string")))) return null;
  if (value.items.some((item) => !record(item) || typeof item.description !== "string" || typeof item.quantity !== "string"
    || typeof item.unit !== "string" || !["NIU", "KGM", "MTR", "LTR"].includes(item.unit))) return null;
  // Read only the documented fields. Company, environment and routing are server authority.
  return {
    ...(category ? { vehicle_category: category } : {}),
    invoice_id: String(value.invoice_id), issue_date: String(value.issue_date), transfer_date: String(value.transfer_date), weight_kg: String(value.weight_kg),
    origin: { ubigeo: String(value.origin.ubigeo), address: String(value.origin.address) },
    destination: { ubigeo: String(value.destination.ubigeo), address: String(value.destination.address) },
    ...(!exempt && record(value.vehicle) && record(value.driver) ? {
      vehicle: { plate: String(value.vehicle.plate) },
      driver: { dni: String(value.driver.dni), first_name: String(value.driver.first_name), last_name: String(value.driver.last_name), license: String(value.driver.license) },
    } : {}),
    items: value.items.map((item) => ({ description: item.description, quantity: item.quantity, unit: item.unit })),
  };
}
export function parseCreateDespatch(value: unknown): CreateDespatchInput | null {
  const payload = parseDespatchPayload(value);
  if (!payload || !record(value) || typeof value.idempotency_key !== "string"
    || !/^[A-Za-z0-9._:-]{1,120}$/.test(value.idempotency_key)
    || ["company_id", "environment", "transport_mode", "reason_code"].some((key) => key in value)
    || despatchProblems(payload).length) return null;
  return { ...payload, idempotency_key: value.idempotency_key };
}
export function parseDespatchResponse(value: unknown): FacturayaDespatch | null {
  if (!record(value)) return null;
  const payload = parseDespatchPayload(value.payload);
  if (!payload || typeof value.id !== "string" || !/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(value.id)
    || typeof value.confirmation_digest !== "string" || !/^[a-f0-9]{64}$/.test(value.confirmation_digest)
    || typeof value.status !== "string" || typeof value.environment !== "string" || typeof value.is_demo !== "boolean"
    || typeof value.series !== "string") return null;
  return { id: value.id, payload, confirmation_digest: value.confirmation_digest, status: value.status,
    environment: value.environment, is_demo: value.is_demo, series: value.series,
    ticket: typeof value.ticket === "string" ? value.ticket : null,
    correlative: typeof value.correlative === "number" ? value.correlative : null,
    message: typeof value.message === "string" ? value.message.slice(0, 500) : null };
}
