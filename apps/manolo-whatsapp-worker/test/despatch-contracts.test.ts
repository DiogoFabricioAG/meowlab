import { describe, expect, it } from "vitest";
import { despatchProblems, parseCreateDespatch, parseDespatchResponse } from "../src/facturaya/despatch-contracts";
import { despatchPayload, guideDraft } from "./despatch-fixture";

describe("GRE private contract", () => {
  it.each(["M1", "L"] as const)("serializes %s without vehicle and driver, rejecting stale details", (category) => {
    const { vehicle: _vehicle, driver: _driver, ...payload } = despatchPayload;
    const input = { ...payload, vehicle_category: category, idempotency_key: "gre:category" };
    expect(parseCreateDespatch(input)).toEqual(input);
    expect(parseDespatchResponse({ ...guideDraft, payload: input })).not.toBeNull();
    expect(parseCreateDespatch({ ...input, vehicle: { plate: "ABC123" } })).toBeNull();
    expect(parseCreateDespatch({ ...input, driver: despatchPayload.driver })).toBeNull();
  });
  it("preserves legacy validation when category is absent and rejects unknown categories", () => {
    const { vehicle_category: _category, ...legacy } = despatchPayload;
    expect(parseCreateDespatch({ ...legacy, idempotency_key: "gre:legacy" })).not.toBeNull();
    expect(parseCreateDespatch({ ...legacy, vehicle: undefined, idempotency_key: "gre:legacy" })).toBeNull();
    expect(parseCreateDespatch({ ...despatchPayload, vehicle_category: "camioneta", idempotency_key: "gre:invalid" })).toBeNull();
  });
  it("accepts only complete, explicit private-sale payloads", () => {
    expect(parseCreateDespatch({ ...despatchPayload, idempotency_key: "gre:revision-1" })).toMatchObject(despatchPayload);
    expect(parseDespatchResponse(guideDraft)).toMatchObject({ is_demo: true, status: "draft" });
  });
  it.each([
    { invoice_id: "arbitrary-id" }, { issue_date: "2999-12-05" }, { issue_date: "2026-02-30" },
    { transfer_date: "2025-12-05" }, { transfer_date: "05 diciembre" }, { weight_kg: "0" },
    { weight_kg: "1.0001" }, { weight_kg: 25 }, { origin: { ubigeo: "1", address: "Lima" } },
    { destination: { ubigeo: "150132", address: "" } }, { vehicle: { plate: "ABC-123" } },
    { driver: { ...despatchPayload.driver, dni: "123" } }, { driver: { ...despatchPayload.driver, license: "" } },
    { items: [] }, { items: [{ description: "Bien", quantity: "4", unit: "CJA" }] },
    { company_id: "other-company" }, { environment: "production" }, { reason_code: "other" }, { transport_mode: "01" },
  ])("rejects invalid or prohibited input %j", (patch) => {
    expect(parseCreateDespatch({ ...despatchPayload, idempotency_key: "gre:revision-1", ...patch })).toBeNull();
  });
  it("checks guide date against selected invoice and does not accept absent simulation metadata", () => {
    expect(despatchProblems(despatchPayload, "2999-01-01").length).toBeGreaterThan(0);
    expect(parseDespatchResponse({ ...guideDraft, is_demo: undefined })).toBeNull();
    expect(parseDespatchResponse({ ...guideDraft, confirmation_digest: "wrong" })).toBeNull();
  });
});
