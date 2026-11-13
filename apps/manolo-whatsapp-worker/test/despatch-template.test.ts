import { describe, expect, it } from "vitest";
import { DESPATCH_TEMPLATE_MIN_ROWS, despatchPdfFilename, renderDespatchHtml, type DespatchDocumentInput } from "../src/facturaya/despatch-template";
import { despatchPayload, guideDraft } from "./despatch-fixture";

const base: DespatchDocumentInput = {
  company: { name: "Empresa Demo", legalName: "Empresa Demo SAC", ruc: "20123456789", address: "Av. Arequipa 1234, Lince" },
  invoice: { number: "F001-123", customerName: "Cliente Demo", customerRuc: "20999999999" },
  fields: { ...despatchPayload, origin: { ubigeo: "150122", address: "Calle Uno 123" } },
  guide: guideDraft,
};
const itemRows = (html: string) => html.match(/<td class="n">\d+<\/td>/g)?.length ?? 0;

describe("despatch PDF template", () => {
  it("fills every section of the M1/L template with the guide data", () => {
    const html = renderDespatchHtml({ ...base, fields: { ...base.fields, vehicle_category: "M1", vehicle: undefined, driver: undefined },
      guide: { ...guideDraft, status: "accepted", is_demo: false, correlative: 7 } });
    for (const text of ["DATOS DEL REMITENTE", "Empresa Demo SAC", "20123456789", "Av. Arequipa 1234, Lince",
      "N.º T001 - 00000007", "DATOS DE LA OPERACIÓN", "Aceptada por SUNAT · Entorno beta", "VENTA", "PRIVADO",
      "Calle Uno 123 · Miraflores · Lima · Lima", "DESTINATARIO Y DOCUMENTO RELACIONADO", "Cliente Demo", "20999999999",
      "FACTURA", "F001-123", "BIENES POR TRANSPORTAR", "Chalecos", ">UND<", ">4<", "KGM", "25.500",
      "INFORMACIÓN DEL TRANSPORTE", "Vehículos M1 / L", "No aplica",
      "Traslado en vehículo M1/L: este formato omite los campos de conductor y transportista.",
      "FORMATO DE TRABAJO  ·  NO ES UNA GRE EMITIDA POR SUNAT", "NO SUSTITUYE LA EMISIÓN DE LA GRE EN SUNAT"]) {
      expect(html).toContain(text);
    }
    expect(html).toContain(`<td>${base.fields.issue_date.split("-").reverse().join("/")}</td>`);
    expect(html).toContain("<td>05/12/2027</td>");
    expect(html).not.toContain("Conductor");
  });

  it("does not repeat district, province and department already named in a reference address", () => {
    const warehouse = "ALMACEN DEL PROVEEDOR - ARMA - CASTROVIRREYNA - HUANCAVELICA";
    const html = renderDespatchHtml({ ...base, fields: { ...base.fields, destination: { ubigeo: "090402", address: warehouse } } });
    expect(html).toContain(`<td>${warehouse}</td>`);
    expect(html).toContain("Calle Uno 123 · Miraflores · Lima · Lima");
  });

  it("declares plate and driver for the other category", () => {
    const html = renderDespatchHtml(base);
    expect(html).toContain("ABC123");
    expect(html).toContain("Juan Pérez · DNI 12345678 · Licencia Q12345678");
    expect(html).toContain("Vehículo y conductor");
    expect(html).toContain("Simulación local · no enviada a SUNAT");
    expect(html).toContain("N.º T001 - BORRADOR");
  });

  it("keeps the 17 template rows and grows beyond them for longer guides", () => {
    expect(itemRows(renderDespatchHtml(base))).toBe(DESPATCH_TEMPLATE_MIN_ROWS);
    const items = Array.from({ length: 22 }, (_, index) => ({ description: `Bien ${index + 1}`, quantity: "1", unit: "NIU" as const }));
    expect(itemRows(renderDespatchHtml({ ...base, fields: { ...base.fields, items } }))).toBe(22);
  });

  it("escapes user data and loads no network resources", () => {
    const html = renderDespatchHtml({ ...base, invoice: { ...base.invoice, customerName: "<img src=https://evil.test/x>" },
      fields: { ...base.fields, items: [{ description: "Caja \"A\" & <script>alert(1)</script>", quantity: "2", unit: "KGM" }] } });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img src=https://evil.test/x&gt;");
    expect(html).toContain("Caja &quot;A&quot; &amp; &lt;script&gt;");
    expect(html).toContain("default-src 'none'");
    // Escaped text may mention a URL; no real tag may reference one.
    expect(html).not.toMatch(/<[^>]*\s(?:src|href)=/);
  });

  it("names the file after the correlative or the draft revision", () => {
    expect(despatchPdfFilename({ guide: { ...guideDraft, correlative: 12, status: "pending" } }, 3)).toBe("Guia-Remision-T001-00000012.pdf");
    expect(despatchPdfFilename({ guide: guideDraft }, 3)).toBe("Guia-Remision-T001-borrador-r3.pdf");
    expect(despatchPdfFilename({ guide: { ...guideDraft, status: "pending" } }, 4)).toBe("Guia-Remision-T001-enviada-r4.pdf");
  });
});
