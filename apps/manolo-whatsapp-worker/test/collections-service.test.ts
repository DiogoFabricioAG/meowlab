import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import type { BridgeRequestStore } from "../src/node/bridge/request-store";
import { CollectionsService } from "../src/node/collections/collections-service";

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

function createFakePool(queries: RecordedQuery[]) {
  const client = {
    async query(sql: string, params: unknown[] = []) {
      queries.push({ sql, params });
      if (sql.includes("FROM whatsapp.contacts")) {
        return { rows: [{ "?column?": 1 }] };
      }
      if (sql.includes("FROM whatsapp.tenant_members") && sql.includes("receivables.settings")) {
        return { rows: [{ id: "org_jd", name: "CREACIONES J&D" }] };
      }
      if (sql.includes("FROM whatsapp.tenants")) {
        return { rows: [{ name: "CREACIONES J&D" }] };
      }
      if (sql.includes("FROM receivables.debts AS debt") && sql.includes("JOIN commerce.customers")) {
        return {
          rows: [
            {
              id: "debt-1",
              customer_id: "cust-1",
              customer: "Bodega Rosita",
              phone: "51944555666",
              amount_cents: 35000,
              balance_cents: 35000,
              due_on: "2026-11-15",
              document_number: null,
              description: "polos",
              reminders_sent: 0,
            },
          ],
        };
      }
      if (sql.includes("FROM commerce.customers AS customer") && sql.includes("do_not_contact")) {
        return { rows: [{ phone: "51944555666", do_not_contact: false }] };
      }
      if (sql.includes("FROM commerce.customers")) {
        return { rows: [{ id: "cust-1", name: "Bodega Rosita" }] };
      }
      if (sql.includes("FROM receivables.settings")) {
        return {
          rows: [
            {
              default_due_days: 30,
              remind_before_days: 2,
              remind_every_days: 7,
              max_reminders: 3,
              window_start_hour: 9,
              window_end_hour: 19,
              skip_sundays: true,
              yape_phone: null,
              plin_phone: null,
              bank_text: null,
              payment_link: null,
            },
          ],
        };
      }
      return { rows: [] };
    },
    release() {},
  };

  return {
    query: client.query,
    async connect() {
      return client;
    },
  } as unknown as Pool;
}

const memoryStore: BridgeRequestStore = {
  async claim() {
    return { status: "claimed" } as never;
  },
  async complete() {},
  async fail() {},
};

describe("CollectionsService injected clock", () => {
  it("uses this.now() for reminders.created_at and debts.last_reminder_at in remind()", async () => {
    const queries: RecordedQuery[] = [];
    const fixedNow = new Date("2026-11-14T15:00:00.000Z");
    const service = new CollectionsService(
      createFakePool(queries),
      memoryStore,
      () => undefined,
      { async read() { return []; } },
      () => fixedNow,
    );

    const result = await service.process(
      {
        channel_tenant_id: "manolo",
        contact_id: 2,
        company_id: "org_jd",
        operation: "remind",
        payload: { customer: "Bodega Rosita" },
      },
      "req-remind-clock-1",
      "req-remind-clock-1",
    );

    expect(result.status).toBe("completed");
    if (result.status !== "completed" || !result.response.ok) {
      throw new Error(`Expected completed ok response, got: ${JSON.stringify(result)}`);
    }

    const insertReminder = queries.find((q) => q.sql.includes("INSERT INTO receivables.reminders"));
    expect(insertReminder).toBeDefined();
    expect(insertReminder?.sql).toContain("created_at");
    expect(insertReminder?.sql).not.toContain("CURRENT_TIMESTAMP");
    expect(insertReminder?.params[5]).toEqual(fixedNow);

    const updateDebt = queries.find((q) => q.sql.includes("UPDATE receivables.debts SET reminders_sent"));
    expect(updateDebt).toBeDefined();
    expect(updateDebt?.sql).toContain("last_reminder_at = $3");
    expect(updateDebt?.sql).not.toContain("CURRENT_TIMESTAMP");
    expect(updateDebt?.params[2]).toEqual(fixedNow);
  });
});
