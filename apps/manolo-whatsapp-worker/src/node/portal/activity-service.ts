import type {
  ActivityAgentKey,
  ActivityDay,
  ActivityEvent,
  ActivitySummary,
  PortalCompanyResponse,
} from "../../bridge/portal-company-contracts";
import type { RoleLog } from "../../roles/contracts";
import { limaDayStart, type WeeklyCipher, type WeeklyPool } from "./weekly-service";

const LIMA_OFFSET_MS = 5 * 3_600_000;
const DAY_MS = 86_400_000;
const SERIES_DAYS = 14;
const EVENT_LIMIT = 30;
const MAX_PAGES = 8;

type Rows = { rows: Array<Record<string, unknown>> };
type Document = { status?: string; issue_date?: string };

const limaDate = (instant: Date) => new Date(instant.getTime() - LIMA_OFFSET_MS).toISOString().slice(0, 10);
const isoTime = (value: unknown) => {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
};
const money = (cents: unknown) =>
  `S/ ${(Number(cents ?? 0) / 100).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * 14-day daily trend and recent cat activity for the portal's «Inicio» page.
 * Read-only, isolated per tenant, and assembled from existing tables + audit logs.
 */
export class PortalActivityService {
  constructor(
    private readonly pool: WeeklyPool,
    private readonly cipher: WeeklyCipher,
    private readonly facturayaBaseUrl: string,
    private readonly log: RoleLog,
    private readonly now: () => Date = () => new Date(),
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  private async query(sql: string, values: readonly unknown[]): Promise<Rows> {
    return await this.pool.query(sql, values) as Rows;
  }

  async handle(portalUserId: string, tenantId: string): Promise<PortalCompanyResponse> {
    const member = await this.query(
      `SELECT 1 FROM whatsapp.portal_company_members AS member
         JOIN whatsapp.tenants AS tenant ON tenant.id = member.tenant_id AND tenant.status = 'active'
        WHERE member.tenant_id = $1 AND member.portal_user_id = $2`,
      [tenantId, portalUserId],
    );
    if (!member.rows.length) return { status: "forbidden" };

    const now = this.now();
    const todayStart = limaDayStart(now);
    const start = new Date(todayStart.getTime() - (SERIES_DAYS - 1) * DAY_MS);
    const end = new Date(todayStart.getTime() + DAY_MS);
    const dates = Array.from({ length: SERIES_DAYS }, (_, index) =>
      limaDate(new Date(start.getTime() + index * DAY_MS)),
    );
    const fromDate = dates[0];
    const todayDate = dates[dates.length - 1];

    const [invoicing, sales, collections, invoiceEvents, salesEvents, collectionsEvents, reorderEvents, supportEvents] =
      await Promise.all([
        this.invoicingSeries(tenantId, fromDate, todayDate),
        this.salesSeries(tenantId, start, end, now),
        this.collectionsSeries(tenantId, fromDate, todayDate, now),
        this.invoiceEvents(tenantId),
        this.salesEvents(tenantId),
        this.collectionsEvents(tenantId),
        this.reorderEvents(tenantId),
        this.supportEvents(tenantId),
      ]);

    const series: ActivityDay[] = dates.map((date) => ({
      date,
      invoices: invoicing.byDate.get(date) ?? 0,
      salesCents: sales.byDate.get(date) ?? 0,
      collectionsCents: collections.byDate.get(date) ?? 0,
    }));

    const events = [
      ...invoiceEvents,
      ...salesEvents,
      ...collectionsEvents,
      ...reorderEvents,
      ...supportEvents,
    ]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, EVENT_LIMIT);

    const activity: ActivitySummary = {
      today: todayDate,
      active: {
        invoicing: invoicing.enabled,
        sales: sales.enabled,
        collections: collections.enabled,
      },
      series,
      events,
    };
    return { status: "ok", activity };
  }

  private async invoicingSeries(
    tenantId: string,
    fromDate: string,
    todayDate: string,
  ): Promise<{ enabled: boolean; byDate: Map<string, number> }> {
    const byDate = new Map<string, number>();
    const { rows } = await this.query(
      `SELECT encrypted_token FROM whatsapp.tenant_integrations
        WHERE tenant_id = $1 AND provider = 'facturaya' AND status = 'active' LIMIT 1`,
      [tenantId],
    );
    if (!rows.length) return { enabled: false, byDate };

    let token: string;
    try {
      token = this.cipher.decrypt(String(rows[0].encrypted_token));
    } catch {
      this.log("portal_activity_token_unreadable");
      return { enabled: true, byDate };
    }

    const documents: Document[] = [];
    let count = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      let response: Response;
      try {
        response = await this.fetchImpl(
          `${this.facturayaBaseUrl}/api/issued-documents?from=${fromDate}&to=${todayDate}&page=${page}`,
          {
            signal: AbortSignal.timeout(15_000),
            headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
          },
        );
      } catch {
        this.log("portal_activity_invoicing_unreachable");
        return { enabled: true, byDate };
      }
      if (!response.ok) {
        this.log("portal_activity_invoicing_error", { status: response.status });
        return { enabled: true, byDate };
      }
      const body = await response.json() as { data?: Document[]; meta?: { total?: number; last_page?: number } };
      documents.push(...(body.data ?? []));
      count = Number(body.meta?.total ?? documents.length);
      if (!body.data?.length || documents.length >= count || page >= Number(body.meta?.last_page ?? page)) {
        break;
      }
    }

    for (const doc of documents) {
      if (doc.status !== "accepted" || typeof doc.issue_date !== "string") continue;
      byDate.set(doc.issue_date, (byDate.get(doc.issue_date) ?? 0) + 1);
    }
    return { enabled: true, byDate };
  }

  private async salesSeries(
    tenantId: string,
    start: Date,
    end: Date,
    now: Date,
  ): Promise<{ enabled: boolean; byDate: Map<string, number> }> {
    const byDate = new Map<string, number>();
    try {
      const settings = await this.query(
        `SELECT enabled AND (active_until IS NULL OR active_until > $2) AS enabled
           FROM sales.settings WHERE tenant_id = $1`,
        [tenantId, now],
      );
      if (!settings.rows[0]?.enabled) return { enabled: false, byDate };
      const { rows } = await this.query(
        `SELECT to_char(sold_at AT TIME ZONE 'America/Lima', 'YYYY-MM-DD') AS day,
                COALESCE(sum(total_cents), 0)::bigint AS total_cents
           FROM sales.sales
          WHERE tenant_id = $1 AND status = 'confirmed' AND sold_at >= $2 AND sold_at < $3
          GROUP BY 1`,
        [tenantId, start, end],
      );
      for (const row of rows) {
        if (typeof row.day === "string") byDate.set(row.day, Number(row.total_cents ?? 0));
      }
      return { enabled: true, byDate };
    } catch {
      return { enabled: false, byDate };
    }
  }

  private async collectionsSeries(
    tenantId: string,
    fromDate: string,
    todayDate: string,
    now: Date,
  ): Promise<{ enabled: boolean; byDate: Map<string, number> }> {
    const byDate = new Map<string, number>();
    try {
      const settings = await this.query(
        `SELECT enabled AND (active_until IS NULL OR active_until > $2) AS enabled
           FROM receivables.settings WHERE tenant_id = $1`,
        [tenantId, now],
      );
      if (!settings.rows[0]?.enabled) return { enabled: false, byDate };
      const { rows } = await this.query(
        `SELECT to_char(paid_on, 'YYYY-MM-DD') AS day,
                COALESCE(sum(amount_cents), 0)::bigint AS total_cents
           FROM receivables.payments
          WHERE tenant_id = $1 AND status = 'confirmed' AND method <> 'nota_credito'
            AND paid_on >= $2::date AND paid_on <= $3::date
          GROUP BY 1`,
        [tenantId, fromDate, todayDate],
      );
      for (const row of rows) {
        if (typeof row.day === "string") byDate.set(row.day, Number(row.total_cents ?? 0));
      }
      return { enabled: true, byDate };
    } catch {
      return { enabled: false, byDate };
    }
  }

  private async invoiceEvents(tenantId: string): Promise<ActivityEvent[]> {
    try {
      const { rows } = await this.query(
        `SELECT id, operation, resource_type, resource_id, metadata, created_at
           FROM whatsapp.facturaya_audit_logs
          WHERE tenant_id = $1 AND status = 'completed'
          ORDER BY created_at DESC
          LIMIT $2`,
        [tenantId, EVENT_LIMIT],
      );
      return rows.map((row) => ({
        id: `invoice-${String(row.id)}`,
        at: isoTime(row.created_at),
        agent: "invoice" as ActivityAgentKey,
        text: formatInvoiceEvent(
          String(row.operation ?? ""),
          row.resource_id ? String(row.resource_id) : null,
          (row.metadata ?? {}) as Record<string, unknown>,
        ),
      }));
    } catch {
      return [];
    }
  }

  private async salesEvents(tenantId: string): Promise<ActivityEvent[]> {
    try {
      const { rows } = await this.query(
        `SELECT id, entity, action, details, created_at
           FROM sales.audit_log
          WHERE tenant_id = $1
          ORDER BY created_at DESC
          LIMIT $2`,
        [tenantId, EVENT_LIMIT],
      );
      return rows.map((row) => ({
        id: `sales-${String(row.id)}`,
        at: isoTime(row.created_at),
        agent: "sales" as ActivityAgentKey,
        text: formatSalesEvent(
          String(row.entity ?? ""),
          String(row.action ?? ""),
          (row.details ?? {}) as Record<string, unknown>,
        ),
      }));
    } catch {
      return [];
    }
  }

  private async collectionsEvents(tenantId: string): Promise<ActivityEvent[]> {
    try {
      const { rows } = await this.query(
        `SELECT log.id, log.action, log.details, log.created_at, customer.name AS customer_name
           FROM receivables.audit_log AS log
           LEFT JOIN receivables.debts AS debt
             ON debt.tenant_id = log.tenant_id
            AND log.details ? 'debtId'
            AND (log.details->>'debtId') ~ '^[0-9a-f-]{36}$'
            AND debt.id = (log.details->>'debtId')::uuid
           LEFT JOIN commerce.customers AS customer ON customer.id = debt.customer_id
          WHERE log.tenant_id = $1
          ORDER BY log.created_at DESC
          LIMIT $2`,
        [tenantId, EVENT_LIMIT],
      );
      return rows.map((row) => ({
        id: `collections-${String(row.id)}`,
        at: isoTime(row.created_at),
        agent: "collections" as ActivityAgentKey,
        text: formatCollectionsEvent(
          String(row.action ?? ""),
          (row.details ?? {}) as Record<string, unknown>,
          row.customer_name ? String(row.customer_name) : null,
        ),
      }));
    } catch {
      return [];
    }
  }

  private async reorderEvents(tenantId: string): Promise<ActivityEvent[]> {
    try {
      const { rows } = await this.query(
        `SELECT id, action, details, created_at
           FROM purchasing.audit_log
          WHERE tenant_id = $1
          ORDER BY created_at DESC
          LIMIT $2`,
        [tenantId, EVENT_LIMIT],
      );
      return rows.map((row) => ({
        id: `reorder-${String(row.id)}`,
        at: isoTime(row.created_at),
        agent: "reorder" as ActivityAgentKey,
        text: formatReorderEvent(String(row.action ?? ""), (row.details ?? {}) as Record<string, unknown>),
      }));
    } catch {
      return [];
    }
  }

  private async supportEvents(tenantId: string): Promise<ActivityEvent[]> {
    try {
      const { rows } = await this.query(
        `SELECT id, action, details, created_at
           FROM support.audit_log
          WHERE tenant_id = $1
          ORDER BY created_at DESC
          LIMIT $2`,
        [tenantId, EVENT_LIMIT],
      );
      return rows.map((row) => ({
        id: `support-${String(row.id)}`,
        at: isoTime(row.created_at),
        agent: "support" as ActivityAgentKey,
        text: formatSupportEvent(String(row.action ?? "")),
      }));
    } catch {
      return [];
    }
  }
}

function formatInvoiceEvent(operation: string, resourceId: string | null, metadata: Record<string, unknown>): string {
  const number = typeof metadata.number === "string" ? metadata.number : resourceId;
  const suffix = number ? ` ${number}` : "";
  if (operation.includes("credit_note")) return `Invoice Cat emitió una nota de crédito${suffix}`;
  if (operation.includes("despatch") || operation.includes("gre")) return `Invoice Cat emitió una guía de remisión${suffix}`;
  if (operation.includes("void") || operation.includes("cancel")) return `Invoice Cat anuló${suffix || " un comprobante"}`;
  if (operation.includes("invoice") || operation.includes("emit") || operation.includes("document")) {
    return `Invoice Cat emitió${suffix || " un comprobante"}`;
  }
  return `Invoice Cat completó una operación${suffix}`;
}

function formatSalesEvent(entity: string, action: string, details: Record<string, unknown>): string {
  const num = details.number ? ` #${String(details.number)}` : "";
  if (entity === "sale" && action === "created") {
    const amount = details.totalCents !== undefined ? ` por ${money(details.totalCents)}` : "";
    return `Sales Cat registró una venta${num}${amount}`;
  }
  if (entity === "sale" && action === "cancelled") return `Sales Cat anuló una venta${num}`;
  if (entity === "sale" && action === "invoiced") {
    const doc = typeof details.invoiceNumber === "string" ? ` (${details.invoiceNumber})` : "";
    return `Sales Cat facturó una venta${doc}`;
  }
  if (entity === "quote" && action === "created") return `Sales Cat preparó una cotización${num}`;
  if (entity === "product") return `Sales Cat actualizó un producto del catálogo`;
  return `Sales Cat actualizó un registro`;
}

