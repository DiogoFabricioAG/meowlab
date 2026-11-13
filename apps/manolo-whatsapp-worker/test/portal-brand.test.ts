import { describe, expect, it } from "vitest";
import { contrastWithWhite, imageInfo, validateBrandKit } from "../src/bridge/brand-contracts";
import { isPortalCompanyRequest } from "../src/bridge/portal-company-contracts";
import { PortalBrandService } from "../src/node/portal/brand-service";

const png = (width: number, height: number) => {
  const bytes = new Uint8Array(200);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
};

describe("brand kit contract", () => {
  it("normalizes a kit and rejects light colors", () => {
    const result = validateBrandKit({ primaryColor: "#0F3D2E", contactPhone: "  999  888 777 ", paymentMethods: [{ kind: "yape", label: "", value: "999888777" }], quoteValidDays: 15 });
    expect(result).toMatchObject({ ok: true, kit: { primaryColor: "#0f3d2e", contactPhone: "999 888 777", quoteValidDays: 15 } });
    expect(validateBrandKit({ primaryColor: "#ffd400" })).toEqual({ ok: false, problem: "color_contrast" });
    expect(validateBrandKit({ primaryColor: "verde" })).toEqual({ ok: false, problem: "invalid_color" });
    expect(validateBrandKit({ contactEmail: "no-es-correo" })).toEqual({ ok: false, problem: "invalid_email" });
    expect(validateBrandKit({ paymentMethods: [{ kind: "paypal", label: "x", value: "y" }] })).toEqual({ ok: false, problem: "invalid_field" });
    expect(validateBrandKit({ quoteValidDays: 120 })).toEqual({ ok: false, problem: "invalid_field" });
    expect(validateBrandKit({ footerText: "x".repeat(301) })).toEqual({ ok: false, problem: "invalid_field" });
    expect(contrastWithWhite("#000000")).toBeCloseTo(21, 0);
  });

  it("reads PNG and JPEG sizes from the bytes", () => {
    expect(imageInfo(png(400, 120))).toEqual({ mimeType: "image/png", width: 400, height: 120 });
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x50, 0x01, 0x40, 0x03, 0, 0, 0, 0]);
    expect(imageInfo(jpeg)).toEqual({ mimeType: "image/jpeg", width: 320, height: 80 });
    expect(imageInfo(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBeNull();
  });

  it("accepts brand requests only with a well-formed payload", () => {
    const base = { version: 1, requestId: "r1", portalUserId: "u1", tenantId: "org_1" };
    expect(isPortalCompanyRequest({ ...base, action: "brand_get" })).toBe(true);
    expect(isPortalCompanyRequest({ ...base, action: "brand_save", kit: {} })).toBe(true);
    expect(isPortalCompanyRequest({ ...base, action: "brand_save", kit: "x" })).toBe(false);
    expect(isPortalCompanyRequest({ ...base, action: "brand_logo_put", contentBase64: "AAAA" })).toBe(true);
    expect(isPortalCompanyRequest({ ...base, action: "brand_logo_put", contentBase64: "<script>" })).toBe(false);
    expect(isPortalCompanyRequest({ ...base, action: "brand_logo_put", contentBase64: "A".repeat(409_601) })).toBe(false);
  });
});

describe("PortalBrandService", () => {
  const pool = (role: "owner" | "member" | null) => {
    const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
    return {
      calls,
      async query(sql: string, values?: readonly unknown[]) {
        calls.push({ sql, values });
        if (sql.includes("portal_company_members")) return { rows: role ? [{ role }] : [] };
        if (sql.includes("FROM (SELECT $1::text AS tenant_id)")) return { rows: [{ tenant_id: null }] };
        return { rows: [] };
      },
    };
  };

  it("lets members read and only owners write", async () => {
    const member = pool("member");
    const service = new PortalBrandService(member, () => undefined);
    await expect(service.handle({ action: "brand_get", portalUserId: "u", tenantId: "t" }))
      .resolves.toMatchObject({ status: "ok", canEdit: false, brand: { primaryColor: null, logo: null, paymentMethods: [] } });
    await expect(service.handle({ action: "brand_save", portalUserId: "u", tenantId: "t", kit: {} })).resolves.toEqual({ status: "forbidden" });
    await expect(new PortalBrandService(pool(null), () => undefined).handle({ action: "brand_get", portalUserId: "u", tenantId: "t" }))
      .resolves.toEqual({ status: "forbidden" });
    expect(member.calls.some((call) => call.sql.includes("INSERT"))).toBe(false);
  });

  it("validates before saving and checks the logo bytes", async () => {
    const owner = pool("owner");
    const service = new PortalBrandService(owner, () => undefined);
    await expect(service.handle({ action: "brand_save", portalUserId: "u", tenantId: "t", kit: { primaryColor: "#ffffff" } }))
      .resolves.toEqual({ status: "invalid_brand", problem: "color_contrast" });
    await expect(service.handle({ action: "brand_save", portalUserId: "u", tenantId: "t", kit: { footerText: "Gracias" } }))
      .resolves.toMatchObject({ status: "ok", canEdit: true });
    const svg = Buffer.from("<svg>" + "x".repeat(200) + "</svg>").toString("base64");
    await expect(service.handle({ action: "brand_logo_put", portalUserId: "u", tenantId: "t", contentBase64: svg }))
      .resolves.toEqual({ status: "invalid_logo", problem: "format" });
    await expect(service.handle({ action: "brand_logo_put", portalUserId: "u", tenantId: "t", contentBase64: Buffer.from(png(5000, 10)).toString("base64") }))
      .resolves.toEqual({ status: "invalid_logo", problem: "dimensions" });
    await expect(service.handle({ action: "brand_logo_put", portalUserId: "u", tenantId: "t", contentBase64: Buffer.from(png(400, 120)).toString("base64") }))
      .resolves.toMatchObject({ status: "ok" });
    const insert = owner.calls.find((call) => call.sql.includes("INSERT INTO commerce.brand_logos"));
    expect(insert?.values?.slice(1, 5)).toEqual(["image/png", expect.any(Buffer), 400, 120]);
  });
});
