import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  INVITATION_TTL_DAYS,
  MAX_PENDING_INVITATIONS,
  type InvitationAccess,
  type PendingInvitation,
  type PortalCompanyRequest,
  type PortalCompanyResponse,
  type PortalMembership,
} from "../../bridge/portal-company-contracts";
import { maskWhatsAppPhone, normalizeWhatsAppPhone } from "../../bridge/portal-link-contracts";
import type { RoleLog } from "../../roles/contracts";

type Rows = { rows: Array<Record<string, unknown>> };
type QueryClient = { query(sql: string, values?: readonly unknown[]): Promise<Rows>; release(destroy?: boolean): void };
export type InvitationPool = { connect(): Promise<unknown>; query(sql: string, values?: readonly unknown[]): Promise<unknown> };

export type InvitationRequest = Extract<PortalCompanyRequest, { action: "team" | "invite" | "revoke" | "remove" | "preview" | "accept" }>;

/** What each access level grants to the person's WhatsApp number in Invoice Cat. */
const PERMISSIONS: Record<InvitationAccess, string[]> = {
  view: ["view_invoice"],
  full: ["view_invoice", "create_invoice", "issue_invoice", "create_credit_note"],
};

const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");
const iso = (value: unknown) => new Date(value as string | Date).toISOString();

const pending = (row: Record<string, unknown>): PendingInvitation => ({
  id: String(row.id),
  createdAt: iso(row.created_at),
  expiresAt: iso(row.expires_at),
  maskedPhone: row.wa_phone ? maskWhatsAppPhone(String(row.wa_phone)) : null,
  access: row.access === "full" ? "full" : "view",
});

/**
 * Owner invitations (ADR-0010, phase 2). Only the owner manages the team; a link is a
 * 128-bit code stored as its SHA-256, valid once and for a few days, and optionally
 * bound to the employee's WhatsApp number.
 */
export class PortalInvitationService {
  constructor(
    private readonly pool: InvitationPool,
    private readonly log: RoleLog,
    private readonly now: () => Date = () => new Date(),
    private readonly newToken: () => string = () => randomBytes(16).toString("base64url"),
  ) {}

  async handle(request: InvitationRequest): Promise<PortalCompanyResponse> {
    switch (request.action) {
      case "team":
        return this.team(request.portalUserId, request.tenantId);
      case "invite":
        return this.invite(request.portalUserId, request.tenantId, request.access, request.phone);
      case "revoke":
        return this.revoke(request.portalUserId, request.tenantId, request.invitationId);
      case "remove":
        return this.remove(request.portalUserId, request.tenantId, request.memberId);
      case "preview":
        return this.preview(request.portalUserId, request.token);
      case "accept":
        return this.accept(request.portalUserId, request.token);
    }
  }

  private async query(sql: string, values: readonly unknown[]): Promise<Rows> {
    return await this.pool.query(sql, values) as Rows;
  }

  private async isOwner(portalUserId: string, tenantId: string): Promise<boolean> {
    const { rows } = await this.query(
      `SELECT 1 FROM whatsapp.portal_company_members AS member
         JOIN whatsapp.tenants AS tenant ON tenant.id = member.tenant_id AND tenant.status = 'active'
        WHERE member.tenant_id = $1 AND member.portal_user_id = $2 AND member.role = 'owner'`,
      [tenantId, portalUserId],
    );
    return rows.length > 0;
  }

  private async team(portalUserId: string, tenantId: string): Promise<PortalCompanyResponse> {
    if (!await this.isOwner(portalUserId, tenantId)) return { status: "forbidden" };
    const [members, invitations] = await Promise.all([
      this.query(
        `SELECT portal_user_id, role, created_at FROM whatsapp.portal_company_members
          WHERE tenant_id = $1 ORDER BY role = 'owner' DESC, created_at`,
        [tenantId],
      ),
      this.query(
        `SELECT id, created_at, expires_at, wa_phone, access FROM whatsapp.portal_company_invitations
          WHERE tenant_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > $2
          ORDER BY created_at DESC`,
        [tenantId, this.now()],
      ),
    ]);
    return {
      status: "ok",
      team: {
        members: members.rows.map((row) => ({
          portalUserId: String(row.portal_user_id),
          role: row.role === "owner" ? "owner" : "member",
          joinedAt: iso(row.created_at),
        })),
        invitations: invitations.rows.map(pending),
      },
    };
  }