function formatCollectionsEvent(action: string, details: Record<string, unknown>, customer: string | null): string {
  const target = customer ? ` a ${customer}` : "";
  if (action === "remind") return `Collections Cat envió un recordatorio${target}`;
  if (action === "add_debt") {
    const amount = details.amountCents !== undefined ? ` por ${money(details.amountCents)}` : "";
    return `Collections Cat registró una deuda${customer ? ` de ${customer}` : ""}${amount}`;
  }
  if (action === "record_payment" || action === "approve_payment") {
    const amount = details.amountCents !== undefined ? ` por ${money(details.amountCents)}` : "";
    return `Collections Cat registró un cobro${amount}`;
  }
  if (action === "capture") return `Collections Cat recibió una constancia de pago`;
  if (action === "reject_payment") return `Collections Cat rechazó una constancia de pago`;
  if (action === "cancel_debt") return `Collections Cat anuló una deuda${customer ? ` de ${customer}` : ""}`;
  if (action === "set_customer") return `Collections Cat actualizó los datos de un cliente`;
  return `Collections Cat actualizó su configuración`;
}

function formatReorderEvent(action: string, details: Record<string, unknown>): string {
  if (action === "approve") return `Reorder Cat aprobó un pedido a proveedor`;
  if (action === "sent") return `Reorder Cat envió un pedido al proveedor`;
  if (action === "send_failed") return `Reorder Cat no pudo enviar un pedido al proveedor`;
  if (action === "supplier_reply") return `Reorder Cat recibió respuesta del proveedor`;
  if (action === "discard") return `Reorder Cat descartó un borrador de pedido`;
  if (action === "change_line") {
    const item = typeof details.item === "string" ? ` (${details.item})` : "";
    return `Reorder Cat ajustó un pedido${item}`;
  }
  if (action === "set_rule") {
    const item = typeof details.item === "string" ? ` para ${details.item}` : "";
    return `Reorder Cat actualizó la regla de reposición${item}`;
  }
  if (action === "set_supplier") return `Reorder Cat actualizó un proveedor`;
  return `Reorder Cat actualizó sus reglas`;
}

function formatSupportEvent(action: string): string {
  if (action === "open_ticket") return `Support Cat te pasó una consulta de cliente`;
  if (action === "answer_ticket") return `Support Cat respondió una consulta`;
  if (action === "close_ticket") return `Support Cat cerró una consulta`;
  return `Support Cat atendió una consulta`;
}
