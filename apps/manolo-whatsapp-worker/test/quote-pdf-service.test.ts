import { describe, expect, it, vi } from "vitest";
import { isSalesBridgeRequest } from "../src/sales/bridge-contracts";
import { FacturayaQuotePdfRenderer, QuotePdfService, QuotePdfUnavailable } from "../src/node/sales/quote-pdf-service";

const PDF = new TextEncoder().encode("%PDF-1.4 ".padEnd(200, "x"));

function pool(stored: Uint8Array | null, quote = true) {
  const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
  return {
    calls,
    async query(sql: string, values?: readonly unknown[]) {
      calls.push({ sql, values });
      if (sql.includes("FROM sales.quotes AS quote")) {
        return { rows: quote ? [{ id: "q1", tenant_id: "org_jd", number: 7, customer_name: "Comercial Lima", issue_date: "2026-11-13",
          valid_until: "2026-11-20", subtotal_cents: 24500, discount_cents: 1500, total_cents: 23000, notes: null,
          company_name: "CREACIONES J&D", legal_name: null, ruc: "10410461248", address: null, doc_type: "6", doc_number: "20207341241",
          content: stored }] : [] };
      }
      if (sql.includes("FROM sales.lines")) return { rows: [{ description: "Volantes", quantity: 1000, unit_price_cents: 15, line_total_cents: 15000 }] };
      if (sql.includes("INSERT INTO sales.quote_files")) return { rows: [{ quote_id: "q1" }] };
      return { rows: [] };
    },
  };
}

describe("QuotePdfService (ADR-0013)", () => {
  it("draws the PDF once and keeps it", async () => {
    const db = pool(null);
    const render = vi.fn(async () => PDF);
    const service = new QuotePdfService(db, { render }, () => undefined);
    const pdf = await service.byToken("AbCdEfGhIjKlMnOpQrStUv");
    expect(pdf).toMatchObject({ number: 7, filename: "Cotizacion-000007.pdf" });
    expect(render).toHaveBeenCalledWith(expect.objectContaining({
      number: 7, issue_date: "2026-11-13", valid_until: "2026-11-20", total_cents: 23000,
      customer: { name: "Comercial Lima", document_type: "6", document_number: "20207341241" },
      lines: [{ description: "Volantes", quantity: 1000, unit_price_cents: 15, total_cents: 15000 }],
    }));
    expect(db.calls.some((call) => call.sql.includes("INSERT INTO sales.quote_files"))).toBe(true);
    // Only the hash of the link code reaches the database.
    expect(db.calls[0].values?.[0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("serves the stored PDF without drawing again, and nothing for unknown or malformed codes", async () => {
    const render = vi.fn(async () => PDF);
    const stored = new QuotePdfService(pool(PDF), { render }, () => undefined);
    expect((await stored.byNumber("org_jd", 7))?.bytes).toEqual(PDF);
    expect(render).not.toHaveBeenCalled();
    expect(await new QuotePdfService(pool(null, false), { render }, () => undefined).byToken("AbCdEfGhIjKlMnOpQrStUv")).toBeNull();
    expect(await stored.byToken("short")).toBeNull();
  });

  it("fails clearly without a renderer", async () => {
    await expect(new QuotePdfService(pool(null), null, () => undefined).byNumber("org_jd", 7)).rejects.toBeInstanceOf(QuotePdfUnavailable);
  });

  it("only accepts a real PDF from FacturaYa", async () => {
    const ok = new FacturayaQuotePdfRenderer("https://fy", "token", vi.fn(async () => new Response(PDF, { status: 200 })) as unknown as typeof fetch);
    expect((await ok.render({} as never)).length).toBe(PDF.length);
    const html = new FacturayaQuotePdfRenderer("https://fy", "token", vi.fn(async () => new Response("<html>".padEnd(200), { status: 200 })) as unknown as typeof fetch);
    await expect(html.render({} as never)).rejects.toBeInstanceOf(QuotePdfUnavailable);
    const denied = new FacturayaQuotePdfRenderer("https://fy", "token", vi.fn(async () => new Response("", { status: 401 })) as unknown as typeof fetch);
    await expect(denied.render({} as never)).rejects.toBeInstanceOf(QuotePdfUnavailable);
  });

  it("lets the Worker ask for a quote's PDF by number", () => {
    const base = { channel_tenant_id: "manolo", contact_id: 1, company_id: "org_jd", operation: "quote_pdf" };
    expect(isSalesBridgeRequest({ ...base, payload: { number: 7 } })).toBe(true);
    expect(isSalesBridgeRequest({ ...base, payload: { number: 0 } })).toBe(false);
  });
});
