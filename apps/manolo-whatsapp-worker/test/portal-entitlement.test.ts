import { describe, expect, it } from "vitest";
import { isPortalEntitlementRequest } from "../src/bridge/portal-entitlement-contracts";
import { PortalEntitlementService } from "../src/node/portal/entitlement-service";

const base = { version: 1, requestId: "r1", portalUserId: "billing", tenantId: "org_1", agents: ["sales"], activeUntil: "2026-12-13T15:00:00.000Z" };

describe("portal entitlements (Plan per company)", () => {
  it("validates the request shape", () => {
    expect(isPortalEntitlementRequest(base)).toBe(true);
    expect(isPortalEntitlementRequest({ ...base, agents: [] })).toBe(false);
    expect(isPortalEntitlementRequest({ ...base, agents: ["Sales Cat"] })).toBe(false);
    expect(isPortalEntitlementRequest({ ...base, activeUntil: "pronto" })).toBe(false);
    expect(isPortalEntitlementRequest({ ...base, tenantId: "../x" })).toBe(false);
  });

  it("enables only known agents of an active company", async () => {
    const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
    const pool = (exists: boolean) => ({
      async query(sql: string, values?: readonly unknown[]) {
        calls.push({ sql, values });
        return { rows: sql.includes("whatsapp.tenants") && exists ? [{ "?column?": 1 }] : [] };
      },
    });
    const service = new PortalEntitlementService(pool(true), () => undefined);
    await expect(service.handle({ ...base, agents: ["sales", "stock", "sales"] } as never))
      .resolves.toEqual({ status: "ok", applied: ["sales"], skipped: ["stock"] });
    const upsert = calls.find((call) => call.sql.includes("INSERT INTO sales.settings"));
    expect(upsert?.sql).toContain("GREATEST(sales.settings.active_until, EXCLUDED.active_until)");
    expect(upsert?.sql).toContain("WHEN sales.settings.source = 'courtesy'");
    expect(upsert?.values).toEqual(["org_1", new Date("2026-12-13T15:00:00.000Z")]);
    await expect(new PortalEntitlementService(pool(false), () => undefined).handle(base as never)).resolves.toEqual({ status: "not_found" });
  });
});
