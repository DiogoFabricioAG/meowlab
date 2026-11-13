import { describe, expect, it } from "vitest";
import { districtByCode, findDistricts } from "../src/geography/ubigeo";
import { UBIGEO_CATALOG } from "../src/geography/ubigeo-catalog";

describe("official INEI district lookup", () => {
  it("keeps unique six-digit district codes with department and province names", () => {
    expect(UBIGEO_CATALOG.length).toBe(1893);
    expect(new Set(UBIGEO_CATALOG.map(r => r[0])).size).toBe(1893);
    expect(UBIGEO_CATALOG.every(([code, department, province, district]) => /^\d{6}$/.test(code) && department && province && district)).toBe(true);
  });
  it("resolves normalized place names and does not choose a homonym silently", () => {
    expect(findDistricts({ district: "Miraflores" }).length).toBeGreaterThan(1);
    expect(findDistricts({ district: " miraflores ", province: "LIMA", department: "Lima" })).toEqual([
      { code: "150122", department: "Lima", province: "Lima", district: "Miraflores" },
    ]);
    expect(findDistricts({ district: "Miraflores", department: "Lima" }).length).toBeGreaterThan(1);
    expect(districtByCode("999999")).toBeUndefined();
    expect(findDistricts({ district: "Lugar inventado", department: "Lima" })).toEqual([]);
  });
});
