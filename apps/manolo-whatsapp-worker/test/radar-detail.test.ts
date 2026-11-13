import { expect, it } from "vitest";
import { friendlyAlertText, type RadarAlertContext } from "../src/radar/presentation";
import { opportunityDetail } from "../src/radar/action-answer";
import { followUpButtons, parseFollowUp } from "../src/radar/follow-up";

const context: RadarAlertContext = { deliveryId: "11111111-1111-1111-1111-111111111111", sentAt: 0, expiresAt: 1,
  alert: { ocid: "ocds-detail-1259952", code: "TEST-2026", buyer: "GOBIERNO REGIONAL DE PUNO SEDE CENTRAL",
    description: "TABIQUERÍA DE DRYWALL DE PLACA DE FIBROCEMENTO Y LANA DE VIDRIO INCLUYE INSTALACIÓN",
    amount: "Monto por confirmar", deadline: "2026-11-06T04:59:00Z", sourceUrl: "https://contratacionesabiertas.oece.gob.pe" },
  evidence: { sourceUrl: "https://prod4.seace.gob.pe/openegocio/#/ficha/idProceso/tipo/1259952/2", observedAt: "2026-11-04T15:00:00Z",
    items: [{ description: "Tabiques de fibrocemento y lana de vidrio con instalación", quantity: 25, unit: "m²" }],
    documents: [{ title: "Bases integradas", url: "https://prod1.seace.gob.pe/SeaceWeb-PRO/SdescargarArchivoAlfresco?fileCode=11111111-1111-1111-1111-111111111111" }],
    registrationDeadline: "2026-11-06T04:59:00Z", offerDeadline: "2026-11-08T04:59:00Z" },
};

it("shows the exact entity outside the AI prose and changes the button/action to detail", () => {
  const text = friendlyAlertText(context.alert, "Buscan tabiques de fibrocemento con instalación.");
  expect(text).toContain("*Entidad*\nGOBIERNO REGIONAL DE PUNO SEDE CENTRAL");
  expect(text.length).toBeLessThanOrEqual(1024);
  const buttons = followUpButtons(context.deliveryId!);
  expect(buttons.map(button => button.title)).toEqual(["Me interesa", "Ver detalle", "Descartar"]);
  expect(parseFollowUp(buttons[1]!.id)).toEqual({ deliveryId: context.deliveryId, action: "detail" });
  expect(parseFollowUp(`radar:alert:${context.deliveryId}:summary`)?.action).toBe("summary");
});

it("detail adds items, quantities, separate stages, documents and an intact official source", () => {
  const text = opportunityDetail(context);
  expect(text).toContain("*Productos y cantidades*"); expect(text).toContain("25 m²");
  expect(text).toContain("Registro de participantes: 5 de noviembre de 2026");
  expect(text).toContain("Presentación de ofertas: 7 de noviembre de 2026");
  expect(text).toContain("*Documentos publicados*\n• Bases integradas");
  expect(text).toContain(context.evidence!.documents[0]!.url);
  expect(text).toContain(context.evidence!.sourceUrl);
  expect(text).toContain("Monto por confirmar"); expect(text).not.toContain("Tipo IP");
  expect(text).not.toContain(context.alert.ocid);
});

it("does not invent missing quantities, delivery terms, stages or documents", () => {
  const text = opportunityDetail({ ...context, evidence: undefined });
  expect(text).toContain("no incluye el desglose"); expect(text).toContain("etapa por confirmar");
  expect(text).not.toContain("Presentación de ofertas:"); expect(text).not.toContain("25 m²");
  expect(text).toContain("No hay documentos adjuntos en la evidencia recibida");
  expect(text).toContain("pendientes de verificar en las bases"); expect(text).toContain("Busca: TEST-2026");
});

it("does not repeat a whole project title when the published item includes procurement boilerplate", () => {
  const description = "ADQUISICIÓN DE TABIQUERÍA DE DRYWALL DE PLACA DE FIBROCEMENTO Y LANA DE VIDRIO INCLUYE INSTALACIÓN A TODO COSTO, SEGÚN REQUERIMIENTO Y ESPECIFICACIONES TÉCNICAS PARA LA META: MEJORAMIENTO DE SERVICIO EDUCATIVO EN LA ESCUELA";
  const text = opportunityDetail({ ...context, evidence: { ...context.evidence!, items: [{ description, quantity: 789.92, unit: "M2" }] } });
  expect(text).toContain("INCLUYE INSTALACIÓN A TODO COSTO");
  expect(text).not.toContain("SEGÚN REQUERIMIENTO"); expect(text).not.toContain("PARA LA META:");
  expect(text).toMatch(/789[.,]92 M2/u);
});

it("maximum public facts fit a single text response without cutting documents or source", () => {
  const large = { ...context, alert: { ...context.alert, buyer: "Entidad".repeat(50), amount: "PEN " + "9".repeat(90) },
    evidence: { ...context.evidence!, items: Array.from({ length: 20 }, () => ({ description: "Producto ".repeat(60), quantity: 1e100, unit: "Unidad".repeat(10) })),
      documents: Array.from({ length: 6 }, () => ({ ...context.evidence!.documents[0]!, title: "Documento ".repeat(16) })) } };
  const text = opportunityDetail(large);
  expect(text.length).toBeLessThanOrEqual(3500);
  expect(text).toContain(large.evidence.sourceUrl); expect(text).toContain(large.evidence.documents[0]!.url);
  expect(text).toContain("Hay más ítems"); expect(text).toContain("Más documentos");
  const initial = friendlyAlertText(large.alert, "Buscan tabiquería de fibrocemento con instalación.\n\nPara mejorar una institución escolar.");
  expect(initial.length).toBeLessThanOrEqual(1024); expect(initial).toContain("*Entidad*");
});
