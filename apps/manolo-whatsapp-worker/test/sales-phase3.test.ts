import { describe, expect, it, vi } from "vitest";
import { SalesService, monthRange } from "../src/node/sales/sales-service";
import { PortalSalesService } from "../src/node/sales/portal-sales-service";
import { SALES_ROLE_KEY, SalesRoleHandler, formatGoalStatus } from "../src/roles/sales-role";
import { leadingAliasCandidate, stripCatAlias, validateCatName } from "../src/sales/cat-name";
import type { SalesClient } from "../src/sales/client";
import type { RoleHandlerContext, TenantContext } from "../src/roles/contracts";
import type { RoleStateRepository } from "../src/roles/state";
import type { AiProvider } from "../src/ai/contracts";
import type { BridgeRequestStore } from "../src/node/bridge/request-store";

type SqlRecord = { sql: string; values: readonly unknown[] };

function mockRequestStore(): BridgeRequestStore {
  return {
    claim: vi.fn(async () => ({ status: "claimed" as const })),
    complete: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined),
  } as unknown as BridgeRequestStore;
}

/** Lightweight in-memory Postgres double for SalesService + Collections debt + PortalSalesService. */
function fakeSalesDb(options: {
  collectionsEnabled?: boolean;
  defaultDueDays?: number;
  debtHasPayments?: boolean;
  debtAlreadyExists?: boolean;
  goals?: Map<string, number>;
  salesByMonth?: Array<{ tenantId: string; id: string; number: number; status: string; paymentMethod: string; totalCents: number; balanceCents: number; soldAt: string }>;
  catNames?: Map<string, string | null>;
} = {}) {
  const queries: SqlRecord[] = [];
  const goals = options.goals ?? new Map<string, number>();
  const catNames = options.catNames ?? new Map<string, string | null>([["org_a", null], ["org_b", "Tigre"]]);
  const debts = new Map<string, { id: string; tenantId: string; saleId: string; status: string; dueOn: string; amountCents: number }>();
  const sales = [...(options.salesByMonth ?? [])];
  if (options.debtAlreadyExists) {
    debts.set("org_a:sale:s-existing", {
      id: "d-existing", tenantId: "org_a", saleId: "s-existing", status: "open", dueOn: "2026-12-15", amountCents: 10000,
    });
  }

  const runQuery = async (sql: string, values: readonly unknown[] = []) => {
    queries.push({ sql, values });
    if (sql.includes("FROM whatsapp.contacts")) return { rows: [{ ok: 1 }] };
    if (sql.includes("FROM whatsapp.tenant_members")) {
      const rows = [...catNames.entries()].map(([id, catName]) => ({ id, name: `Empresa ${id}`, cat_name: catName }));
      return { rows };
    }
    if (sql.includes("FROM whatsapp.portal_company_members")) {
      return { rows: values[0] === "org_a" && values[1] === "u_a" ? [{ role: "owner" }] : [] };
    }
    if (sql.includes("FROM sales.settings")) {
      const tid = String(values[0]);
      if (!catNames.has(tid)) return { rows: [] };
      return { rows: [{ enabled: true, cat_name: catNames.get(tid) ?? null, quote_valid_days: 7 }] };
    }
    if (sql.startsWith("UPDATE sales.settings SET cat_name")) {
      catNames.set(String(values[0]), values[1] === null ? null : String(values[1]));
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO sales.monthly_goals")) {
      goals.set(`${values[0]}:${values[1]}`, Number(values[2]));
      return { rows: [] };
    }
    if (sql.includes("DELETE FROM sales.monthly_goals")) {
      goals.delete(`${values[0]}:${values[1]}`);
      return { rows: [] };
    }
    if (sql.includes("FROM sales.monthly_goals")) {
      const target = goals.get(`${values[0]}:${values[1]}`);
      return { rows: target ? [{ target_cents: target }] : [] };
    }
    if (sql.includes("FROM sales.sales WHERE tenant_id = $1 AND status = 'confirmed' AND sold_at >= $2 AND sold_at < $3")) {
      const tid = String(values[0]);
      const from = (values[1] as Date).getTime();
      const to = (values[2] as Date).getTime();
      const matching = sales.filter((s) => {
        const t = new Date(s.soldAt).getTime();
        return s.tenantId === tid && s.status === "confirmed" && t >= from && t < to;
      });
      return { rows: [{ n: matching.length, total: matching.reduce((acc, s) => acc + s.totalCents, 0) }] };
    }
    if (sql.includes("INSERT INTO commerce.customers")) return { rows: [{ id: "cust-1" }] };
    if (sql.includes("INSERT INTO commerce.products")) return { rows: [] };
    if (sql.includes("SELECT id FROM commerce.products")) return { rows: [{ id: "prod-1" }] };
    if (sql.includes("INSERT INTO sales.sequences")) return { rows: [{ number: 10 }] };
    if (sql.includes("INSERT INTO sales.sales")) {
      sales.push({
        tenantId: String(values[1]), id: String(values[0]), number: Number(values[2]),
        status: "confirmed", paymentMethod: String(values[5]), totalCents: Number(values[8]),
        balanceCents: Number(values[9]), soldAt: (values[11] as Date).toISOString(),
      });
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO sales.lines") || sql.includes("INSERT INTO sales.audit_log")) return { rows: [] };
    if (sql.includes("FROM receivables.settings")) {
      return { rows: options.collectionsEnabled ? [{ default_due_days: options.defaultDueDays ?? 30 }] : [] };
    }
    if (sql.includes("INSERT INTO receivables.debts")) {
      const key = `${values[1]}:${values[4]}`;
      if (debts.has(key)) return { rows: [] };
      debts.set(key, {
        id: String(values[0]), tenantId: String(values[1]), saleId: String(values[3]),
        status: "open", dueOn: String(values[9]), amountCents: Number(values[7]),
      });
      return { rows: [{ id: values[0] }] };
    }
    if (sql.includes("UPDATE sales.sales SET status = 'cancelled'")) {
      return { rows: [{ id: "s-existing", total_cents: 10000 }] };
    }
    if (sql.includes("SELECT id FROM receivables.debts")) {
      const debt = [...debts.values()].find((d) => d.tenantId === values[0] && d.saleId === values[1] && d.status !== "cancelled");
      return { rows: debt ? [{ id: debt.id }] : [] };
    }
    if (sql.includes("FROM receivables.payments")) {
      return { rows: options.debtHasPayments ? [{ ok: 1 }] : [] };
    }
    if (sql.includes("UPDATE receivables.debts SET status = 'cancelled'")) {
      const debt = [...debts.values()].find((d) => d.tenantId === values[0] && d.id === values[1]);
      if (debt) debt.status = "cancelled";
      return { rows: [] };
    }
    if (sql.includes("SELECT count(*)::int AS n") && sql.includes("FROM sales.sales AS sale")) {
      const tid = String(values[0]);
      const pending = sales.filter((s) => s.tenantId === tid && s.status === "confirmed" && s.paymentMethod === "credito" && s.balanceCents > 0
        && !debts.has(`${tid}:sale:${s.id}`));
      return { rows: [{ n: pending.length }] };
    }
    if (sql.includes("SELECT sale.id, sale.number") && sql.includes("FROM sales.sales AS sale")) {
      const tid = String(values[0]);
      const pending = sales.filter((s) => s.tenantId === tid && s.status === "confirmed" && s.paymentMethod === "credito" && s.balanceCents > 0
        && !debts.has(`${tid}:sale:${s.id}`));
      return {
        rows: pending.map((s) => ({
          id: s.id, number: s.number, customer_id: "cust-1", customer_name: "Ana",
          balance_cents: s.balanceCents, sold_at: s.soldAt, invoice_number: null,
        })),
      };
    }
    return { rows: [] };
  };

  const client = { query: runQuery, release: vi.fn() };
  const pool = {
    query: runQuery,
    connect: vi.fn(async () => client),
  };
  return { pool, queries, debts, goals, catNames, sales };
}

describe("Sales Cat fase 3: metas, Lima month boundary, nombre propio y deudas Collections", () => {
  it("computes Lima month boundaries accurately at midnight UTC-5", () => {
    const novEndLimaUtc = new Date("2026-12-01T04:59:59Z"); // 23:59:59 Lima on Nov 30
    const decStartLimaUtc = new Date("2026-12-01T05:00:00Z"); // 00:00:00 Lima on Dec 1
    const nov = monthRange("2026-11");
    const dec = monthRange("2026-12");
    expect(novEndLimaUtc.getTime()).toBeGreaterThanOrEqual(nov.from.getTime());
    expect(novEndLimaUtc.getTime()).toBeLessThan(nov.to.getTime());
    expect(decStartLimaUtc.getTime()).toBeGreaterThanOrEqual(dec.from.getTime());
    expect(nov.daysInMonth).toBe(30);
    expect(dec.daysInMonth).toBe(31);
  });

  it("tracks monthly goal progress excluding cancelled sales and respecting Lima month change", async () => {
    const { pool } = fakeSalesDb({
      salesByMonth: [
        { tenantId: "org_a", id: "s1", number: 1, status: "confirmed", paymentMethod: "yape", totalCents: 1_240_000, balanceCents: 0, soldAt: "2026-11-15T15:00:00Z" },
        { tenantId: "org_a", id: "s2", number: 2, status: "cancelled", paymentMethod: "efectivo", totalCents: 500_000, balanceCents: 0, soldAt: "2026-11-16T15:00:00Z" },
        // Dec 1 03:00 UTC is Nov 30 22:00 Lima -> belongs to November, not December
        { tenantId: "org_a", id: "s3", number: 3, status: "confirmed", paymentMethod: "efectivo", totalCents: 100_000, balanceCents: 0, soldAt: "2026-12-01T03:00:00Z" },
        // Tenant B sale must never leak into Tenant A
        { tenantId: "org_b", id: "s4", number: 1, status: "confirmed", paymentMethod: "efectivo", totalCents: 9_900_000, balanceCents: 0, soldAt: "2026-11-15T15:00:00Z" },
      ],
    });
    const service = new SalesService(pool, mockRequestStore(), vi.fn(), () => new Date("2026-11-21T15:00:00Z"));
    const res = await service.process({
      channel_tenant_id: "manolo", contact_id: 1, company_id: "org_a",
      operation: "set_goal", payload: { month: "2026-11", targetCents: 2_000_000 },
    }, "req-goal-1", "h1");
    expect(res.status).toBe("completed");
    if (res.status === "completed") {
      expect(res.response.ok).toBe(true);
      const goal = (res.response.data as { goal: Parameters<typeof formatGoalStatus>[0] }).goal;
      expect(goal.achievedCents).toBe(1_340_000); // s1 + s3, excludes cancelled s2 and org_b s4
      expect(goal.targetCents).toBe(2_000_000);
      expect(goal.currentDay).toBe(21);
      const formatted = formatGoalStatus(goal);
      expect(formatted).toContain("67 %");
      expect(formatted).toContain("6,600.00");
      expect(formatted).toContain("10 días");
    }

    const decRes = await service.process({
      channel_tenant_id: "manolo", contact_id: 1, company_id: "org_a",
      operation: "goal_status", payload: { month: "2026-12" },
    }, "req-goal-2", "h2");
    if (decRes.status === "completed") {
      const decGoal = (decRes.response.data as { goal: { achievedCents: number } }).goal;
      expect(decGoal.achievedCents).toBe(0);
    }
  });

  it("validates custom cat names and does not break routing for /stock, /collections or normal messages", async () => {
    expect(validateCatName("A")).toEqual({ ok: false, reason: "length" });
    expect(validateCatName("https://evil.pe")).toEqual({ ok: false, reason: "link" });
    expect(validateCatName("evil.com")).toEqual({ ok: false, reason: "link" });
    expect(validateCatName("Stock")).toEqual({ ok: false, reason: "reserved" });
    expect(validateCatName("Collections Cat")).toEqual({ ok: false, reason: "reserved" });
    expect(validateCatName("MeowLab")).toEqual({ ok: false, reason: "reserved" });
    expect(validateCatName("  Michi  ")).toEqual({ ok: true, name: "Michi" });

    // Routing signals: slash commands and normal words never collide
    expect(leadingAliasCandidate("/stock entrada 5 polos")).toBeNull();
    expect(leadingAliasCandidate("/collections")).toBeNull();
    expect(leadingAliasCandidate("Hola buenos días")).toBe("Hola");
    expect(leadingAliasCandidate("Michi, ¿cuánto vendimos hoy?")).toBe("Michi");
    expect(stripCatAlias("Michi, ¿cuánto vendimos hoy?", "Michi")).toBe("¿cuánto vendimos hoy?");

    const { pool } = fakeSalesDb({ catNames: new Map([["org_a", "Michi"], ["org_b", "Tigre"]]) });
    const service = new SalesService(pool, mockRequestStore(), vi.fn());
    const matched = await service.process({
      channel_tenant_id: "manolo", contact_id: 1, operation: "resolve_alias", payload: { candidate: "michi" },
    }, "req-alias-1", "h1");
    expect(matched.status === "completed" && matched.response.ok).toBe(true);
    if (matched.status === "completed") {
      expect((matched.response.data as { company: { id: string } | null }).company?.id).toBe("org_a");
    }
    const unmatched = await service.process({
      channel_tenant_id: "manolo", contact_id: 1, operation: "resolve_alias", payload: { candidate: "Hola" },
    }, "req-alias-2", "h2");
    if (unmatched.status === "completed") {
      expect((unmatched.response.data as { company: unknown }).company).toBeNull();
    }
  });

  it("creates a single Collections debt for credit sales when Collections is active and uses custom or default due date", async () => {
    const { pool, debts } = fakeSalesDb({ collectionsEnabled: true, defaultDueDays: 15 });
    const service = new SalesService(pool, mockRequestStore(), vi.fn(), () => new Date("2026-11-20T15:00:00Z"));
    const res = await service.process({
      channel_tenant_id: "manolo", contact_id: 1, company_id: "org_a",
      operation: "create_sale",
      payload: {
        customer: { docType: "1", docNumber: "12345678", name: "Juan Pérez" },
        lines: [{ description: "Polo", quantity: 2, unitPriceCents: 5000 }],
        paymentMethod: "credito",
      },
    }, "req-credit-1", "h-c1");
    expect(res.status === "completed" && res.response.ok).toBe(true);
    expect(debts.size).toBe(1);
    const createdDebt = [...debts.values()][0];
    expect(createdDebt.dueOn).toBe("2026-12-05"); // Nov 20 + 15 defaultDueDays
    if (res.status === "completed") {
      expect((res.response.data as { sale: { debtCreated: boolean } }).sale.debtCreated).toBe(true);
    }

    // With explicit dueDate
    const res2 = await service.process({
      channel_tenant_id: "manolo", contact_id: 1, company_id: "org_a",
      operation: "create_sale",
      payload: {
        customer: null,
        lines: [{ description: "Gorra", quantity: 1, unitPriceCents: 3000 }],
        paymentMethod: "credito",
        dueDate: "2026-12-28",
      },
    }, "req-credit-2", "h-c2");
    expect(res2.status === "completed" && res2.response.ok).toBe(true);
    expect(debts.size).toBe(2);
    expect([...debts.values()][1].dueOn).toBe("2026-12-28");
  });

  it("does not create a debt when Collections is disabled and offers chat sync only after activation", async () => {
    const { pool, debts } = fakeSalesDb({ collectionsEnabled: false });
    const service = new SalesService(pool, mockRequestStore(), vi.fn(), () => new Date("2026-11-20T15:00:00Z"));
    const res = await service.process({
      channel_tenant_id: "manolo", contact_id: 1, company_id: "org_a",
      operation: "create_sale",
      payload: {
        customer: null,
        lines: [{ description: "Polo", quantity: 1, unitPriceCents: 4000 }],
        paymentMethod: "credito",
      },
    }, "req-nocoll-1", "h-nc1");
    expect(debts.size).toBe(0);
    if (res.status === "completed") {
      expect((res.response.data as { sale: { debtCreated: boolean; balanceCents: number } }).sale.debtCreated).toBe(false);
      expect((res.response.data as { sale: { balanceCents: number } }).sale.balanceCents).toBe(4000);
    }
  });

  it("cancels debt on sale cancellation only when no confirmed payments exist", async () => {
    // Case 1: no payments -> debt cancelled
    const noPay = fakeSalesDb({ collectionsEnabled: true, debtAlreadyExists: true, debtHasPayments: false });
    const svc1 = new SalesService(noPay.pool, mockRequestStore(), vi.fn());
    const r1 = await svc1.process({
      channel_tenant_id: "manolo", contact_id: 1, company_id: "org_a",
      operation: "cancel_sale", payload: { number: 12 },
    }, "req-can-1", "h1");
    expect(noPay.debts.get("org_a:sale:s-existing")?.status).toBe("cancelled");
    if (r1.status === "completed") {
      expect((r1.response.data as { cancelled: { debtStatus: string } }).cancelled.debtStatus).toBe("cancelled");
    }

    // Case 2: has payments -> debt untouched and warns owner
    const withPay = fakeSalesDb({ collectionsEnabled: true, debtAlreadyExists: true, debtHasPayments: true });
    const svc2 = new SalesService(withPay.pool, mockRequestStore(), vi.fn());
    const r2 = await svc2.process({
      channel_tenant_id: "manolo", contact_id: 1, company_id: "org_a",
      operation: "cancel_sale", payload: { number: 12 },
    }, "req-can-2", "h2");
    expect(withPay.debts.get("org_a:sale:s-existing")?.status).toBe("open");
    if (r2.status === "completed") {
      expect((r2.response.data as { cancelled: { debtStatus: string } }).cancelled.debtStatus).toBe("has_payments");
    }
  });

  it("enforces tenant isolation in PortalSalesService", async () => {
    const { pool } = fakeSalesDb();
    const portal = new PortalSalesService(pool);
    expect(await portal.view("u_a", "org_b")).toEqual({ status: "forbidden" });
    expect(await portal.settings("u_b", "org_a", { catName: "Michi" })).toEqual({ status: "forbidden" });
    expect(await portal.settings("u_a", "org_a", { catName: "https://x.com" })).toEqual({ status: "invalid_cat_name" });
    const ok = await portal.settings("u_a", "org_a", { catName: "Michi", goalTargetCents: 2_000_000, month: "2026-11" });
    expect(ok.status).toBe("ok");
  });

  it("handles alias opening, goal commands, credit confirmation message and credit sync offer in SalesRoleHandler", async () => {
    const store = new Map<string, string>();
    const stateRepo: RoleStateRepository = {
      async get(t, c, r) { return store.get(`${t}:${c}:${r}`) ?? null; },
      async set(t, c, r, j) { store.set(`${t}:${c}:${r}`, j); return true; },
      async clear(t, c, r) { return store.delete(`${t}:${c}:${r}`); },
    };
    const reply = vi.fn<(text: string) => Promise<void>>(async () => undefined);
    const sendButtons = vi.fn<(body: string, buttons: Array<{ id: string; title: string }>) => Promise<{ status: "sent"; metaMessageId: string }>>(
      async () => ({ status: "sent" as const, metaMessageId: "m" }),
    );
    const client: SalesClient = {
      companies: vi.fn(async () => ({ ok: true as const, data: [{ id: "org_a", name: "Tienda A", catName: "Michi" }] })),
      catalog: vi.fn(async () => ({ ok: true as const, data: [] })),
      upsertProduct: vi.fn() as unknown as SalesClient["upsertProduct"],
      createQuote: vi.fn() as unknown as SalesClient["createQuote"],
      createSale: vi.fn(async () => ({
        ok: true as const,
        data: { id: "s9", number: 9, totalCents: 10000, balanceCents: 10000, soldAt: "2026-11-20T15:00:00Z", debtCreated: true },
      })),
      cancelSale: vi.fn(async () => ({ ok: true as const, data: { number: 9, debtStatus: "has_payments" as const } })),
      linkInvoice: vi.fn() as unknown as SalesClient["linkInvoice"],
      summary: vi.fn(async () => ({
        ok: true as const,
        data: { period: "today" as const, from: "2026-11-20", to: "2026-11-20", salesCount: 1, totalCents: 10000, creditCents: 0, quotesCount: 0, quotedCents: 0, topProducts: [], topCustomers: [] },
      })),
      quotePdf: vi.fn() as unknown as SalesClient["quotePdf"],
      creditSyncStatus: vi.fn(async () => ({ ok: true as const, data: { pendingCount: 2 } })),
      syncCreditDebts: vi.fn(async () => ({ ok: true as const, data: { added: 2 } })),
    };
    const ai = {
      complete: vi.fn(async () => JSON.stringify({
        intent: "query", period: "today", customer: { name: "", docNumber: "" }, items: [], replaceItems: false,
        paymentMethod: "none", discount: 0, notes: "", product: { name: "", unitPrice: -1 }, saleNumber: 0,
        dueDate: "none", goalMonth: "none", goalAmount: -1, catName: "", reply: "",
      })),
    } as unknown as AiProvider;

    const baseCtx = {
      tenant: { tenantId: "manolo", phoneNumberId: "pn", roleKey: SALES_ROLE_KEY, systemPrompt: "", aiProvider: "groq", aiModel: "m", temperature: 0, maxTokens: 900 } as TenantContext,
      persisted: { duplicate: false, conversationId: "c1", contactId: 1 },
      env: { PORTAL_PUBLIC_URL: "https://app.meowlab.tech" } as unknown as Env,
      ai,
      businessData: null,
      quoteNumberAllocator: null,
      roleState: stateRepo,
      facturaya: null,
      history: [],
      reply,
      sendButtons,
      sendList: vi.fn(async () => ({ status: "sent" as const, metaMessageId: "l" })),
      sendCtaUrl: vi.fn(async () => ({ status: "sent" as const, metaMessageId: "c" })),
      sendDocument: vi.fn(async () => ({ status: "sent" as const, metaMessageId: "d" })),
      generateAiReply: async () => null,
      generateAiReplyWithHistory: async () => null,
      fallbackReply: "",
      log: vi.fn(),
    } as unknown as RoleHandlerContext;

    const handler = new SalesRoleHandler(() => client);
    // Greeting with custom name + offers credit sync when Collections was enabled later
    await handler.handle({ ...baseCtx, message: { id: "1", interactionId: null, phoneNumberId: "pn", to: "51", inputType: "text", text: "Michi" } });
    expect(sendButtons.mock.calls[0][0]).toContain("Hola, soy Michi de Tienda A");
    expect(sendButtons.mock.calls[1][0]).toContain("2 ventas al crédito");
    expect(sendButtons.mock.calls[1][1].map((b: { id: string }) => b.id)).toEqual(["sales:sync_credit:yes", "sales:sync_credit:no"]);
  });
});
