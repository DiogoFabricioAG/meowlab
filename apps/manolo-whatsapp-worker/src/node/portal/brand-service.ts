import { createHash } from "node:crypto";
import {
  EMPTY_BRAND_KIT,
  MAX_LOGO_BYTES,
  imageInfo,
  validateBrandKit,
  type BrandKitView,
  type PaymentEntry,
} from "../../bridge/brand-contracts";
import type { PortalCompanyResponse } from "../../bridge/portal-company-contracts";
import type { RoleLog } from "../../roles/contracts";

type Rows = { rows: Array<Record<string, unknown>> };
export type BrandPool = { query(sql: string, values?: readonly unknown[]): Promise<unknown> };

export type BrandRequest =
  | { action: "brand_get"; portalUserId: string; tenantId: string }
  | { action: "brand_save"; portalUserId: string; tenantId: string; kit: unknown }
  | { action: "brand_logo_put"; portalUserId: string; tenantId: string; contentBase64: string }
  | { action: "brand_logo_delete"; portalUserId: string; tenantId: string }
  | { action: "brand_logo_get"; portalUserId: string; tenantId: string };

const KIT_SQL = `
  SELECT kit.*, logo.sha256 AS logo_sha256, logo.width AS logo_width, logo.height AS logo_height,
         GREATEST(kit.updated_at, logo.updated_at) AS changed_at
    FROM (SELECT $1::text AS tenant_id) AS wanted
    LEFT JOIN commerce.brand_kits AS kit ON kit.tenant_id = wanted.tenant_id
    LEFT JOIN commerce.brand_logos AS logo ON logo.tenant_id = wanted.tenant_id`;

const optional = (value: unknown) => (typeof value === "string" && value ? value : null);

/** Kit as stored (or empty), with the logo's version for caching. */
export function brandView(row: Record<string, unknown> | undefined): BrandKitView {
  if (!row) return { ...EMPTY_BRAND_KIT, logo: null, updatedAt: null };
  const methods = Array.isArray(row.payment_methods) ? row.payment_methods as PaymentEntry[] : [];
  const changed = row.changed_at ?? row.updated_at;
  return {
    primaryColor: optional(row.primary_color),
    contactAddress: optional(row.contact_address),
    contactPhone: optional(row.contact_phone),
    contactEmail: optional(row.contact_email),
    contactWeb: optional(row.contact_web),
    paymentMethods: methods,
    footerText: optional(row.footer_text),
    quoteValidDays: row.quote_valid_days === null || row.quote_valid_days === undefined ? null : Number(row.quote_valid_days),
    quotePaymentTerms: optional(row.quote_payment_terms),
    quoteDeliveryTerms: optional(row.quote_delivery_terms),
    logo: row.logo_sha256
      ? { version: String(row.logo_sha256).slice(0, 16), width: Number(row.logo_width), height: Number(row.logo_height) }
      : null,
    updatedAt: changed ? new Date(changed as string | Date).toISOString() : null,
  };
}

/** Reads a company's kit; shared with the public quote. */
export async function loadBrandKit(pool: BrandPool, tenantId: string): Promise<BrandKitView> {
  const { rows } = await pool.query(KIT_SQL, [tenantId]) as Rows;
  const row = rows[0];
  // The LEFT JOINs always return one row; it is empty when nothing was saved.
  return row && (row.tenant_id || row.logo_sha256) ? brandView(row) : brandView(undefined);
}

/**
 * The company's brand kit (ADR-0012, phase 1). Any member sees it; only owners change it.
 * The logo arrives already reduced by the browser and is checked again here.
 */
export class PortalBrandService {
  constructor(private readonly pool: BrandPool, private readonly log: RoleLog) {}

  private async role(portalUserId: string, tenantId: string): Promise<"owner" | "member" | null> {
    const { rows } = await this.pool.query(
      `SELECT member.role FROM whatsapp.portal_company_members AS member
         JOIN whatsapp.tenants AS tenant ON tenant.id = member.tenant_id AND tenant.status = 'active'
        WHERE member.tenant_id = $1 AND member.portal_user_id = $2`,
      [tenantId, portalUserId],
    ) as Rows;
    const role = rows[0]?.role;
    return role === "owner" ? "owner" : role === "member" ? "member" : null;
  }

