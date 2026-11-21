import { describe, expect, it, vi } from "vitest";
import { PortalActivityService, formatInvoiceEvent } from "../src/node/portal/activity-service";

const fixedNow = new Date("2026-11-20T15:30:00.000Z"); // 10:30 Lima

describe("PortalActivityService", () => {
  it("returns forbidden when the portal user does not belong to the tenant", async () => {
    const pool = {
      query: vi.fn(async (_sql: string, _values: readonly unknown[] = []) => ({ rows: [] as Array<Record<string, unknown>> })),
    };
    const service = new PortalActivityService(
      pool,
      { decrypt: () => "token" },
      "https://facturaya.test",
      () => undefined,
      () => fixedNow,
    );

    const response = await service.handle("user-outsider", "org_other");
    expect(response).toEqual({ status: "forbidden" });
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][1]).toEqual(["org_other", "user-outsider"]);
  });

  it("returns 14-day series only for active cats and merges audit_log events in chronological order", async () => {
    const pool = {
      query: vi.fn(async (sql: string, values: readonly unknown[] = []) => {
        expect(values[0]).toBe("org_jd");
        if (sql.includes("FROM whatsapp.portal_company_members")) {
          return { rows: [{ "?column?": 1 }] };
        }
        if (sql.includes("FROM whatsapp.tenant_integrations")) {
          return { rows: [{ encrypted_token: "enc-1" }] };
        }
        if (sql.includes("FROM sales.settings")) {
          return { rows: [{ enabled: true }] };
        }
        if (sql.includes("FROM sales.sales")) {
          return { rows: [{ day: "2026-11-19", total_cents: 45000 }] };
        }
        if (sql.includes("FROM receivables.settings")) {
          return { rows: [{ enabled: false }] }; // inactive -> should stay disabled
        }
        if (sql.includes("FROM whatsapp.facturaya_audit_logs")) {
          return {
            rows: [
              {
                id: 1,
                operation: "invoice_issued",
                resource_type: "invoice",
                resource_id: "inv-28",
                metadata: { resultStatus: "accepted" },
                created_at: "2026-11-20T14:15:00.000Z",
              },
              // The same receipt logged twice and a delivery note still in draft are not shown.
              {
                id: 2,
                operation: "invoice_issued",
                resource_type: "invoice",
                resource_id: "inv-28",
                metadata: { resultStatus: "accepted" },
                created_at: "2026-11-20T14:14:00.000Z",
              },
              {
                id: 3,
                operation: "issue_despatch",
                resource_type: "despatch",
                resource_id: "gre-1",
                metadata: { resultStatus: "draft" },
                created_at: "2026-11-20T14:10:00.000Z",
              },
            ],
          };
        }
        if (sql.includes("FROM sales.audit_log")) {
          return {
            rows: [
              {
                id: 10,
                entity: "sale",
                action: "created",
                details: { number: 7, totalCents: 45000 },
                created_at: "2026-11-19T18:00:00.000Z",
              },
            ],
          };
        }
        if (sql.includes("FROM receivables.audit_log")) {
          return {
            rows: [
              {
                id: "aud-1",
                action: "remind",
                details: { debtId: "00000000-0000-4000-8000-000000000001" },
                created_at: "2026-11-20T15:42:00.000Z",
                customer_name: "Bodega Rosita",
              },
            ],
          };
        }
        if (sql.includes("FROM purchasing.audit_log") || sql.includes("FROM support.audit_log")) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
    };

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            { id: "inv-28", document_type: "01", number: "F001-00000028", status: "accepted", issue_date: "2026-11-20",
              currency: "PEN", total: "450.00", customer: { name: "Bodega Rosita" } },
            { status: "accepted", issue_date: "2026-11-20" },
            { status: "rejected", issue_date: "2026-11-20" },
          ],
          meta: { total: 3, last_page: 1 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ) as unknown as typeof fetch;

    const service = new PortalActivityService(
      pool,
      { decrypt: () => "plain-token" },
      "https://facturaya.test",
      () => undefined,
      () => fixedNow,
      fetchMock,
    );

    const response = await service.handle("user-1", "org_jd");
    expect(response.status).toBe("ok");
    if (response.status !== "ok" || !("activity" in response)) {
      throw new Error("Expected ok activity response");
    }

    expect(response.activity.today).toBe("2026-11-20");
    expect(response.activity.active).toEqual({
      invoicing: true,
      sales: true,
      collections: false,
    });
    expect(response.activity.series).toHaveLength(14);
    expect(response.activity.series[0].date).toBe("2026-11-07");
    expect(response.activity.series[12]).toEqual({
      date: "2026-11-19",
      invoices: 0,
      salesCents: 45000,
      collectionsCents: 0,
    });
    expect(response.activity.series[13]).toEqual({
      date: "2026-11-20",
      invoices: 2,
      salesCents: 0,
      collectionsCents: 0,
    });

    expect(response.activity.events.map((e) => e.text)).toEqual([
      "Collections Cat envió un recordatorio a Bodega Rosita",
      "Invoice Cat emitió la factura F001-00000028 a Bodega Rosita por S/ 450.00",
      "Sales Cat registró una venta #7 por S/ 450.00",
    ]);
    for (const event of response.activity.events) {
      expect(event.text.toLowerCase()).not.toMatch(/manolo|radar|facturaya/);
    }
  });

  it("never shows an internal id when the receipt is not found", () => {
    expect(formatInvoiceEvent("invoice_issued", null)).toBe("Invoice Cat emitió un comprobante");
    expect(formatInvoiceEvent("issue_despatch", null)).toBe("Invoice Cat envió una guía de remisión a SUNAT");
    expect(formatInvoiceEvent("invoice_issued", { id: "x", document_type: "03", number: "B001-00000002", total: "35.5", customer: { name: null } }))
      .toBe("Invoice Cat emitió la boleta B001-00000002 por S/ 35.50");
  });
});

