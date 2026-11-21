import { describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import type { PortalBridge } from "../server/bridge";
import { activityDayLabel, buildSeriesMetrics, formatActivityWhen, groupActivityByDay, normalizeSparkline } from "../web/src/HomeActivity";
import type { CompanyActivity } from "../web/src/agents";

function makeApp(companiesImpl: PortalBridge["companies"]) {
  return createApp({
    allowedOrigins: ["https://app.meowlab.tech"],
    appUrl: "https://app.meowlab.tech/",
    googleEnabled: false,
    auth: {
      api: {
        async getSession() {
          return {
            user: { id: "user-1", name: "Rosa", email: "rosa@example.com", image: null },
            session: { id: "sess-1" },
          };
        },
      },
      handler: () => new Response("ok"),
    } as never,
    bridge: {
      companies: companiesImpl,
    } as Partial<PortalBridge> as PortalBridge,
  });
}

describe("GET /api/companies/:tenantId/activity", () => {
  it("returns activity for an authorized member and enforces 403/503", async () => {
    const sample: CompanyActivity = {
      today: "2026-11-20",
      active: { invoicing: true, sales: true, collections: false },
      series: [{ date: "2026-11-20", invoices: 3, salesCents: 12000, collectionsCents: 0 }],
      events: [{ id: "e1", at: "2026-11-20T15:42:00.000Z", agent: "collections", text: "Collections Cat envió un recordatorio a Bodega Rosita" }],
    };

    const okApp = makeApp(async (_userId, action) => {
      expect(action).toEqual({ action: "activity", tenantId: "org_1" });
      return { status: "ok", activity: sample };
    });
    const okRes = await okApp.request("/api/companies/org_1/activity");
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toEqual(sample);

    const forbiddenApp = makeApp(async () => ({ status: "forbidden" }));
    expect((await forbiddenApp.request("/api/companies/org_1/activity")).status).toBe(403);

    const downApp = makeApp(async () => null);
    expect((await downApp.request("/api/companies/org_1/activity")).status).toBe(503);
  });
});

describe("HomeActivity series calculations", () => {
  it("includes only active cats and normalizes sparkline points", () => {
    const activity: CompanyActivity = {
      today: "2026-11-20",
      active: { invoicing: true, sales: false, collections: true },
      series: [
        { date: "2026-11-19", invoices: 2, salesCents: 5000, collectionsCents: 10000 },
        { date: "2026-11-20", invoices: 4, salesCents: 9000, collectionsCents: 0 },
      ],
      events: [],
    };

    const metrics = buildSeriesMetrics(activity);
    expect(metrics.map((m) => m.key)).toEqual(["invoices", "collections"]);
    expect(metrics[0].totalText).toBe("6 comprobantes");
    expect(metrics[0].values).toEqual([2, 4]);
    expect(metrics[1].values).toEqual([10000, 0]);
    expect(normalizeSparkline([0, 2, 4], 100, 50, 5)).toBe("0,45 50,25 100,5");
  });

  it("formats Lima time for today and earlier days", () => {
    expect(formatActivityWhen("2026-11-20T15:42:00.000Z", "2026-11-20")).toBe("10:42");
    expect(formatActivityWhen("2026-11-19T15:42:00.000Z", "2026-11-20")).toBe("19/11 · 10:42");
  });
});

describe("Actividad reciente agrupada por día", () => {
  it("labels today, yesterday and older days in Lima time", () => {
    expect(activityDayLabel("2026-11-20", "2026-11-20")).toBe("Hoy");
    expect(activityDayLabel("2026-11-19", "2026-11-20")).toBe("Ayer");
    expect(activityDayLabel("2026-11-16", "2026-11-20")).toMatch(/^Lunes,? 16/);
  });

  it("groups newest first and uses the Lima day, not the UTC one", () => {
    const groups = groupActivityByDay([
      { id: "a", at: "2026-11-16T11:56:00.000Z", agent: "invoice", text: "Invoice Cat emitió la factura F001-00000027" },
      { id: "b", at: "2026-11-21T03:30:00.000Z", agent: "sales", text: "Sales Cat registró una venta" },
      { id: "c", at: "2026-11-20T15:00:00.000Z", agent: "collections", text: "Collections Cat envió un recordatorio" },
    ], "2026-11-20");
    expect(groups.map((group) => [group.label, group.events.map((event) => `${event.id}@${event.time}`)])).toEqual([
      ["Hoy", ["b@22:30", "c@10:00"]],
      [expect.stringMatching(/^Lunes,? 16/), ["a@06:56"]],
    ]);
  });
});


import { settingsStatus } from "../web/src/SettingsPage";

describe("Configuración: estado de cada gato", () => {
  it("reduces each agent state to a short status", () => {
    expect(settingsStatus({ kind: "active", today: "x" })).toEqual({ label: "Activo", tone: "on" });
    expect(settingsStatus({ kind: "setup", step: "x" })).toEqual({ label: "Falta configurar", tone: "pending" });
    expect(settingsStatus({ kind: "available", priceCents: 2900 })).toEqual({ label: "Disponible en Plan", tone: "off" });
    expect(settingsStatus({ kind: "soon", priceCents: null }).label).toBe("Próximamente");
  });
});
