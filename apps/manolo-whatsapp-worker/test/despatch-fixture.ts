import { peruDate, type DespatchPayload, type FacturayaDespatch } from "../src/facturaya/despatch-contracts";

// Laravel 13 serializes ULIDs in lowercase; keep transport tests realistic.
export const invoiceId = "01k37h3cax3jjrkrv6hk7z6r4p";
export const guideId = "01k37h3cax3jjrkrv6hk7z6r4q";
export const despatchPayload: DespatchPayload = {
  vehicle_category: "other",
  invoice_id: invoiceId, issue_date: peruDate(), transfer_date: "2027-12-05",
  origin: { ubigeo: "150101", address: "Calle Uno 123 Lima" },
  destination: { ubigeo: "150132", address: "Calle Dos 456 Lima" }, weight_kg: "25.500",
  vehicle: { plate: "ABC123" }, driver: { dni: "12345678", first_name: "Juan", last_name: "Pérez", license: "Q12345678" },
  items: [{ description: "Chalecos", quantity: "4", unit: "NIU" }],
};
export const guideDraft: FacturayaDespatch = { id: guideId, confirmation_digest: "a".repeat(64),
  payload: despatchPayload, status: "draft", series: "T001", environment: "beta", is_demo: true };
export const fullDespatchText = `Emisión ${despatchPayload.issue_date}, traslado 2027-12-05. Partida Calle Uno 123 Lima ubigeo 150101.
Llegada Calle Dos 456 Lima ubigeo 150132. Peso 25.500 kg, placa ABC123, conductor Juan Pérez DNI 12345678 licencia Q12345678.
Bienes: 4 unidades NIU de Chalecos.`;
