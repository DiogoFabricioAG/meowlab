// Datos del titular para /privacidad y /terminos. Cuando MeowLab tenga RUC, agregar
// razonSocial, ruc y domicilio: las páginas los muestran sólo si existen.
export const legal: {
  nombre: string;
  razonSocial?: string;
  ruc?: string;
  domicilio?: string;
  correoPrivacidad: string;
  whatsapp: string;
  whatsappUrl: string;
  vigencia: string;
} = {
  nombre: "MeowLab",
  correoPrivacidad: "privacy@meowlab.tech",
  whatsapp: "+51 923 790 280",
  whatsappUrl: "https://wa.me/51923790280",
  vigencia: "11 de noviembre de 2026",
};

/** "MeowLab" o "Razón Social S.A.C. (RUC …), con domicilio en …" según lo que exista. */
export function titular(): string {
  if (!legal.razonSocial) return legal.nombre;
  const ruc = legal.ruc ? `, con RUC ${legal.ruc}` : "";
  const domicilio = legal.domicilio ? ` y domicilio en ${legal.domicilio}` : "";
  return `${legal.razonSocial}${ruc}${domicilio} («${legal.nombre}»)`;
}
