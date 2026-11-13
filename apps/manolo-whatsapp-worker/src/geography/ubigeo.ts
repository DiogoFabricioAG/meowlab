import { UBIGEO_CATALOG } from "./ubigeo-catalog";

export type DistrictName = { department?: string; province?: string; district?: string };
export type District = { code: string; department: string; province: string; district: string };
const key = (name: string) => name.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es").trim().replace(/\s+/g, " ");
const districts = UBIGEO_CATALOG.map(([code, department, province, district]) => ({ code, department, province, district }));

// Matches structured names interpreted by the model, never parses a user message.
export function findDistricts(names: DistrictName): readonly District[] {
  if (!names.district?.trim()) return [];
  return districts.filter(row => key(row.district) === key(names.district!)
    && (!names.province?.trim() || key(row.province) === key(names.province))
    && (!names.department?.trim() || key(row.department) === key(names.department)));
}
export function districtByCode(code: string): District | undefined {
  return districts.find(row => row.code === code);
}
