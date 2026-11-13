import type { PortalBillingRequest, PortalBillingResponse, PortalCompany } from "../../bridge/portal-billing-contracts";
import type { RoleLog } from "../../roles/contracts";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const PERMISSION = "view_invoice";

type Query = (sql: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
export type BillingPool = { query: Query };
export type TokenCipher = { decrypt(encrypted: string): string };

type CompanyRow = PortalCompany & { encryptedToken: string };

/**
 * Who sees what: the portal account's linked WhatsApp number, every contact with that
 * number, and the companies where that contact is an active member allowed to view
 * invoices, with an active FacturaYa integration.
 */
const COMPANIES_SQL = `
  SELECT DISTINCT ON (tenant.id)
         tenant.id, tenant.name, tenant.legal_name, tenant.ruc,
         integration.environment, integration.encrypted_token
    FROM whatsapp.portal_whatsapp_links AS link
    JOIN whatsapp.contacts AS contact ON contact.whatsapp_user_id = link.wa_phone
    JOIN whatsapp.tenant_members AS member ON member.contact_id = contact.id AND member.status = 'active'
    JOIN whatsapp.tenants AS tenant ON tenant.id = member.tenant_id AND tenant.status = 'active'
    JOIN whatsapp.tenant_integrations AS integration
      ON integration.tenant_id = tenant.id AND integration.provider = 'facturaya' AND integration.status = 'active'
   WHERE link.portal_user_id = $1
     AND member.permissions ? '${PERMISSION}'
   ORDER BY tenant.id`;

export class PortalBillingService {
  constructor(
    private readonly pool: BillingPool,
    private readonly cipher: TokenCipher,
    private readonly facturayaBaseUrl: string,
    private readonly log: RoleLog,
    // Wrapped: a stored `fetch` called as a method can lose its binding.
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  private async companies(portalUserId: string): Promise<CompanyRow[] | null> {
    const linked = await this.pool.query("SELECT 1 FROM whatsapp.portal_whatsapp_links WHERE portal_user_id = $1", [portalUserId]);
    if (!linked.rows.length) return null;
    const { rows } = await this.pool.query(COMPANIES_SQL, [portalUserId]);
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      legalName: (row.legal_name as string | null) ?? null,
      ruc: (row.ruc as string | null) ?? null,
      environment: row.environment === "beta" ? "beta" : "production",
      encryptedToken: String(row.encrypted_token),
    }));
  }

  async handle(request: PortalBillingRequest): Promise<PortalBillingResponse> {
    const companies = await this.companies(request.portalUserId);
    if (!companies) return { status: "not_linked" };
    if (request.action === "companies") {
      return { status: "ok", companies: companies.map(({ encryptedToken: _secret, ...company }) => company) };
    }
    const company = companies.find((item) => item.id === request.tenantId);
    if (!company) {
      this.log("portal_billing_forbidden");
      return { status: "forbidden" };
    }
    let token: string;
    try {
      token = this.cipher.decrypt(company.encryptedToken);
    } catch {
      this.log("portal_billing_token_unreadable");
      return { status: "unavailable" };
    }

    switch (request.action) {
      case "documents": {
        const query = new URLSearchParams();
        if (request.from) query.set("from", request.from);
        if (request.to) query.set("to", request.to);
        if (request.type) query.set("type", request.type);
        if (request.page) query.set("page", String(request.page));
        return this.json(token, `/api/issued-documents?${query}`);
      }
      case "summary":
        return this.json(token, `/api/reports/monthly?year=${request.year}`);
      case "despatches": {
        const result = await this.json(token, `/api/despatches?page=${request.page ?? 1}`);
        if (result.status !== "ok" || !("data" in result)) return result;
        // FacturaYa returns the full guide (payload, keys); the portal only needs the summary.
        const page = result.data as { data?: unknown[]; current_page?: number; last_page?: number; total?: number };
        return {
          status: "ok",
          data: (page.data ?? []).map((guide) => {
            const g = guide as Record<string, unknown>;
            return {
              id: g.id, series: g.series, correlative: g.correlative, status: g.status, message: g.message,
              environment: g.environment, invoice_number: g.invoice_number, customer: g.customer,
              created_at: g.created_at, is_demo: g.is_demo, files: { xml: Boolean(g.xml_path), cdr: Boolean(g.cdr_path) },
            };
          }),
          meta: { page: page.current_page ?? 1, last_page: page.last_page ?? 1, total: page.total ?? 0 },
        };
      }
      case "file": {
        const path = request.kind === "invoice" ? "invoices" : request.kind === "credit_note" ? "credit-notes" : "despatches";
        return this.file(token, `/api/${path}/${request.id}/files/${request.fileType}`, request);
      }
    }
  }

  private async fetchFacturaya(token: string, path: string): Promise<Response | null> {
    try {
      return await this.fetchImpl(`${this.facturayaBaseUrl}${path}`, {
        signal: AbortSignal.timeout(15_000),
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      });
    } catch {
      this.log("portal_billing_facturaya_unreachable");
      return null;
    }
  }

  private async json(token: string, path: string): Promise<PortalBillingResponse> {
    const response = await this.fetchFacturaya(token, path);
    if (!response) return { status: "unavailable" };
    if (response.status === 404) return { status: "not_found" };
    if (!response.ok) {
      this.log("portal_billing_facturaya_error", { status: response.status });
      return { status: "unavailable" };
    }
    const body = await response.json() as { data?: unknown; meta?: unknown };
    return path.startsWith("/api/despatches")
      ? { status: "ok", data: body }
      : { status: "ok", data: body.data ?? [], meta: body.meta };
  }

  private async file(token: string, path: string, request: Extract<PortalBillingRequest, { action: "file" }>): Promise<PortalBillingResponse> {
    const response = await this.fetchFacturaya(token, path);
    if (!response) return { status: "unavailable" };
    if (response.status === 404) return { status: "not_found" };
    if (!response.ok) return { status: "unavailable" };
    const length = Number(response.headers.get("Content-Length") ?? "0");
    if (length > MAX_FILE_BYTES) return { status: "unavailable" };
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_FILE_BYTES) return { status: "unavailable" };
    const mimeType = response.headers.get("Content-Type")?.split(";")[0]?.trim()
      || (request.fileType === "pdf" ? "application/pdf" : request.fileType === "xml" ? "application/xml" : "application/zip");
    const extension = request.fileType === "cdr" ? "zip" : request.fileType;
    return {
      status: "ok",
      file: { base64: Buffer.from(bytes).toString("base64"), mimeType, filename: `${request.kind}-${request.id}.${extension}` },
    };
  }
}
