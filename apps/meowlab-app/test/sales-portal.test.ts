import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app";
import type { PortalBridge } from "../server/bridge";
import { todayLine, type Weekly } from "../web/src/agents";

function fakeAuth(userId = "u_1") {
  return {
    handler: vi.fn(async () => new Response("ok")),
    api: { getSession: vi.fn(async () => ({ user: { id: userId, name: "Ana", email: "ana@prueba.pe" }, session: { id: "s_1" } })) },
  };
}

describe("Portal Sales Cat (fase 3)", () => {
  it("formats todayLine with monthly goal progress when goalTargetCents is set", () => {
    const weekly = {
      week: { start: "2026-11-16", end: "2026-11-22" },
      today: "2026-11-20",
      team: { members: 1, messages: 0, activePeople: 0, previousMessages: 0, messagesToday: 0 },
      tender: { enabled: false, found: 0, foundToday: 0, interesting: 0, highlights: [] },
      sales: {
        enabled: true, todayCount: 0, todayTotalCents: 0, weekCount: 3, weekTotalCents: 1_240_000, weekQuotes: 0,
        goalTargetCents: 2_000_000, monthTotalCents: 1_240_000,
      },
      invoicing: null,
    } as Weekly;
    const line = todayLine("sales", weekly);
    expect(line).toContain("Meta del mes:");
    expect(line).toContain("12,400.00");
    expect(line).toContain("20,000.00");
    expect(line).toContain("62 %");
  });

  it("relays GET /api/companies/:tenantId/sales and validates POST /sales/settings", async () => {
    const companies = vi.fn(async (_uid, req) => {
      if (req.action === "sales_view") {
        return {
          status: "ok" as const,
          sales: { enabled: true as const, owner: true, catName: "Michi", month: "2026-11", goalTargetCents: 2_000_000, monthTotalCents: 1_240_000, monthCount: 4, daysInMonth: 30, currentDay: 20 },
        };
      }
      if (req.action === "sales_settings" && req.change.catName === "Stock") {
        return { status: "invalid_cat_name" as const };
      }
      return {
        status: "ok" as const,
        sales: { enabled: true as const, owner: true, catName: "Michi", month: "2026-11", goalTargetCents: 2_500_000, monthTotalCents: 1_240_000, monthCount: 4, daysInMonth: 30, currentDay: 20 },
      };
    });
    const app = createApp({
      auth: fakeAuth() as never,
      allowedOrigins: ["https://app.meowlab.tech"],
      bridge: { link: vi.fn(), billing: vi.fn(), companies } as unknown as PortalBridge,
      admin: null,
      billing: null,
      log: vi.fn(),
    });

    const getRes = await app.request("https://app.meowlab.tech/api/companies/org_1/sales");
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toMatchObject({ enabled: true, catName: "Michi", goalTargetCents: 2_000_000 });

    const badGoal = await app.request("https://app.meowlab.tech/api/companies/org_1/sales/settings", {
      method: "POST",
      headers: { Origin: "https://app.meowlab.tech", "Content-Type": "application/json" },
      body: JSON.stringify({ goalTargetCents: -10 }),
    });
    expect(badGoal.status).toBe(400);

    const reservedName = await app.request("https://app.meowlab.tech/api/companies/org_1/sales/settings", {
      method: "POST",
      headers: { Origin: "https://app.meowlab.tech", "Content-Type": "application/json" },
      body: JSON.stringify({ catName: "Stock" }),
    });
    expect(reservedName.status).toBe(400);
    expect(await reservedName.json()).toEqual({ error: "invalid_cat_name" });

    const okRes = await app.request("https://app.meowlab.tech/api/companies/org_1/sales/settings", {
      method: "POST",
      headers: { Origin: "https://app.meowlab.tech", "Content-Type": "application/json" },
      body: JSON.stringify({ goalTargetCents: 2_500_000 }),
    });
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toMatchObject({ goalTargetCents: 2_500_000 });
  });
});
