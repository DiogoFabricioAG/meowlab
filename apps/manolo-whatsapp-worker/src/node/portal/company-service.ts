import { randomBytes } from "node:crypto";
import {
  MAX_OWNED_COMPANIES,
  isValidRuc,
  type PortalCompanyRequest,
  type PortalCompanyResponse,
  type PortalMembership,
  type Taxpayer,
} from "../../bridge/portal-company-contracts";
import type { RoleLog } from "../../roles/contracts";
import { PortalInvitationService, type InvitationRequest } from "./invitation-service";
import type { PortalWeeklyService } from "./weekly-service";
import type { PortalStockService } from "../stock/portal-stock-service";

type Rows = { rows: Array<Record<string, unknown>> };
type QueryClient = { query(sql: string, values?: readonly unknown[]): Promise<Rows>; release(destroy?: boolean): void };
export type CompanyPool = { connect(): Promise<unknown>; query(sql: string, values?: readonly unknown[]): Promise<unknown> };

/** Taxpayer registry. `null` means the RUC does not exist; throws when it cannot answer. */
export interface TaxpayerDirectory {
  find(ruc: string): Promise<Taxpayer | null>;
}

/** FacturaYa's shared registry (cache + providers), read with the internal bridge token. */
export class FacturayaTaxpayerDirectory implements TaxpayerDirectory {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    // Wrapped: a stored `fetch` called as a method can lose its binding.
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async find(ruc: string): Promise<Taxpayer | null> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/internal/taxpayers/${ruc}`, {
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: "application/json", Authorization: `Bearer ${this.token}` },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`taxpayer_lookup_${response.status}`);
    const body = await response.json() as { data?: Record<string, unknown> };
    const data = body.data ?? {};
    const optional = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
    const legalName = optional(data.legal_name);
    if (data.ruc !== ruc || !legalName) throw new Error("taxpayer_lookup_malformed");
    return {
      ruc,
      legalName: legalName.slice(0, 255),
      address: optional(data.address)?.slice(0, 500) ?? null,
      status: optional(data.status),
      condition: optional(data.condition),
    };
  }
}

const MEMBERSHIPS_SQL = `
  SELECT tenant.id, tenant.name, tenant.legal_name, tenant.ruc, member.role,
         EXISTS (
           SELECT 1 FROM whatsapp.tenant_integrations AS integration
            WHERE integration.tenant_id = tenant.id AND integration.provider = 'facturaya' AND integration.status = 'active'
         ) AS invoicing_active
    FROM whatsapp.portal_company_members AS member
    JOIN whatsapp.tenants AS tenant ON tenant.id = member.tenant_id AND tenant.status = 'active'
   WHERE member.portal_user_id = $1
   ORDER BY member.role = 'owner' DESC, member.created_at, tenant.id`;

const membership = (row: Record<string, unknown>): PortalMembership => ({
  id: String(row.id),
  name: String(row.name),
  legalName: (row.legal_name as string | null) ?? null,
  ruc: (row.ruc as string | null) ?? null,
  role: row.role === "owner" ? "owner" : "member",
  invoicing: row.invoicing_active ? "active" : "needs_sol",
});

/** SUNAT reports «ACTIVO» for taxpayers that may operate; anything else is refused. */
const isActive = (taxpayer: Taxpayer) => taxpayer.status === null || taxpayer.status.trim().toUpperCase() === "ACTIVO";

export class PortalCompanyService {
  constructor(
    private readonly pool: CompanyPool,
    private readonly directory: TaxpayerDirectory | null,
    private readonly log: RoleLog,
    private readonly newId: () => string = () => `org_${randomBytes(12).toString("hex")}`,
    private readonly invitations: Pick<PortalInvitationService, "handle"> = new PortalInvitationService(pool, log),
    private readonly weekly: Pick<PortalWeeklyService, "handle"> | null = null,
    private readonly stock: Pick<PortalStockService, "handle"> | null = null,
  ) {}

  async handle(request: PortalCompanyRequest): Promise<PortalCompanyResponse> {
    if (request.action === "weekly") {
      return this.weekly ? this.weekly.handle(request.portalUserId, request.tenantId) : { status: "unavailable" };
    }
    if (request.action === "stock_view") {
      return this.stock ? this.stock.handle(request.portalUserId, request.tenantId) : { status: "unavailable" };
    }
    if (request.action !== "mine" && request.action !== "lookup" && request.action !== "create") {
      return this.invitations.handle(request as InvitationRequest);
    }
    if (request.action === "mine") {
      const { rows } = await this.pool.query(MEMBERSHIPS_SQL, [request.portalUserId]) as Rows;
      return { status: "ok", companies: rows.map(membership) };
    }
    const checked = await this.check(request.ruc);
    if (checked.status !== "ok" || !("taxpayer" in checked)) return checked;
    if (request.action === "lookup") return checked;
    return this.create(request.portalUserId, checked.taxpayer, request.name?.trim());
  }

  /** Same answers for lookup and create, so creation never trusts an earlier lookup. */
  private async check(ruc: string): Promise<PortalCompanyResponse> {
    if (!isValidRuc(ruc)) return { status: "invalid_ruc" };
    // Never says who owns it: the person asks the owner for an invitation (ADR-0010).
    if (await this.rucTaken(ruc)) return { status: "taken" };
    if (!this.directory) return { status: "unavailable" };
    let taxpayer: Taxpayer | null;
    try {
      taxpayer = await this.directory.find(ruc);
    } catch {
      this.log("portal_company_lookup_unavailable");
      return { status: "unavailable" };
    }
    if (!taxpayer) return { status: "not_found" };
    if (!isActive(taxpayer)) return { status: "inactive", taxpayer };
    return { status: "ok", taxpayer };
  }

  private async rucTaken(ruc: string): Promise<boolean> {
    const { rows } = await this.pool.query("SELECT 1 FROM whatsapp.tenants WHERE ruc = $1 LIMIT 1", [ruc]) as Rows;
    return rows.length > 0;
  }

  private async create(portalUserId: string, taxpayer: Taxpayer, name: string | undefined): Promise<PortalCompanyResponse> {
    const client = await this.pool.connect() as QueryClient;
    let destroy = false;
    try {
      await client.query("BEGIN");
      // Serializes creations of the same account, so the limit cannot be raced.
      await client.query("SELECT pg_advisory_xact_lock(hashtext('portal_company_owner:' || $1))", [portalUserId]);
      const owned = await client.query(
        "SELECT count(*)::int AS total FROM whatsapp.portal_company_members WHERE portal_user_id = $1 AND role = 'owner'",
        [portalUserId],
      );
      if (Number(owned.rows[0]?.total ?? 0) >= MAX_OWNED_COMPANIES) {
        await client.query("ROLLBACK");
        return { status: "limit_reached" };
      }
      const id = this.newId();
      const inserted = await client.query(
        `INSERT INTO whatsapp.tenants (id, name, legal_name, ruc, address, status, timezone, origin)
         VALUES ($1, $2, $3, $4, $5, 'active', 'America/Lima', 'portal')
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [id, (name || taxpayer.legalName).slice(0, 160), taxpayer.legalName, taxpayer.ruc, taxpayer.address],
      );
      if (!inserted.rows.length) {
        // Another account registered the same RUC in the meantime.
        await client.query("ROLLBACK");
        return { status: "taken" };
      }
      await client.query(
        "INSERT INTO whatsapp.portal_company_members (tenant_id, portal_user_id, role) VALUES ($1, $2, 'owner')",
        [id, portalUserId],
      );
      await client.query("COMMIT");
      this.log("portal_company_created");
      return {
        status: "created",
        company: { id, name: (name || taxpayer.legalName).slice(0, 160), legalName: taxpayer.legalName, ruc: taxpayer.ruc, role: "owner", invoicing: "needs_sol" },
      };
    } catch (error) {
      destroy = true;
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release(destroy);
    }
  }
}
