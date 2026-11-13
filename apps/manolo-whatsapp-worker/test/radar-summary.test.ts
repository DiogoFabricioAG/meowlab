import { expect, it } from "vitest";
import { summaryWithSource } from "../src/radar/action-answer";
import type { RadarAlertContext } from "../src/radar/presentation";

const context: RadarAlertContext = {
  alert: { ocid: "ocds-dgv273-seacev3-1262189", code: "TEST-2026", description: "Cemento Portland puzolánico tipo IP",
    buyer: "Gobierno Regional de Tacna", amount: "Monto por confirmar", deadline: "2026-11-07T04:59:00Z",
    sourceUrl: "https://contratacionesabiertas.oece.gob.pe" },
  evidence: { sourceUrl: "https://prod4.seace.gob.pe/openegocio/#/ficha/idProceso/tipo/1262189/2", observedAt: "2026-11-01T14:00:00Z",
    items: [{ description: "Cemento Portland puzolánico tipo IP", quantity: 106250, unit: "kg" }], documents: [],
    registrationDeadline: "2026-11-07T04:59:00Z" },
  sentAt: 0, expiresAt: 1,
};

it("renders short separated sections, factual quantity and stage, valid WhatsApp bold and intact source", () => {
  const text = summaryWithSource("Cemento tipo **IP* para conservar el área Vilacota Maure.", context);
  expect(text).toContain("*Qué compran*\nCemento tipo IP para conservar el área Vilacota Maure.\n\n*Cantidad*");
  expect(text).toMatch(/106[.,]250 kg/);
  expect(text).toContain("*Entidad*\nGobierno Regional de Tacna");
  expect(text).toMatch(/Registro de participantes: 6 nov\.? 2026/);
  expect(text).not.toContain("Presentación de ofertas");
  expect(text).not.toContain("**");
  expect(text.match(/\*/g)!.length % 2).toBe(0);
  expect(text.endsWith(context.evidence!.sourceUrl)).toBe(true);
  expect(text.length).toBeLessThanOrEqual(1024);
});

it("keeps dates and complete source with maximum evidence, long AI text, missing units and markup", () => {
  const large: RadarAlertContext = { ...context, alert: { ...context.alert, buyer: "Entidad ".repeat(40), amount: "Monto por confirmar" },
    evidence: { ...context.evidence!, items: Array.from({ length: 20 }, () => ({ description: "*Producto* ".repeat(30), quantity: 1e100, unit: null })),
      offerDeadline: "2026-11-09T04:59:00Z" } };
  const text = summaryWithSource("Texto generado sin estructura. ".repeat(200), large);
  expect(text.length).toBeLessThanOrEqual(1024);
  expect(text).toContain("(unidad por confirmar)");
  expect(text).toContain("Más ítems en la ficha.");
  expect(text).toContain("Presentación de ofertas");
  expect(text.endsWith(context.evidence!.sourceUrl)).toBe(true);
});

it("does not invent quantities or offer dates without evidence", () => {
  const text = summaryWithSource(context.alert.description, { ...context, evidence: undefined });
  expect(text).not.toContain("*Cantidad*");
  expect(text).not.toContain("Presentación de ofertas");
  expect(text).toContain("etapa por confirmar");
  expect(text).toContain("Busca: TEST-2026");
});
