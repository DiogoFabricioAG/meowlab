import { describe, expect, it } from "vitest";
import { isLaterStage, partitionParticipationItems } from "./TenderDocuments";
import type { TenderData } from "./tenderApi";

describe("TenderDocuments participation list", () => {
  it("detects later-stage documents and excludes them from participation", () => {
    expect(isLaterStage("Entrega / Pago")).toBe(true);
    expect(isLaterStage("Perfeccionamiento de contrato")).toBe(true);
    expect(isLaterStage("Facultativo")).toBe(true);
    expect(isLaterStage("Oferta / Admisión")).toBe(false);
    expect(isLaterStage("Por confirmar")).toBe(false);
  });

  it("distinguishes platform drafts from user-supplied documents and deduplicates linked checks", () => {
    const data: TenderData = {
      status: "ready",
      generation: "gen-1",
      requirements: [],
      sourceCount: 1,
      missing: [],
      documents: [
        {
          id: "index",
          title: "00. Índice del expediente",
          body: "Índice",
          stage: "Organización del expediente",
          partial: false,
          evidence: [],
        },
        {
          id: "doc-anexo-1",
          title: "Anexo 1 — Declaración Jurada",
          body: "Contenido del Anexo 1",
          stage: "Oferta / Admisión",
          locator: "page:5 — page:6",
          partial: false,
          evidence: [{ sourceId: "s1", locator: "page:5", quote: "Anexo 1" }],
        },
        {
          id: "doc-contrato",
          title: "Proforma de contrato",
          body: "Contrato",
          stage: "Perfeccionamiento de contrato",
          partial: false,
          evidence: [{ sourceId: "s1", locator: "page:15", quote: "Contrato" }],
        },
      ],
      checks: [
        {
          id: "chk-1",
          text: "Anexo 1 — Declaración Jurada",
          title: "Anexo 1 — Declaración Jurada",
          stage: "Oferta / Admisión",
          documentId: "doc-anexo-1",
          evidence: [{ sourceId: "s1", locator: "page:5", quote: "Anexo 1" }],
        },
        {
          id: "chk-rnp",
          text: "Constancia vigente de RNP",
          title: "Constancia vigente de RNP",
          stage: "Oferta / Admisión",
          documentId: null,
          evidence: [{ sourceId: "s1", locator: "page:3", quote: "RNP vigente" }],
        },
        {
          id: "chk-rnp-dup",
          text: "Constancia vigente de RNP",
          title: "Constancia vigente de RNP",
          stage: "Oferta / Admisión",
          documentId: null,
          evidence: [{ sourceId: "s1", locator: "page:4", quote: "RNP" }],
        },
        {
          id: "chk-entrega",
          text: "Guía de Remisión y Factura",
          title: "Guía de Remisión y Factura",
          stage: "Entrega / Pago",
          documentId: null,
          evidence: [{ sourceId: "s1", locator: "page:18", quote: "Entrega" }],
        },
      ],
    };

    const { platformDrafts, savedDrafts, userDocuments } = partitionParticipationItems(data);
    expect(platformDrafts.map((d) => d.id)).toEqual(["index", "doc-anexo-1"]);
    expect(savedDrafts).toEqual([]);
    expect(userDocuments.map((c) => c.id)).toEqual(["chk-rnp"]);
  });

  it("handles bases without extracted formats and keeps saved historical drafts in auxiliary group", () => {
    const data: TenderData = {
      status: "partial",
      generation: "gen-2",
      requirements: [],
      sourceCount: 1,
      missing: ["Confirmar plazo de validez"],
      documents: [
        {
          id: "index",
          title: "00. Índice del expediente",
          body: "Índice",
          stage: "Organización del expediente",
          partial: true,
          evidence: [],
        },
        {
          id: "anexo1_datos",
          title: "02. Declaración Jurada de Datos del Postor (Anexo N° 1)",
          body: "Texto original",
          stage: "Trabajo guardado",
          partial: true,
          evidence: [],
        },
        {
          id: "legacy",
          title: "Borrador anterior",
          body: "Texto anterior",
          stage: "Trabajo guardado",
          partial: true,
          evidence: [],
        },
      ],
      checks: [
        {
          id: "chk-ficha",
          text: "Ficha técnica del fabricante",
          title: "Ficha técnica del fabricante",
          stage: "Por confirmar",
          documentId: null,
          evidence: [{ sourceId: "s1", locator: "page:2", quote: "Ficha técnica" }],
        },
      ],
    };

    const { platformDrafts, savedDrafts, userDocuments } = partitionParticipationItems(data);
    expect(platformDrafts.map((d) => d.id)).toEqual(["index"]);
    expect(savedDrafts.map((d) => d.id)).toEqual(["anexo1_datos", "legacy"]);
    expect(userDocuments.map((c) => c.id)).toEqual(["chk-ficha"]);
  });
});
