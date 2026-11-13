/**
 * A company's brand kit (ADR-0012, phase 1): what goes on all its documents. The portal and
 * the bridge validate with the same rules; required SUNAT data is never part of the kit.
 */
export const PAYMENT_KINDS = ["bank", "cci", "yape", "plin"] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];
export type PaymentEntry = { kind: PaymentKind; label: string; value: string };

export type BrandKit = {
  primaryColor: string | null;
  contactAddress: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  contactWeb: string | null;
  paymentMethods: PaymentEntry[];
  footerText: string | null;
  quoteValidDays: number | null;
  quotePaymentTerms: string | null;
  quoteDeliveryTerms: string | null;
};

export type BrandLogoInfo = { version: string; width: number; height: number };
export type BrandKitView = BrandKit & { logo: BrandLogoInfo | null; updatedAt: string | null };

export const EMPTY_BRAND_KIT: BrandKit = {
  primaryColor: null, contactAddress: null, contactPhone: null, contactEmail: null, contactWeb: null,
  paymentMethods: [], footerText: null, quoteValidDays: null, quotePaymentTerms: null, quoteDeliveryTerms: null,
};

export const MAX_LOGO_BYTES = 300 * 1024;
export const MIN_CONTRAST_WITH_WHITE = 4.5;

const channel = (value: number) => {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

/** WCAG contrast of a #rrggbb color against white text. */
export function contrastWithWhite(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  return 1.05 / (luminance + 0.05);
}

export type BrandKitProblem = "color_contrast" | "invalid_color" | "invalid_email" | "invalid_web" | "invalid_field";

const text = (value: unknown, max: number): string | null | undefined => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return trimmed.length <= max ? trimmed : undefined;
};

/** Normalizes a kit or says what is wrong with it. */
export function validateBrandKit(value: unknown): { ok: true; kit: BrandKit } | { ok: false; problem: BrandKitProblem } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, problem: "invalid_field" };
  const raw = value as Record<string, unknown>;
  const fields = {
    contactAddress: text(raw.contactAddress, 200),
    contactPhone: text(raw.contactPhone, 40),
    contactEmail: text(raw.contactEmail, 120),
    contactWeb: text(raw.contactWeb, 120),
    footerText: text(raw.footerText, 300),
    quotePaymentTerms: text(raw.quotePaymentTerms, 300),
    quoteDeliveryTerms: text(raw.quoteDeliveryTerms, 300),
  };
  if (Object.values(fields).some((field) => field === undefined)) return { ok: false, problem: "invalid_field" };
  let primaryColor: string | null = null;
  if (raw.primaryColor !== null && raw.primaryColor !== undefined && raw.primaryColor !== "") {
    if (typeof raw.primaryColor !== "string" || !/^#[0-9a-fA-F]{6}$/.test(raw.primaryColor)) return { ok: false, problem: "invalid_color" };
    primaryColor = raw.primaryColor.toLowerCase();
    if (contrastWithWhite(primaryColor) < MIN_CONTRAST_WITH_WHITE) return { ok: false, problem: "color_contrast" };
  }
  if (fields.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.contactEmail)) return { ok: false, problem: "invalid_email" };
  if (fields.contactWeb && !/^(https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(fields.contactWeb)) return { ok: false, problem: "invalid_web" };
  const methods = raw.paymentMethods ?? [];
  if (!Array.isArray(methods) || methods.length > 6) return { ok: false, problem: "invalid_field" };
  const paymentMethods: PaymentEntry[] = [];
  for (const method of methods) {
    const entry = method as Record<string, unknown>;
    const label = text(entry?.label, 60);
    const valueText = text(entry?.value, 60);
    if (!PAYMENT_KINDS.includes(entry?.kind as PaymentKind) || label === undefined || !valueText) return { ok: false, problem: "invalid_field" };
    paymentMethods.push({ kind: entry.kind as PaymentKind, label: label ?? "", value: valueText });
  }
  let quoteValidDays: number | null = null;
  if (raw.quoteValidDays !== null && raw.quoteValidDays !== undefined && raw.quoteValidDays !== "") {
    if (!Number.isInteger(raw.quoteValidDays) || Number(raw.quoteValidDays) < 1 || Number(raw.quoteValidDays) > 90) return { ok: false, problem: "invalid_field" };
    quoteValidDays = Number(raw.quoteValidDays);
  }
  return {
    ok: true,
    kit: {
      primaryColor,
      contactAddress: fields.contactAddress ?? null,
      contactPhone: fields.contactPhone ?? null,
      contactEmail: fields.contactEmail ?? null,
      contactWeb: fields.contactWeb ?? null,
      paymentMethods,
      footerText: fields.footerText ?? null,
      quoteValidDays,
      quotePaymentTerms: fields.quotePaymentTerms ?? null,
      quoteDeliveryTerms: fields.quoteDeliveryTerms ?? null,
    },
  };
}

/** PNG or JPEG dimensions from the file itself; null when it is neither or is malformed. */
export function imageInfo(bytes: Uint8Array): { mimeType: "image/png" | "image/jpeg"; width: number; height: number } | null {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { mimeType: "image/png", width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1];
      const length = (bytes[offset + 2] << 8) + bytes[offset + 3];
      // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the size.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { mimeType: "image/jpeg", height: (bytes[offset + 5] << 8) + bytes[offset + 6], width: (bytes[offset + 7] << 8) + bytes[offset + 8] };
      }
      offset += 2 + length;
    }
  }
  return null;
}
