import { describe, expect, it } from "vitest";
import { isPortalEntitlementRequest } from "../src/bridge/portal-entitlement-contracts";
import { PortalEntitlementService } from "../src/node/portal/entitlement-service";
import { PortalWeeklyService } from "../src/node/portal/weekly-service";

const base = {
  version: 1 as const,
  requestId: "r1",
  portalUserId: "billing",
  tenantId: "org_1",
  agents: ["sales"],
  activeUntil: "2026-12-13T15:00:00.000Z",
};

const EXPECTED_SCHEMAS: Array<[string, string]> = [
  ["sales", "sales"],
  ["stock", "stock"],
  ["collections", "receivables"],
  ["reorder", "purchasing"],
  ["support", "support"],
  ["tender", "radar"],
];

describe("portal entitlements (Plan per company)", () => {
  it("validates the request shape", () => {
    expect(isPortalEntitlementRequest(base)).toBe(true);
    expect(isPortalEntitlementRequest({ ...base, agents: [] })).toBe(false);
    expect(isPortalEntitlementRequest({ ...base, agents: ["Sales Cat"] })).toBe(false);
    expect(isPortalEntitlementRequest({ ...base, activeUntil: "pronto" })).toBe(false);
    expect(isPortalEntitlementRequest({ ...base, tenantId: "../x" })).toBe(false);
  });

  it("enables each entitled cat in its own settings table, preserving courtesy and monotonic active_until", async () => {
    const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
    const pool = {
      async query(sql: string, values?: readonly unknown[]) {
        calls.push({ sql, values });
        return { rows: sql.includes("whatsapp.tenants") ? [{ "?column?": 1 }] : [] };
      },
    };
    const service = new PortalEntitlementService(pool, () => undefined);
    const activeUntil = new Date("2026-12-13T15:00:00.000Z");

    const response = await service.handle({
      ...base,
      agents: ["sales", "stock", "collections", "reorder", "support", "tender", "invoice", "sales"],
    } as never);

    expect(response).toEqual({
      status: "ok",
      applied: ["sales", "stock", "collections", "reorder", "support", "tender"],
      skipped: ["invoice"],
    });

    for (const [agent, schema] of EXPECTED_SCHEMAS) {
      const upsert = calls.find((call) => call.sql.includes(`INSERT INTO ${schema}.settings`));
      expect(upsert, `missing upsert for ${agent} (${schema}.settings)`).toBeDefined();
      expect(upsert?.sql).toContain(`GREATEST(${schema}.settings.active_until, EXCLUDED.active_until)`);
      expect(upsert?.sql).toContain(`WHEN ${schema}.settings.source = 'courtesy' AND ${schema}.settings.enabled THEN 'courtesy'`);
      expect(upsert?.values).toEqual(["org_1", activeUntil]);
    }
  });

  it("enforces tenant isolation: only updates the requested active tenant and returns not_found for inactive/missing tenants", async () => {
    const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
    const pool = (activeTenant: string | null) => ({
      async query(sql: string, values?: readonly unknown[]) {
        calls.push({ sql, values });
        if (sql.includes("whatsapp.tenants")) {
          return { rows: values?.[0] === activeTenant ? [{ "?column?": 1 }] : [] };
        }
        return { rows: [] };
      },
    });

    await new PortalEntitlementService(pool("org_1"), () => undefined).handle({
      ...base,
      tenantId: "org_1",
      agents: ["stock", "collections"],
    } as never);

    const upserts = calls.filter((call) => call.sql.includes("INSERT INTO"));
    expect(upserts).toHaveLength(2);
    expect(upserts.every((call) => call.values?.[0] === "org_1")).toBe(true);

    await expect(
      new PortalEntitlementService(pool("org_1"), () => undefined).handle({
        ...base,
        tenantId: "org_2",
        agents: ["stock"],
      } as never),
    ).resolves.toEqual({ status: "not_found" });
  });

  it("handles tender new payment, monotonic renewal, active courtesy preservation and expiration in weekly view", async () => {
    // Stateful in-memory radar.settings table verifying real SQL semantics
    const radarSettings = new Map<string, { enabled: boolean; source: "courtesy" | "subscription"; active_until: Date | null }>();
    const pool = {
      async query(sql: string, values: readonly unknown[] = []) {
        if (sql.includes("FROM whatsapp.tenants")) {
          return { rows: values[0] === "org_sub" || values[0] === "org_jd" ? [{ "?column?": 1 }] : [] };
        }
        if (sql.includes("INSERT INTO radar.settings")) {
          const tenantId = String(values[0]);
          const nextUntil = values[1] as Date;
          const prev = radarSettings.get(tenantId);
          if (!prev) {
            radarSettings.set(tenantId, { enabled: true, source: "subscription", active_until: nextUntil });
          } else if (prev.source === "courtesy" && prev.enabled) {
            // Active courtesy is never touched
          } else {
            const greatest = prev.source === "courtesy" || !prev.active_until || nextUntil > prev.active_until
              ? nextUntil
              : prev.active_until;
            radarSettings.set(tenantId, { enabled: true, source: "subscription", active_until: greatest });
          }
          return { rows: [] };
        }
        if (sql.includes("FROM whatsapp.portal_company_members")) return { rows: [{ "?column?": 1 }] };
        if (sql.includes("FROM radar.settings")) {
          const row = radarSettings.get(String(values[0]));
          const now = values[1] as Date;
          if (!row) return { rows: [] };
          return { rows: [{ active: row.enabled && (row.active_until === null || row.active_until > now) }] };
        }
        return { rows: [] };
      },
    };

    const service = new PortalEntitlementService(pool, () => undefined);
    // 1. New payment for org_sub
    const jan = new Date("2027-01-15T00:00:00.000Z");
    const r1 = await service.handle({ ...base, tenantId: "org_sub", agents: ["tender"], activeUntil: jan.toISOString() });
    expect(r1).toEqual({ status: "ok", applied: ["tender"], skipped: [] });
    expect(radarSettings.get("org_sub")).toEqual({ enabled: true, source: "subscription", active_until: jan });

    // 2. Renewal extends period; older date never shortens it
    const feb = new Date("2027-02-15T00:00:00.000Z");
    await service.handle({ ...base, tenantId: "org_sub", agents: ["tender"], activeUntil: feb.toISOString() });
    await service.handle({ ...base, tenantId: "org_sub", agents: ["tender"], activeUntil: jan.toISOString() });
    expect(radarSettings.get("org_sub")?.active_until).toEqual(feb);

    // 3. Active courtesy is never touched
    radarSettings.set("org_jd", { enabled: true, source: "courtesy", active_until: null });
    await service.handle({ ...base, tenantId: "org_jd", agents: ["tender"], activeUntil: feb.toISOString() });
    expect(radarSettings.get("org_jd")).toEqual({ enabled: true, source: "courtesy", active_until: null });

    // 4. Missing company returns not_found
    expect(await service.handle({ ...base, tenantId: "org_missing", agents: ["tender"] })).toEqual({ status: "not_found" });

    // 5. Expiration disables tender in PortalWeeklyService
    const cipher = { decrypt: () => "" };
    const beforeExp = new PortalWeeklyService(pool, cipher, "https://f.test", () => undefined, () => new Date("2027-02-10T12:00:00.000Z"));
    const afterExp = new PortalWeeklyService(pool, cipher, "https://f.test", () => undefined, () => new Date("2027-02-20T12:00:00.000Z"));
    const resBefore = await beforeExp.handle("u1", "org_sub");
    const resAfter = await afterExp.handle("u1", "org_sub");
    expect(resBefore.status === "ok" && "weekly" in resBefore && resBefore.weekly.tender.enabled).toBe(true);
    expect(resAfter.status === "ok" && "weekly" in resAfter && resAfter.weekly.tender.enabled).toBe(false);
  });
});
