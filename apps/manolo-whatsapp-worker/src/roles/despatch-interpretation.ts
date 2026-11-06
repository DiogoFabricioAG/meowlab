import type { DespatchState } from "./enterprise-despatch";
import { parseDespatchPayload, positiveDecimal3 } from "../facturaya/despatch-contracts";
import { isFullDate } from "../facturaya/payment-terms";
import { districtByCode, findDistricts, type DistrictName } from "../geography/ubigeo";

const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function mergeInterpretedDespatch(state: DespatchState, result: Record<string, unknown>, message: string): DespatchState {
  const next = structuredClone(state);
  next.revision++; next.phase = "collecting"; next.guide = undefined; next.confirmation = undefined; next.createKey = undefined;
  next.evidence = `${state.evidence}\n${message}`.trim().slice(-20_000);
  next.questions ??= {}; next.locations ??= {};
  delete next.errors.update; delete next.errors.fechas;
  const patch = record(result.patch) ? result.patch : {};
  const sources = record(result.source_evidence) ? result.source_evidence : {};
  const resolvedLocations = new Set<string>();
  const supported = (path: string) => typeof sources[path] === "string" && sources[path].trim().length > 0
    && sources[path].length <= 1000 && next.evidence.includes(sources[path].trim());
  const ask = (path: string, question: string) => { next.questions![path] = question; next.errors[path] = "pending_clarification"; };
  const clear = (path: string) => { delete next.questions![path]; delete next.errors[path]; };
  const set = (target: Record<string, unknown>, key: string, path: string, value: unknown, valid: (v: string) => boolean, question: string) => {
    if (value == null) return;
    const text = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
    if (!supported(path) || !valid(text)) { ask(path, question); return; }
    target[key] = text; clear(path);
  };
  set(next.fields, "issue_date", "issue_date", patch.issue_date, isFullDate, "¿Qué fecha de emisión deseas para la guía?");
  if (patch.issue_date != null && !next.errors.issue_date) delete next.errors["fecha de emisión"];
  set(next.fields, "transfer_date", "transfer_date", patch.transfer_date, isFullDate, "¿Cuándo comenzará el traslado?");
  if (patch.transfer_date != null && !next.errors.transfer_date) delete next.errors["fecha de traslado"];
  set(next.fields, "weight_kg", "weight_kg", patch.weight_kg, positiveDecimal3, "¿Cuál es el peso total en kilos?");
  if (patch.weight_kg != null && !next.errors.weight_kg) delete next.errors["peso en kg"];

  for (const endpoint of ["origin", "destination"] as const) {
    const supplied = record(patch[endpoint]) ? patch[endpoint] : {};
    const field = next.fields[endpoint];
    set(field, "address", `${endpoint}.address`, supplied.address, v => v.length > 0 && v.length <= 500,
      endpoint === "origin" ? "¿Cuál es la dirección exacta del punto de partida?" : "¿Cuál es la dirección exacta de entrega?");
    const location = record(result.locations) && record(result.locations[endpoint]) ? result.locations[endpoint] : undefined;
    if (location && supported(`locations.${endpoint}`)) {
      const names: DistrictName = { ...next.locations[endpoint] };
      if (typeof location.department === "string" && names.department && location.department !== names.department && location.province == null) delete names.province;
      for (const key of ["department", "province", "district"] as const) if (typeof location[key] === "string" && location[key].trim()) names[key] = location[key].trim().slice(0, 100);
      next.locations[endpoint] = names;
      const matches = findDistricts(names);
      if (matches.length === 1) {
        if (field.ubigeo && field.ubigeo !== matches[0].code && field.address && supplied.address == null)
          ask(`${endpoint}.address`, `¿Se mantiene la dirección ${field.address} para ${matches[0].district}, ${matches[0].province}?`);
        field.ubigeo = matches[0].code; clear(`${endpoint}.location`); clear(`${endpoint}.ubigeo`);
        resolvedLocations.add(`${endpoint}.location`);
        next.locations[endpoint] = { department: matches[0].department, province: matches[0].province, district: matches[0].district };
      } else {
        field.ubigeo = "";
        const examples = matches.slice(0, 4).map(m => `${m.province}, ${m.department}`).join("; ");
        ask(`${endpoint}.location`, matches.length > 1
          ? `Hay varios distritos llamados ${names.district}. ¿En qué provincia y departamento está?${examples ? ` Opciones: ${examples}.` : ""}`
          : "¿En qué distrito, provincia y departamento queda ese punto? No necesitas saber el ubigeo.");
      }
    } else if (supplied.ubigeo != null) {
      // A directly supplied code is a lookup key, never a code invented by the model.
      const code = String(supplied.ubigeo);
      const entry = districtByCode(code);
      if (entry && sources[`${endpoint}.ubigeo`] === code && supported(`${endpoint}.ubigeo`)) {
        if (field.ubigeo && field.ubigeo !== code && field.address && supplied.address == null)
          ask(`${endpoint}.address`, `¿Se mantiene la dirección ${field.address} para ${entry.district}, ${entry.province}?`);
        field.ubigeo = code; next.locations[endpoint] = { department: entry.department, province: entry.province, district: entry.district };
        clear(`${endpoint}.ubigeo`); clear(`${endpoint}.location`);
        resolvedLocations.add(`${endpoint}.location`);
      } else ask(`${endpoint}.location`, "Dime el distrito, provincia y departamento; buscaré su código por ti.");
    }
  }
  for (const name of ["vehicle", "driver"] as const) {
    const target = next.fields[name]; const supplied = patch[name];
    if (!target || !record(supplied)) continue;
    for (const key of Object.keys(target)) set(target, key, `${name}.${key}`, supplied[key], v => v.length > 0 && v.length <= 100,
      name === "vehicle" ? "¿Cuál es la placa principal?" : "Indícame el dato del conductor que deseas completar.");
  }
  if (patch.items != null) {
    const candidate = parseDespatchPayload({ ...next.fields, items: patch.items });
    if (supported("items") && candidate && candidate.items.length > 0 && candidate.items.every(item => positiveDecimal3(item.quantity) && item.description.trim())) {
      next.fields.items = candidate.items; clear("items");
    } else ask("items", "¿Qué productos y cantidades deseas cambiar respecto de la factura?");
  }
  if (Array.isArray(result.clarifications)) for (const value of result.clarifications.slice(0, 8)) {
    if (!record(value) || typeof value.field !== "string" || typeof value.question !== "string" || !value.question.trim()) continue;
    if (next.fields.vehicle_category !== "other" && (value.field.startsWith("driver.") || value.field.startsWith("vehicle."))) continue;
    if (resolvedLocations.has(value.field)) continue;
    if (["issue_date", "transfer_date", "weight_kg", "origin.address", "origin.location", "destination.address", "destination.location", "items", "vehicle.plate",
      "driver.dni", "driver.first_name", "driver.last_name", "driver.license"].includes(value.field)) ask(value.field, value.question.trim().slice(0, 500));
  }
  return next;
}
