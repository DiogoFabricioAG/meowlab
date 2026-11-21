import { describe, expect, it } from "vitest";
import { isPortalEntitlementRequest } from "../src/bridge/portal-entitlement-contracts";
import { PortalEntitlementService } from "../src/node/portal/entitlement-service";

const base = {
  version: 1,
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
      applied: ["sales", "stock", "collections", "reorder", "support"],
      skipped: ["tender", "invoice"],
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
});
