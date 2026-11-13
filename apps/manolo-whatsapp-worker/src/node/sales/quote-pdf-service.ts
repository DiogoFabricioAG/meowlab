import { createHash } from "node:crypto";
import type { RoleLog } from "../../roles/contracts";

type Rows = { rows: Array<Record<string, unknown>> };
export type QuotePdfPool = { query(sql: string, values?: readonly unknown[]): Promise<unknown> };

/** What FacturaYa needs to draw a quote with the documents' single layout (ADR-0013). */
export type QuotePdfInput = {
  company: { name: string; legal_name: string | null; ruc: string | null; address: string | null };
  number: number;
  issue_date: string;
  valid_until: string;
  customer: { name: string; document_type: string | null; document_number: string | null };
  lines: Array<{ description: string; quantity: number; unit_price_cents: number; total_cents: number }>;
  subtotal_cents: number;
  discount_cents: number;
  total_cents: number;
  notes: string | null;
};

export interface QuotePdfRenderer {
  render(quote: QuotePdfInput): Promise<Uint8Array>;
}

export type QuotePdf = { number: number; filename: string; bytes: Uint8Array };

export class QuotePdfUnavailable extends Error {}

const MAX_PDF_BYTES = 2 * 1024 * 1024;
const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

/** FacturaYa draws the PDF (`POST /api/internal/quotes/pdf`, internal bearer); it stores nothing. */
export class FacturayaQuotePdfRenderer implements QuotePdfRenderer {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    // Wrapped: a stored `fetch` called as a method can lose its binding.
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async render(quote: QuotePdfInput): Promise<Uint8Array> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/internal/quotes/pdf`, {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: { Accept: "application/pdf", "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
      body: JSON.stringify(quote),
    });
    if (!response.ok) throw new QuotePdfUnavailable(`quote_pdf_${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const isPdf = bytes.length > 100 && bytes.length <= MAX_PDF_BYTES && new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";
    if (!isPdf) throw new QuotePdfUnavailable("quote_pdf_malformed");
    return bytes;
  }
}

/**
 * The PDF of a Sales Cat quote: drawn by FacturaYa the first time it is asked for and kept
 * in `sales.quote_files`, so the customer always gets the same file. Reached by the public
 * link code (portal) or by company and number (Manolo, after the membership check).
 */
export class QuotePdfService {
  constructor(
    private readonly pool: QuotePdfPool,
    private readonly renderer: QuotePdfRenderer | null,
    private readonly log: RoleLog,
  ) {}

  async byToken(token: string): Promise<QuotePdf | null> {
    if (!/^[A-Za-z0-9_-]{22}$/.test(token)) return null;
    return this.load("quote.public_token_hash = $1", [hashToken(token)]);
  }

  async byNumber(companyId: string, number: number): Promise<QuotePdf | null> {
    return this.load("quote.tenant_id = $1 AND quote.number = $2", [companyId, number]);
  }

  private async load(where: string, values: readonly unknown[]): Promise<QuotePdf | null> {
    const { rows } = await this.pool.query(
      `SELECT quote.id, quote.tenant_id, quote.number, quote.customer_name,
              to_char(quote.created_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS issue_date,
              to_char(quote.valid_until, 'YYYY-MM-DD') AS valid_until,
              quote.subtotal_cents, quote.discount_cents, quote.total_cents, quote.notes,
              tenant.name AS company_name, tenant.legal_name, tenant.ruc, tenant.address,
              customer.doc_type, customer.doc_number, file.content
         FROM sales.quotes AS quote
         JOIN whatsapp.tenants AS tenant ON tenant.id = quote.tenant_id
         LEFT JOIN commerce.customers AS customer ON customer.id = quote.customer_id
         LEFT JOIN sales.quote_files AS file ON file.quote_id = quote.id
        WHERE ${where} AND quote.status <> 'cancelled'`,
      values,
    ) as Rows;
    const quote = rows[0];
    if (!quote) return null;
    const number = Number(quote.number);
    const filename = `Cotizacion-${String(number).padStart(6, "0")}.pdf`;
    if (quote.content) return { number, filename, bytes: new Uint8Array(quote.content as Uint8Array) };
    if (!this.renderer) throw new QuotePdfUnavailable("quote_pdf_renderer_missing");

    const lines = await this.pool.query(
      `SELECT description, quantity::float AS quantity, unit_price_cents, line_total_cents
         FROM sales.lines WHERE quote_id = $1 ORDER BY position`,
      [quote.id],
    ) as Rows;
    const bytes = await this.renderer.render({
      company: {
        name: String(quote.company_name),
        legal_name: (quote.legal_name as string | null) ?? null,
        ruc: (quote.ruc as string | null) ?? null,
        address: (quote.address as string | null) ?? null,
      },
      number,
      issue_date: String(quote.issue_date),
      valid_until: String(quote.valid_until),
      customer: {
        name: (quote.customer_name as string | null) ?? "Cliente varios",
        document_type: (quote.doc_type as string | null) ?? null,
        document_number: (quote.doc_number as string | null) ?? null,
      },
      lines: lines.rows.map((line) => ({
        description: String(line.description),
        quantity: Number(line.quantity),
        unit_price_cents: Number(line.unit_price_cents),
        total_cents: Number(line.line_total_cents),
      })),
      subtotal_cents: Number(quote.subtotal_cents),
      discount_cents: Number(quote.discount_cents),
      total_cents: Number(quote.total_cents),
      notes: (quote.notes as string | null) ?? null,
    });
    // First writer wins: two simultaneous first views keep one file.
    const stored = await this.pool.query(
      `INSERT INTO sales.quote_files (quote_id, tenant_id, content, sha256) VALUES ($1, $2, $3, $4)
       ON CONFLICT (quote_id) DO NOTHING
       RETURNING quote_id`,
      [quote.id, quote.tenant_id, Buffer.from(bytes), createHash("sha256").update(bytes).digest("hex")],
    ) as Rows;
    if (!stored.rows.length) {
      const kept = await this.pool.query("SELECT content FROM sales.quote_files WHERE quote_id = $1", [quote.id]) as Rows;
      if (kept.rows[0]?.content) return { number, filename, bytes: new Uint8Array(kept.rows[0].content as Uint8Array) };
    }
    this.log("vps_sales_quote_pdf_stored");
    return { number, filename, bytes };
  }
}