  private async invite(portalUserId: string, tenantId: string, access: InvitationAccess, rawPhone?: string): Promise<PortalCompanyResponse> {
    const phone = rawPhone?.trim() ? normalizeWhatsAppPhone(rawPhone) : null;
    if (rawPhone?.trim() && !phone) return { status: "invalid_phone" };
    if (!await this.isOwner(portalUserId, tenantId)) return { status: "forbidden" };
    const now = this.now();
    const open = await this.query(
      `SELECT count(*)::int AS total FROM whatsapp.portal_company_invitations
        WHERE tenant_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > $2`,
      [tenantId, now],
    );
    if (Number(open.rows[0]?.total ?? 0) >= MAX_PENDING_INVITATIONS) return { status: "limit_reached" };
    const token = this.newToken();
    const id = randomUUID();
    const expiresAt = new Date(now.getTime() + INVITATION_TTL_DAYS * 86_400_000);
    await this.query(
      `INSERT INTO whatsapp.portal_company_invitations
         (id, tenant_id, token_hash, created_by, wa_phone, access, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, tenantId, hashToken(token), portalUserId, phone, access, now, expiresAt],
    );
    this.log("portal_invitation_created", { bound: phone !== null });
    return {
      status: "invited",
      invitation: { id, token, createdAt: now.toISOString(), expiresAt: expiresAt.toISOString(),
        maskedPhone: phone ? maskWhatsAppPhone(phone) : null, access },
    };
  }

  private async revoke(portalUserId: string, tenantId: string, invitationId: string): Promise<PortalCompanyResponse> {
    if (!await this.isOwner(portalUserId, tenantId)) return { status: "forbidden" };
    const { rows } = await this.query(
      `UPDATE whatsapp.portal_company_invitations SET revoked_at = $3
        WHERE id = $1 AND tenant_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL
        RETURNING id`,
      [invitationId, tenantId, this.now()],
    );
    return rows.length ? { status: "revoked" } : { status: "not_found" };
  }

  private async remove(portalUserId: string, tenantId: string, memberId: string): Promise<PortalCompanyResponse> {
    if (memberId === portalUserId || !await this.isOwner(portalUserId, tenantId)) return { status: "forbidden" };
    return this.transaction(async (client) => {
      const removed = await client.query(
        `DELETE FROM whatsapp.portal_company_members
          WHERE tenant_id = $1 AND portal_user_id = $2 AND role = 'member'
          RETURNING portal_user_id`,
        [tenantId, memberId],
      );
      if (!removed.rows.length) return { status: "not_found" };
      // The person also stops acting for the company through the agents.
      await client.query(
        `UPDATE whatsapp.tenant_members AS member SET status = 'inactive', updated_at = $3
           FROM whatsapp.contacts AS contact, whatsapp.portal_whatsapp_links AS link
          WHERE member.tenant_id = $1 AND member.contact_id = contact.id
            AND contact.whatsapp_user_id = link.wa_phone AND link.portal_user_id = $2`,
        [tenantId, memberId, this.now()],
      );
      this.log("portal_member_removed");
      return { status: "removed" };
    });
  }

  private async preview(portalUserId: string, token: string): Promise<PortalCompanyResponse> {
    const { rows } = await this.query(
      `SELECT invitation.*, tenant.name AS company_name,
              EXISTS (SELECT 1 FROM whatsapp.portal_company_members AS member
                       WHERE member.tenant_id = invitation.tenant_id AND member.portal_user_id = $2) AS already_member
         FROM whatsapp.portal_company_invitations AS invitation
         JOIN whatsapp.tenants AS tenant ON tenant.id = invitation.tenant_id AND tenant.status = 'active'
        WHERE invitation.token_hash = $1`,
      [hashToken(token), portalUserId],
    );
    const row = rows[0];
    const state = this.state(row);
    if (state !== "open") return { status: state };
    return {
      status: "ok",
      invitation: {
        companyName: String(row.company_name),
        invitedBy: String(row.created_by),
        expiresAt: iso(row.expires_at),
        maskedPhone: row.wa_phone ? maskWhatsAppPhone(String(row.wa_phone)) : null,
        alreadyMember: Boolean(row.already_member),
      },
    };
  }

  private state(row: Record<string, unknown> | undefined): "open" | "invalid" | "used" | "expired" {
    if (!row || row.revoked_at) return "invalid";
    if (row.accepted_at) return "used";
    if (new Date(row.expires_at as string | Date).getTime() <= this.now().getTime()) return "expired";
    return "open";
  }

  private async accept(portalUserId: string, token: string): Promise<PortalCompanyResponse> {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT invitation.* FROM whatsapp.portal_company_invitations AS invitation
           JOIN whatsapp.tenants AS tenant ON tenant.id = invitation.tenant_id AND tenant.status = 'active'
          WHERE invitation.token_hash = $1
          FOR UPDATE OF invitation`,
        [hashToken(token)],
      );
      const invitation = rows[0];
      const state = this.state(invitation);
      if (state !== "open") return { status: state };
      const tenantId = String(invitation.tenant_id);
      const member = await client.query(
        "SELECT 1 FROM whatsapp.portal_company_members WHERE tenant_id = $1 AND portal_user_id = $2",
        [tenantId, portalUserId],
      );
      // Not consumed: the owner may still give the link to the right person.
      if (member.rows.length) return { status: "already_member" };
      const link = await client.query("SELECT wa_phone FROM whatsapp.portal_whatsapp_links WHERE portal_user_id = $1", [portalUserId]);
      const linkedPhone = link.rows[0]?.wa_phone ? String(link.rows[0].wa_phone) : null;
      if (invitation.wa_phone && !linkedPhone) return { status: "needs_whatsapp" };
      if (invitation.wa_phone && linkedPhone !== invitation.wa_phone) return { status: "phone_mismatch" };

      const now = this.now();
      await client.query(
        "INSERT INTO whatsapp.portal_company_members (tenant_id, portal_user_id, role, created_at) VALUES ($1, $2, 'member', $3)",
        [tenantId, portalUserId, now],
      );
      await client.query(
        "UPDATE whatsapp.portal_company_invitations SET accepted_at = $2, accepted_by = $3 WHERE id = $1",
        [invitation.id, now, portalUserId],
      );
      if (linkedPhone) {
        // The linked number acts for the company through the agents, with the access the owner chose.
        const access: InvitationAccess = invitation.access === "full" ? "full" : "view";
        await client.query(
          `INSERT INTO whatsapp.tenant_members (tenant_id, contact_id, display_name, permissions, status)
           SELECT $1, contact.id, contact.display_name, $3::jsonb, 'active'
             FROM whatsapp.contacts AS contact WHERE contact.whatsapp_user_id = $2
           ON CONFLICT (tenant_id, contact_id)
           DO UPDATE SET permissions = EXCLUDED.permissions, status = 'active', updated_at = CURRENT_TIMESTAMP`,
          [tenantId, linkedPhone, JSON.stringify(PERMISSIONS[access])],
        );
      }
      const company = await client.query(
        `SELECT tenant.id, tenant.name, tenant.legal_name, tenant.ruc,
                EXISTS (SELECT 1 FROM whatsapp.tenant_integrations AS integration
                         WHERE integration.tenant_id = tenant.id AND integration.provider = 'facturaya'
                           AND integration.status = 'active') AS invoicing_active
           FROM whatsapp.tenants AS tenant WHERE tenant.id = $1`,
        [tenantId],
      );
      const row = company.rows[0];
      this.log("portal_invitation_accepted", { agents: linkedPhone !== null });
      const joined: PortalMembership = {
        id: tenantId,
        name: String(row?.name ?? ""),
        legalName: (row?.legal_name as string | null) ?? null,
        ruc: (row?.ruc as string | null) ?? null,
        role: "member",
        invoicing: row?.invoicing_active ? "active" : "needs_sol",
      };
      return { status: "joined", company: joined };
    });
  }

  private async transaction(work: (client: QueryClient) => Promise<PortalCompanyResponse>): Promise<PortalCompanyResponse> {
    const client = await this.pool.connect() as QueryClient;
    let destroy = false;
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query(result.status === "joined" || result.status === "removed" ? "COMMIT" : "ROLLBACK");
      return result;
    } catch (error) {
      destroy = true;
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release(destroy);
    }
  }
}
