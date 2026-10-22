export const RADAR_API_PATH = "/v1/projects/radar";
export type RadarSettings = { enabled: number; phone_number_id: string; public_number: string };
export type RadarInstallation = {
  id: string; token_hash: string; phone_number_id: string; recipient: string | null;
  opted_in_at: number | null; revoked_at: number | null;
};
export type RadarAlert = {
  ocid: string; code: string; description: string; buyer: string;
  amount: string; deadline: string; sourceUrl: string;
};
export type RadarSendResult = { status: "accepted" | "unknown" | "rejected" | "window_closed"; replayed?: boolean };

export async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function randomSecret(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function validateAlert(value: unknown): RadarAlert | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const limits = { ocid: 200, code: 200, description: 800, buyer: 300, amount: 100, deadline: 100, sourceUrl: 1000 };
  const output: Record<string, string> = {};
  for (const [key, max] of Object.entries(limits)) {
    if (typeof input[key] !== "string" || !input[key].trim() || input[key].length > max || /[\u0000-\u001f]/.test(input[key])) return null;
    output[key] = input[key].trim();
  }
  const url = new URL(output.sourceUrl!);
  const seace = "https://prod2.seace.gob.pe/seacebus-uiwd-pub/buscadorPublico/buscadorPublico.xhtml";
  const contracting = "https://contratacionesabiertas.oece.gob.pe";
  const validSource = output.sourceUrl === seace || output.sourceUrl === contracting
    || output.sourceUrl === `${contracting}/proceso/${encodeURIComponent(output.ocid!)}`;
  if (!validSource || url.username || url.password) return null;
  return output as RadarAlert;
}
export function alertText(alert: RadarAlert): string {
  return ["RADAR · Convocatoria compatible", alert.code, alert.description, alert.buyer,
    alert.amount, `Plazo: ${alert.deadline}`, alert.sourceUrl, `OCID: ${alert.ocid}`].join("\n");
}
