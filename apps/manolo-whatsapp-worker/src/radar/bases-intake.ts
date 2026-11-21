import type { IncomingDocument } from "../documents/contracts";
import type { RoleHandlerContext } from "../roles/contracts";

const MAX_BASES_BYTES = 15 * 1024 * 1024;
const PDF_MIME = "application/pdf";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function sanitizeFilename(raw: string, ext: "pdf" | "docx"): string {
  const suffix = `.${ext}`;
  const base = raw.split(/[/\\]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f<>:"|?*]/gu, "").replace(/\s+/gu, " ").trim();
  if (!cleaned) return `bases${suffix}`;
  const stem = cleaned.toLowerCase().endsWith(suffix)
    ? cleaned.slice(0, -suffix.length).trim()
    : cleaned;
  if (!stem) return `bases${suffix}`;
  return `${stem.slice(0, 180 - suffix.length)}${suffix}`;
}

export function validateBasesBinary(document: IncomingDocument): {
  filename: string;
  mimeType: string;
} | null {
  const bytes = document.bytes;
  if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_BASES_BYTES) return null;

  const rawName = (document.filename || "").trim();
  const lower = rawName.toLowerCase();
  const mime = (document.mimeType || "").split(";")[0]!.trim().toLowerCase();

  const isPdfSignature = bytes.byteLength >= 5
    && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
  const isZipSignature = bytes.byteLength >= 4
    && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

  const wantsPdf = lower.endsWith(".pdf") || (!lower.includes(".") && mime === PDF_MIME);
  const wantsDocx = lower.endsWith(".docx") || (!lower.includes(".") && mime === DOCX_MIME);

  if (wantsPdf && isPdfSignature) {
    return { filename: sanitizeFilename(rawName, "pdf"), mimeType: PDF_MIME };
  }
  if (wantsDocx && isZipSignature) {
    return { filename: sanitizeFilename(rawName, "docx"), mimeType: DOCX_MIME };
  }
  return null;
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type BasesIntakeOutcome = {
  reply: string | null;
  deliveryId?: string;
};

/**
 * Handle an incoming WhatsApp document for Tender Cat before any AI/fallback flow.
 * Never returns raw SEACE descriptions; validates binary headers, resolves the target
 * delivery, stores bytes temporarily in R2 + D1 queue, and confirms warmly.
 */
export async function handleRadarDocumentIntake(
  context: RoleHandlerContext,
  memoryDeliveryId?: string | null,
): Promise<BasesIntakeOutcome> {
  if (!context.document) {
    return {
      reply: "No pude recibir ese archivo. Envíame las bases en PDF o Word (.docx) de hasta 15 MB y sin contraseña.",
    };
  }

  const validated = validateBasesBinary(context.document);
  if (!validated) {
    return {
      reply: "Ese archivo no parece un PDF ni un Word (.docx) válido. Envíame las bases en PDF o .docx de hasta 15 MB y sin contraseña.",
    };
  }

  if (!context.radar?.resolveAcceptedDelivery || !context.radar?.enqueueBasesUpload) {
    return {
      reply: "La recepción de bases por WhatsApp no está disponible en este momento. Puedes subirlas desde la plataforma.",
    };
  }

  const resolution = await context.radar.resolveAcceptedDelivery(memoryDeliveryId ?? null, context.message.text || null);
  if (resolution.status === "none") {
    return {
      reply: "Todavía no tengo una convocatoria asociada para guardar estas bases. Toca «Me interesa» en el aviso de la licitación o indícame su código antes de enviar el archivo.",
    };
  }
  if (resolution.status === "ambiguous") {
    const codes = resolution.candidates.slice(0, 3).map((candidate) => candidate.code).join(", ");
    return {
      reply: `Tengo más de una convocatoria reciente en este chat (${codes}). Toca «Me interesa» en el aviso que corresponde o responde con el código exacto antes de reenviar el documento.`,
    };
  }

  const { delivery } = resolution;
  const metaMessageId = context.message.id || `doc-${crypto.randomUUID()}`;
  const sha256 = await sha256Bytes(context.document.bytes);
  const stored = await context.radar.enqueueBasesUpload({
    deliveryId: delivery.deliveryId,
    ocid: delivery.ocid,
    code: delivery.code,
    metaMessageId,
    filename: validated.filename,
    mimeType: validated.mimeType,
    bytes: context.document.bytes,
    sha256,
  });

  if (stored.status === "duplicate") {
    return { reply: null, deliveryId: delivery.deliveryId };
  }
  if (stored.status !== "stored") {
    return {
      reply: "No pude guardar temporalmente este documento. Intenta reenviarlo en unos minutos o súbelo desde la plataforma.",
    };
  }

  return {
    reply: `¡Recibido! Guardé «${validated.filename}» para la convocatoria ${delivery.code}. Te avisaré por este mismo chat cuando termine el análisis.`,
    deliveryId: delivery.deliveryId,
  };
}
