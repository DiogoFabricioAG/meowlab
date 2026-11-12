// Datos del responsable para /privacidad y /terminos. Completar ANTES de publicar:
// Google y la Ley 29733 exigen identificar al titular del servicio.
export const legal = {
  /** Razón social o nombre del titular, tal como figura en SUNAT. */
  razonSocial: "PENDIENTE: razón social",
  /** RUC del titular. */
  ruc: "PENDIENTE: RUC",
  /** Domicilio fiscal. */
  domicilio: "PENDIENTE: domicilio",
  /** Correo para consultas y derechos sobre datos personales. */
  correoPrivacidad: "PENDIENTE: correo de privacidad",
  /** WhatsApp público de MeowLab (el mismo de la landing). */
  whatsapp: "+51 923 790 280",
  whatsappUrl: "https://wa.me/51923790280",
  /** Fecha de la versión vigente de ambos documentos. */
  vigencia: "11 de noviembre de 2026",
};

export const legalPending = Object.values(legal).some((value) => value.startsWith("PENDIENTE"));
