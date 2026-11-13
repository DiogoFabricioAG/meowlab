import type { FacturayaTenant } from "./contracts";
import type { DespatchPayload, FacturayaDespatch } from "./despatch-contracts";
import { districtByCode } from "../geography/ubigeo";

// Replica del formato "Guia_Remision_Plantilla_M1_L_2026.docx" (A4, 17 filas de bienes).
// Es un formato de trabajo: no sustituye la representación impresa oficial de la GRE.
export const DESPATCH_TEMPLATE_MIN_ROWS = 17;

export type DespatchDocumentInput = {
  company: Pick<FacturayaTenant, "name" | "legalName" | "ruc" | "address">;
  invoice: { number: string; customerName: string; customerRuc: string };
  fields: DespatchPayload;
  guide?: Pick<FacturayaDespatch, "series" | "correlative" | "status" | "environment" | "is_demo" | "ticket">;
};

const UNIT_LABELS: Record<DespatchPayload["items"][number]["unit"], string> = {
  NIU: "UND", KGM: "KGM", MTR: "MTR", LTR: "LTR",
};

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function peruDisplayDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function guideNumber(guide: DespatchDocumentInput["guide"]): string {
  const series = guide?.series?.trim() || "T001";
  return typeof guide?.correlative === "number" && Number.isInteger(guide.correlative) && guide.correlative > 0
    ? `${series} - ${String(guide.correlative).padStart(8, "0")}`
    : `${series} - ${!guide || guide.status === "draft" ? "BORRADOR" : "POR ASIGNAR"}`;
}

function statusNote(guide: DespatchDocumentInput["guide"]): string {
  if (!guide) return "Borrador sin enviar";
  if (guide.is_demo) return "Simulación local · no enviada a SUNAT";
  const environment = guide.environment === "production" ? "Producción" : `Entorno ${guide.environment}`;
  const status = guide.status === "draft" ? "Borrador para revisión"
    : guide.status === "pending" ? "Enviada · aceptación pendiente"
      : guide.status === "accepted" ? "Aceptada por SUNAT"
        : guide.status === "rejected" ? "Rechazada" : "Estado por verificar";
  return `${status} · ${environment}`;
}

const words = (value: string) => ` ${value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es").replace(/[^a-z0-9]+/g, " ").trim()} `;

function location(endpoint: DespatchPayload["origin"]): string {
  const district = districtByCode(endpoint.ubigeo);
  const address = endpoint.address.trim();
  const names = [district?.district, district?.province, district?.department].filter((part): part is string => Boolean(part));
  // A reference such as "ALMACEN DEL PROVEEDOR - ARMA - CASTROVIRREYNA - HUANCAVELICA" already names the whole place.
  const complete = names.length === 3 && names.every((name) => words(address).includes(words(name)));
  return [address, ...(complete ? [] : names)].filter(Boolean).join(" · ");
}

const field = (label: string, value: string, span = 1) =>
  `<th scope="row">${escapeHtml(label)}</th><td${span > 1 ? ` colspan="${span}"` : ""}>${escapeHtml(value) || "&nbsp;"}</td>`;

const sectionBar = (title: string, note = "") =>
  `<div class="bar"><span>${escapeHtml(title)}</span><span class="note">${escapeHtml(note)}</span></div>`;

