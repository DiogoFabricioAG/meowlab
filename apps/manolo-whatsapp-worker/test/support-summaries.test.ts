import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createBridgeHttpHandler, type BridgeHttpHandlerDependencies } from "../src/node/bridge/http-handler";
import { SupportService } from "../src/node/support/support-service";
import { SUPPORT_BRIDGE_PATH } from "../src/support/bridge-contracts";
import type { BridgeRequestStore } from "../src/node/bridge/request-store";

const SECRET = "test-bridge-secret";

function signBridge(body: string, timestamp: string, requestId: string) {
  const sig = createHmac("sha256", SECRET).update(`${timestamp}.${body}`).digest("hex");
  return {
    "x-manolo-timestamp": timestamp,
    "x-manolo-signature": `sha256=${sig}`,
    "x-manolo-request-id": requestId,
    "content-type": "application/json",
  };
}

function baseDeps(overrides: Partial<BridgeHttpHandlerDependencies>): BridgeHttpHandlerDependencies {
  return {
    sharedSecret: SECRET,
    service: {} as BridgeHttpHandlerDependencies["service"],
    contactRoleResolver: {} as BridgeHttpHandlerDependencies["contactRoleResolver"],
    healthCheck: async () => true,
    log: vi.fn(),
    ...overrides,
  };
}

describe("Support Cat daily summaries (T7)", () => {
  it("runs `summaries` cron without inserting invalid tenant_id='cron' into bridge_requests, once per Lima day at summary_hour", async () => {
    let lastSummaryOn: string | null = null;
    let now = new Date("2026-11-21T00:30:00Z"); // 19:30 Lima on Nov 20 (< summary_hour 20)

    const pool = {
      query: vi.fn(async (sql: string, values: readonly unknown[] = []) => {
        if (sql.includes("UPDATE support.settings AS settings SET last_summary_on")) {
          const today = String(values[0]);
          const hour = Number(values[1]);
          if (20 <= hour && (lastSummaryOn === null || lastSummaryOn < today)) {
            lastSummaryOn = today;
            return { rows: [{ tenant_id: "org_jd", phone_number_id: "123456", name: "CREACIONES J&D" }] };
          }
          return { rows: [] };
        }
        if (sql.includes("FROM support.events")) {
          return { rows: [{ customers: 2, answered: 2, quoted: 0, escalated: 0, rated_yes: 1, rated_no: 0, open: 1 }] };
        }
        if (sql.includes("FROM support.tickets")) {
          return {
            rows: [{
              id: "t1", number: 1, kind: "question", priority: "normal", status: "open",
              customer_name: "Rosa", customer_phone: "51999111222", question: "¿Horario?",
              answer: null, relayed: false, created_at: "2026-11-20T18:00:00Z",
            }],
          };
        }
        if (sql.includes("whatsapp.portal_whatsapp_links")) {
          return { rows: [{ wa_phone: "51988777666" }] };
        }
        return { rows: [] };
      }),
      connect: vi.fn(),
    };

    // Simulate real Postgres FK constraint on whatsapp.bridge_requests(tenant_id): 'cron' fails with 23503!
    const requestStore: BridgeRequestStore = {
      claim: vi.fn(async (identity) => {
        if (identity.tenantId === "cron") {
          const err = new Error('insert or update on table "bridge_requests" violates foreign key constraint') as Error & { code: string };
          err.code = "23503";
          throw err;
        }
        return { status: "claimed" as const };
      }),
      complete: vi.fn(async () => undefined),
      fail: vi.fn(async () => undefined),
    } as unknown as BridgeRequestStore;

    const service = new SupportService(pool, requestStore, vi.fn(), null, null, () => now);
    const handler = createBridgeHttpHandler(baseDeps({
      supportService: service,
      nowSeconds: () => Math.floor(now.getTime() / 1000),
    }));

    const callSummaries = async (reqId: string) => {
      const body = JSON.stringify({ channel_tenant_id: "cron", operation: "summaries", payload: {} });
      const ts = String(Math.floor(now.getTime() / 1000));
      const res = await handler({
        method: "POST",
        path: SUPPORT_BRIDGE_PATH,
        headers: signBridge(body, ts, reqId),
        body,
      });
      return { status: res.status, json: JSON.parse(res.body) as { ok: boolean; data: { summaries: Array<{ companyId: string; ownerPhones: string[]; text: string }> } } };
    };

    // 1. Before summary_hour (19:30 Lima): succeeds with 0 summaries, never touches bridge_requests with 'cron'
    const early = await callSummaries("cron:early");
    expect(early.status).toBe(200);
    expect(early.json.ok).toBe(true);
    expect(early.json.data.summaries).toHaveLength(0);
    expect(requestStore.claim).not.toHaveBeenCalled();

    // 2. At summary_hour (20:05 Lima on Nov 20 = 2026-11-21T01:05:00Z): sends 1 summary and sets last_summary_on
    now = new Date("2026-11-21T01:05:00Z");
    const due = await callSummaries("cron:due");
    expect(due.status).toBe(200);
    expect(due.json.data.summaries).toHaveLength(1);
    expect(due.json.data.summaries[0].companyId).toBe("org_jd");
    expect(due.json.data.summaries[0].ownerPhones).toEqual(["51988777666"]);
    expect(due.json.data.summaries[0].text).toContain("CREACIONES J&D");
    expect(lastSummaryOn).toBe("2026-11-20");

    // 3. Same Lima day retry (21:00 Lima on Nov 20 = 2026-11-21T02:00:00Z): does NOT send twice
    now = new Date("2026-11-21T02:00:00Z");
    const retry = await callSummaries("cron:retry");
    expect(retry.status).toBe(200);
    expect(retry.json.data.summaries).toHaveLength(0);
  });

  it("logs safe errorCode and reason without SQL or personal data in vps_support_processing_failed", async () => {
    const logs: Array<{ event: string; data: Record<string, unknown> }> = [];
    const failingService = {
      process: vi.fn(async () => {
        const err = new Error("sensitive SQL details for phone 51999111222") as Error & { code: string };
        err.code = "23503";
        throw err;
      }),
    };
    const handler = createBridgeHttpHandler(baseDeps({
      supportService: failingService as unknown as SupportService,
      log: (event, data = {}) => logs.push({ event, data }),
    }));
    const body = JSON.stringify({ channel_tenant_id: "cron", operation: "summaries", payload: {} });
    const ts = String(Math.floor(Date.now() / 1000));
    const res = await handler({
      method: "POST",
      path: SUPPORT_BRIDGE_PATH,
      headers: signBridge(body, ts, "req-err-1"),
      body,
    });
    expect(res.status).toBe(500);
    expect(logs).toEqual([
      {
        event: "vps_support_processing_failed",
        data: { operation: "summaries", reason: "Error", errorCode: "23503" },
      },
    ]);
  });
});
