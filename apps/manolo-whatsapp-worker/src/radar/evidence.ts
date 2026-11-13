export type RadarEvidence = {
  sourceUrl: string; observedAt: string;
  items: { description: string; quantity: number | null; unit: string | null }[];
  documents: { title: string; url: string }[];
  registrationDeadline?: string; offerDeadline?: string;
};

export function validateEvidence(value: unknown, ocid: string): RadarEvidence | null {
  if (!value || typeof value !== "object") return null;
  const v = value as RadarEvidence;
  const id = /-(\d{1,18})$/.exec(ocid)?.[1];
  if (!id || v.sourceUrl !== `https://prod4.seace.gob.pe/openegocio/#/ficha/idProceso/tipo/${id}/2`
    || typeof v.observedAt !== "string" || !Number.isFinite(Date.parse(v.observedAt))
    || !Array.isArray(v.items) || v.items.length > 20 || !Array.isArray(v.documents) || v.documents.length > 6) return null;
  const text = (s: unknown, max: number) => typeof s === "string" && s.trim().length > 0 && s.length <= max && !/[\u0000-\u001f]/u.test(s);
  if (v.items.some(i => !i || !text(i.description, 500) || (i.quantity !== null && (typeof i.quantity !== "number" || !Number.isFinite(i.quantity) || i.quantity <= 0))
    || (i.unit !== null && !text(i.unit, 60)))) return null;
  if (v.documents.some(d => !d || !text(d.title, 160) || typeof d.url !== "string"
    || !/^https:\/\/prod1\.seace\.gob\.pe\/SeaceWeb-PRO\/SdescargarArchivoAlfresco\?fileCode=[a-f0-9-]{36}$/i.test(d.url))) return null;
  for (const key of ["registrationDeadline", "offerDeadline"] as const) {
    if (v[key] !== undefined && (typeof v[key] !== "string" || !Number.isFinite(Date.parse(v[key]!)))) return null;
  }
  return { sourceUrl: v.sourceUrl, observedAt: v.observedAt,
    items: v.items.map(i => ({ description: i.description, quantity: i.quantity, unit: i.unit })),
    documents: v.documents.map(d => ({ title: d.title, url: d.url })),
    ...(v.registrationDeadline ? { registrationDeadline: v.registrationDeadline } : {}),
    ...(v.offerDeadline ? { offerDeadline: v.offerDeadline } : {}) };
}