  async handle(request: BrandRequest): Promise<PortalCompanyResponse> {
    const role = await this.role(request.portalUserId, request.tenantId);
    if (!role) return { status: "forbidden" };
    const ok = async (): Promise<PortalCompanyResponse> => ({
      status: "ok", brand: await loadBrandKit(this.pool, request.tenantId), canEdit: role === "owner",
    });
    if (request.action === "brand_get") return ok();
    if (request.action === "brand_logo_get") {
      const { rows } = await this.pool.query(
        "SELECT mime_type, content, sha256 FROM commerce.brand_logos WHERE tenant_id = $1",
        [request.tenantId],
      ) as Rows;
      const logo = rows[0];
      if (!logo) return { status: "not_found" };
      return {
        status: "ok",
        logo: { mimeType: String(logo.mime_type), contentBase64: Buffer.from(logo.content as Uint8Array).toString("base64"),
          version: String(logo.sha256).slice(0, 16) },
      };
    }
    if (role !== "owner") return { status: "forbidden" };

    if (request.action === "brand_save") {
      const checked = validateBrandKit(request.kit);
      if (!checked.ok) return { status: "invalid_brand", problem: checked.problem };
      const kit = checked.kit;
      await this.pool.query(
        `INSERT INTO commerce.brand_kits (tenant_id, primary_color, contact_address, contact_phone, contact_email, contact_web,
           payment_methods, footer_text, quote_valid_days, quote_payment_terms, quote_delivery_terms, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
         ON CONFLICT (tenant_id) DO UPDATE SET
           primary_color = EXCLUDED.primary_color, contact_address = EXCLUDED.contact_address,
           contact_phone = EXCLUDED.contact_phone, contact_email = EXCLUDED.contact_email, contact_web = EXCLUDED.contact_web,
           payment_methods = EXCLUDED.payment_methods, footer_text = EXCLUDED.footer_text,
           quote_valid_days = EXCLUDED.quote_valid_days, quote_payment_terms = EXCLUDED.quote_payment_terms,
           quote_delivery_terms = EXCLUDED.quote_delivery_terms, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
        [request.tenantId, kit.primaryColor, kit.contactAddress, kit.contactPhone, kit.contactEmail, kit.contactWeb,
          JSON.stringify(kit.paymentMethods), kit.footerText, kit.quoteValidDays, kit.quotePaymentTerms, kit.quoteDeliveryTerms,
          request.portalUserId],
      );
      this.log("portal_brand_saved");
      return ok();
    }

    if (request.action === "brand_logo_delete") {
      await this.pool.query("DELETE FROM commerce.brand_logos WHERE tenant_id = $1", [request.tenantId]);
      this.log("portal_brand_logo_deleted");
      return ok();
    }

    const bytes = Buffer.from(request.contentBase64, "base64");
    if (bytes.length < 100 || bytes.length > MAX_LOGO_BYTES) return { status: "invalid_logo", problem: "size" };
    const info = imageInfo(bytes);
    if (!info) return { status: "invalid_logo", problem: "format" };
    if (info.width < 16 || info.height < 16 || info.width > 1200 || info.height > 1200) {
      return { status: "invalid_logo", problem: "dimensions" };
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await this.pool.query(
      `INSERT INTO commerce.brand_logos (tenant_id, mime_type, content, width, height, sha256, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
       ON CONFLICT (tenant_id) DO UPDATE SET mime_type = EXCLUDED.mime_type, content = EXCLUDED.content,
         width = EXCLUDED.width, height = EXCLUDED.height, sha256 = EXCLUDED.sha256,
         updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
      [request.tenantId, info.mimeType, bytes, info.width, info.height, sha256, request.portalUserId],
    );
    this.log("portal_brand_logo_saved");
    return ok();
  }
}