/** Builds a self-contained print HTML (no network resources) for Browser Run. */
export function renderDespatchHtml(input: DespatchDocumentInput): string {
  const { company, invoice, fields, guide } = input;
  const exempt = fields.vehicle_category === "M1" || fields.vehicle_category === "L";
  const category = fields.vehicle_category === "other" ? "Otra" : fields.vehicle_category ?? "Pendiente";
  const rows = fields.items.map((item, index) => `<tr>
      <td class="n">${index + 1}</td><td></td><td></td><td></td><td></td><td></td>
      <td class="desc">${escapeHtml(item.description)}</td>
      <td class="c">${escapeHtml(UNIT_LABELS[item.unit] ?? item.unit)}</td>
      <td class="c">${escapeHtml(item.quantity)}</td>
    </tr>`);
  for (let index = rows.length; index < DESPATCH_TEMPLATE_MIN_ROWS; index++) {
    rows.push(`<tr><td class="n">${index + 1}</td><td></td><td></td><td></td><td></td><td></td><td class="desc"></td><td></td><td></td></tr>`);
  }
  const driver = fields.driver
    ? `${fields.driver.first_name} ${fields.driver.last_name} · DNI ${fields.driver.dni} · Licencia ${fields.driver.license}`.trim()
    : "";

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'" />
<title>Guía de remisión ${escapeHtml(guideNumber(guide))}</title>
<style>
  @page {
    size: A4;
    margin: 14mm 15mm 13mm 15mm;
    @top-right { content: "FORMATO DE TRABAJO  ·  NO ES UNA GRE EMITIDA POR SUNAT"; font: 6.5pt Aptos, "Segoe UI", Arial, sans-serif; color: #64748B; vertical-align: bottom; padding-bottom: 3mm; }
    @bottom-center { content: "PLANTILLA PARA CAPTURA DE DATOS  •  NO SUSTITUYE LA EMISIÓN DE LA GRE EN SUNAT"; font: 6.5pt Aptos, "Segoe UI", Arial, sans-serif; color: #64748B; vertical-align: top; padding-top: 3mm; }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Aptos, "Segoe UI", "Helvetica Neue", Arial, "Liberation Sans", sans-serif; font-size: 8pt; color: #1E293B;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .head td { vertical-align: middle; padding: 0; }
  .sender { font-size: 8.5pt; line-height: 1.35; padding-right: 6mm !important; }
  .sender .label { font-weight: 700; color: #475569; }
  .sender .name { font-weight: 700; color: #1E293B; }
  .sender .ruc { color: #475569; }
  .sender .ruc b { font-weight: 700; }
  .sender .address { color: #64748B; }
  .number { border: 1.5pt solid #475569; height: 21mm; text-align: center; font-weight: 700; line-height: 1.6; }
  .number .t1 { font-size: 8.5pt; }
  .number .t2 { font-size: 9.5pt; }
  .number .t3 { font-size: 8.5pt; color: #475569; }
  .bar { display: flex; justify-content: space-between; align-items: center; background: #F4F6F8; padding: 1.6mm 2mm;
    font-size: 8pt; font-weight: 700; margin-top: 4mm; }
  .bar .note { font-size: 7pt; color: #64748B; }
  .grid th, .grid td { border: 0.75pt solid #CBD5E1; height: 7.9mm; padding: 1mm 2mm; text-align: left; vertical-align: middle; }
  .grid th { background: #F8FAFC; font-size: 7pt; font-weight: 700; color: #475569; }
  .grid td { font-size: 8pt; color: #1E293B; overflow-wrap: anywhere; }
  .items thead th { background: #E9EEF3; border: 0.75pt solid #AEBAC6; font-size: 6.5pt; font-weight: 700; color: #1E293B;
    text-align: center; vertical-align: middle; height: 7.9mm; padding: 0.6mm 0.8mm; line-height: 1.15; }
  .items tbody td { border: 0.75pt solid #CBD5E1; height: 5.6mm; font-size: 7pt; padding: 0.6mm 1.2mm; vertical-align: middle; }
  .items tbody tr { break-inside: avoid; }
  .items tbody tr:nth-child(even) td { background: #FBFCFD; }
  .items .n { text-align: center; font-weight: 700; color: #475569; }
  .items .c { text-align: center; }
  .items .desc { overflow-wrap: anywhere; }
  .gap { height: 3mm; }
  .foot { font-size: 7pt; color: #475569; margin-top: 1.6mm; }
  .bar { break-after: avoid; }
  .keep { break-inside: avoid; }
</style>
</head>
<body>
  <table class="head">
    <colgroup><col style="width:63.3%" /><col style="width:36.7%" /></colgroup>
    <tr>
      <td class="sender">
        <div class="label">DATOS DEL REMITENTE</div>
        <div class="name">${escapeHtml(company.legalName?.trim() || company.name)}</div>
        <div class="ruc"><b>RUC</b>&nbsp;&nbsp;${escapeHtml(company.ruc ?? "")}</div>
        <div class="address">${escapeHtml(company.address?.trim() || "")}</div>
      </td>
      <td class="number">
        <div class="t1">GUÍA DE REMISIÓN ELECTRÓNICA</div>
        <div class="t2">REMITENTE</div>
        <div class="t3">N.º ${escapeHtml(guideNumber(guide))}</div>
      </td>
    </tr>
  </table>

  ${sectionBar("DATOS DE LA OPERACIÓN", statusNote(guide))}
  <table class="grid">
    <colgroup><col style="width:15.8%" /><col style="width:34.2%" /><col style="width:15.6%" /><col style="width:34.4%" /></colgroup>
    <tr>${field("Fecha y hora de emisión", peruDisplayDate(fields.issue_date))}${field("Inicio del traslado", peruDisplayDate(fields.transfer_date))}</tr>
    <tr>${field("Motivo de traslado", "VENTA")}${field("Tipo de transporte", "PRIVADO")}</tr>
  </table>
  <table class="grid">
    <colgroup><col style="width:19.2%" /><col style="width:80.8%" /></colgroup>
    <tr>${field("Punto de partida", location(fields.origin))}</tr>
    <tr>${field("Punto de llegada", location(fields.destination))}</tr>
  </table>

  ${sectionBar("DESTINATARIO Y DOCUMENTO RELACIONADO")}
  <table class="grid">
    <colgroup><col style="width:15.8%" /><col style="width:34.2%" /><col style="width:15.6%" /><col style="width:34.4%" /></colgroup>
    <tr>${field("Destinatario", invoice.customerName)}${field("RUC / documento", invoice.customerRuc)}</tr>
    <tr>${field("Documento asociado", "FACTURA")}${field("Serie y número", invoice.number)}</tr>
  </table>

  ${sectionBar("BIENES POR TRANSPORTAR", `${fields.items.length} ${fields.items.length === 1 ? "bien" : "bienes"}`)}
  <table class="items">
    <colgroup>
      <col style="width:3.6%" /><col style="width:6.1%" /><col style="width:6.1%" /><col style="width:6.4%" /><col style="width:6.7%" />
      <col style="width:5.6%" /><col style="width:44.4%" /><col style="width:12.2%" /><col style="width:8.9%" />
    </colgroup>
    <thead><tr>
      <th>N.º</th><th>Bien<br />norm.</th><th>Cód.<br />bien</th><th>Cód.<br />SUNAT</th><th>Partida<br />aranc.</th><th>GTIN</th>
      <th>Descripción detallada</th><th>Unidad<br />medida</th><th>Cantidad</th>
    </tr></thead>
    <tbody>
${rows.join("\n")}
    </tbody>
  </table>
  <div class="gap"></div>
  <table class="grid keep">
    <colgroup><col style="width:15.8%" /><col style="width:34.2%" /><col style="width:15.6%" /><col style="width:34.4%" /></colgroup>
    <tr>${field("Unidad del peso", "KGM")}${field("Peso bruto total", fields.weight_kg)}</tr>
  </table>

  <div class="keep">
  ${sectionBar("INFORMACIÓN DEL TRANSPORTE", exempt ? "Vehículos M1 / L" : "Vehículo y conductor")}
  <table class="grid">
    <colgroup><col style="width:15.8%" /><col style="width:34.2%" /><col style="width:15.6%" /><col style="width:34.4%" /></colgroup>
    <tr>${field("Categoría vehicular", category)}${field("Placa (si corresponde)", exempt ? "No aplica" : fields.vehicle?.plate ?? "")}</tr>
    ${exempt ? "" : `<tr>${field("Conductor", driver, 3)}</tr>`}
    <tr>${field("Transbordo programado", "NO")}${field("Observaciones", guide?.ticket ? `Ticket ${guide.ticket}` : "")}</tr>
  </table>
  <div class="foot">${exempt
    ? "Traslado en vehículo M1/L: este formato omite los campos de conductor y transportista."
    : "Traslado en vehículo de otra categoría: se declaran placa y conductor."}</div>
  </div>
</body>
</html>`;
}

/** File name that WhatsApp shows to the user; ASCII only. */
export function despatchPdfFilename(input: Pick<DespatchDocumentInput, "guide">, revision: number): string {
  const series = (input.guide?.series ?? "T001").replace(/[^A-Za-z0-9]/g, "") || "T001";
  const correlative = input.guide?.correlative;
  if (typeof correlative === "number" && Number.isInteger(correlative) && correlative > 0) {
    return `Guia-Remision-${series}-${String(correlative).padStart(8, "0")}.pdf`;
  }
  return `Guia-Remision-${series}-${!input.guide || input.guide.status === "draft" ? "borrador" : "enviada"}-r${revision}.pdf`;
}
