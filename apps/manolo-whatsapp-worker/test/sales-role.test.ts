import { describe, expect, it, vi } from "vitest";
import type { RoleHandlerContext, TenantContext } from "../src/roles/contracts";
import type { RoleStateRepository } from "../src/roles/state";
import { SALES_ROLE_KEY, SalesRoleHandler, formatSummary, isSalesCommand, parseSalesState } from "../src/roles/sales-role";
import type { SalesClient } from "../src/sales/client";
import type { FacturayaClient } from "../src/facturaya/contracts";
import { isSalesBridgeRequest } from "../src/sales/bridge-contracts";
import type { AiProvider } from "../src/ai/contracts";

const tenant: TenantContext = {
  tenantId: "manolo", phoneNumberId: "pn", roleKey: SALES_ROLE_KEY, systemPrompt: "", aiProvider: "groq",
  aiModel: "openai/gpt-oss-120b", temperature: 0, maxTokens: 900,
};

function memoryState(): RoleStateRepository & { store: Map<string, string> } {
  const store = new Map<string, string>();
  const key = (t: string, c: number, r: string) => `${t}:${c}:${r}`;
  return {
    store,
    async get(t, c, r) { return store.get(key(t, c, r)) ?? null; },
    async set(t, c, r, json) { store.set(key(t, c, r), json); return true; },
    async clear(t, c, r) { return store.delete(key(t, c, r)); },
  };
}

function fakeClient(overrides: Partial<SalesClient> = {}): SalesClient & Record<string, ReturnType<typeof vi.fn>> {
  return {
    companies: vi.fn(async () => ({ ok: true as const, data: [{ id: "org_jd", name: "CREACIONES J&D" }] })),
    catalog: vi.fn(async () => ({ ok: true as const, data: [{ name: "Polo blanco", unitPriceCents: 2500 }] })),
    upsertProduct: vi.fn(async (_c: string, name: string, cents: number) => ({ ok: true as const, data: { name, unitPriceCents: cents, created: true } })),
    createQuote: vi.fn(async () => ({ ok: true as const, data: { id: "q1", number: 7, totalCents: 15000, validUntil: "2026-11-20", publicToken: "AbCdEfGhIjKlMnOpQrStUv" } })),
    createSale: vi.fn(async () => ({ ok: true as const, data: { id: "s1", number: 12, totalCents: 7500, balanceCents: 0, soldAt: "2026-11-13T15:00:00Z" } })),
    cancelSale: vi.fn(async (_c: string, number: number) => ({ ok: true as const, data: { number } })),
    linkInvoice: vi.fn(async () => ({ ok: true as const, data: true as const })),
    summary: vi.fn(async () => ({ ok: true as const, data: {
      period: "today" as const, from: "2026-11-13", to: "2026-11-13", salesCount: 3, totalCents: 22500, creditCents: 5000,
      quotesCount: 1, quotedCents: 15000, topProducts: [{ description: "Polo blanco", quantity: 9, totalCents: 22500 }],
      topCustomers: [{ name: "Juan Pérez", salesCount: 2, totalCents: 15000 }] } })),
    ...overrides,
  } as SalesClient & Record<string, ReturnType<typeof vi.fn>>;
}

/** An AI that answers each call with the next queued extraction. */
function scriptedAi(...answers: Array<Record<string, unknown>>): AiProvider {
  const base = { intent: "other", period: "none", customer: { name: "", docNumber: "" }, items: [], replaceItems: false,
    paymentMethod: "none", discount: 0, notes: "", product: { name: "", unitPrice: -1 }, saleNumber: 0, reply: "" };
  return { complete: vi.fn(async () => JSON.stringify({ ...base, ...answers.shift() })) } as unknown as AiProvider;
}

function run(options: { text?: string; interactionId?: string | null; client: SalesClient; ai?: AiProvider | null;
  state: ReturnType<typeof memoryState>; facturaya?: FacturayaClient | null }) {
  const calls = {
    reply: vi.fn(async (_text: string) => undefined),
    sendButtons: vi.fn(async (_body: string, _buttons: Array<{ id: string; title: string }>) => ({ status: "sent" as const, metaMessageId: "b" })),
    sendList: vi.fn(async () => ({ status: "sent" as const, metaMessageId: "l" })),
    sendCtaUrl: vi.fn(async (_body: string, _label: string, _url: string) => ({ status: "sent" as const, metaMessageId: "c" })),
    sendDocument: vi.fn(async () => ({ status: "sent" as const, metaMessageId: "d" })),
  };
  const context = {
    message: { id: "wamid.1", interactionId: options.interactionId ?? null, phoneNumberId: "pn", to: "51911111111", inputType: "text",
      text: options.text ?? options.interactionId ?? "" },
    tenant,
    persisted: { duplicate: false, conversationId: "c", contactId: 1 },
    env: { PORTAL_PUBLIC_URL: "https://app.meowlab.tech" } as unknown as Env,
    ai: options.ai ?? null,
    businessData: null,
    quoteNumberAllocator: null,
    roleState: options.state,
    facturaya: options.facturaya ?? null,
    history: [],
    ...calls,
    generateAiReply: async () => null,
    generateAiReplyWithHistory: async () => null,
    fallbackReply: "",
    log: vi.fn(),
  } as unknown as RoleHandlerContext;
  return { promise: new SalesRoleHandler(() => options.client).handle(context), calls };
}

describe("Sales Cat commands and state", () => {
  it("recognises /sales and expires sessions", () => {
    expect(isSalesCommand("/sales")).toBe(true);
    expect(isSalesCommand("/SALES vendí 2 polos")).toBe(true);
    expect(isSalesCommand("sales")).toBe(false);
    expect(parseSalesState(JSON.stringify({ v: 1, expiresAt: 10 }), 20)).toBeNull();
    expect(parseSalesState(JSON.stringify({ v: 1, expiresAt: 30 }), 20)).not.toBeNull();
  });

  it("validates bridge requests", () => {
    const base = { channel_tenant_id: "manolo", contact_id: 1, company_id: "org_jd" };
    const line = { description: "Polo", quantity: 2, unitPriceCents: 2500 };
    expect(isSalesBridgeRequest({ ...base, operation: "create_sale", payload: { customer: null, lines: [line], paymentMethod: "yape" } })).toBe(true);
    expect(isSalesBridgeRequest({ ...base, operation: "create_sale", payload: { customer: null, lines: [line], paymentMethod: "bitcoin" } })).toBe(false);
    expect(isSalesBridgeRequest({ ...base, operation: "create_quote", payload: { customer: { docType: "6", docNumber: "123", name: "X" }, lines: [line] } })).toBe(false);
    expect(isSalesBridgeRequest({ ...base, operation: "create_quote", payload: { customer: null, lines: [] } })).toBe(false);
    expect(isSalesBridgeRequest({ channel_tenant_id: "manolo", contact_id: 1, operation: "summary", payload: { period: "week" } })).toBe(false);
    expect(isSalesBridgeRequest({ channel_tenant_id: "manolo", contact_id: 1, operation: "companies" })).toBe(true);
  });
});

describe("Sales Cat role", () => {
  it("opens with a menu for the only company", async () => {
    const state = memoryState();
    const { promise, calls } = run({ text: "/sales", client: fakeClient(), state });
    await promise;
    expect(calls.sendButtons.mock.calls[0][0]).toContain("CREACIONES J&D");
    expect(calls.sendButtons.mock.calls[0][1].map((b) => b.id)).toEqual(["sales:start:sale", "sales:start:quote", "sales:query:today"]);
    expect(parseSalesState(state.store.get("manolo:1:sales") ?? null)?.companyId).toBe("org_jd");
  });

  it("refuses companies without Sales Cat and closes the session", async () => {
    const state = memoryState();
    const client = fakeClient({ companies: vi.fn(async () => ({ ok: true as const, data: [] })) });
    const { promise, calls } = run({ text: "/sales", client, state });
    await promise;
    expect(calls.reply.mock.calls[0][0]).toContain("todavía no está activo");
    expect(state.store.size).toBe(0);
  });

  it("registers a sale: catalog price, payment, confirmation, then offers a receipt", async () => {
    const state = memoryState();
    const client = fakeClient();
    const ai = scriptedAi({ intent: "sale", items: [{ description: "Polo blanco", quantity: 3, unitPrice: 25 }], customer: { name: "Juan Pérez", docNumber: "" } });
    const first = run({ text: "/sales vendí 3 polos blancos a Juan Pérez", client, ai, state });
    await first.promise;
    expect(first.calls.sendList).toHaveBeenCalled(); // asks how they paid

    const paid = run({ interactionId: "sales:pay:yape", client, state });
    await paid.promise;
    expect(paid.calls.sendButtons.mock.calls[0][0]).toContain("Total: S/ 75.00");

    const confirm = run({ interactionId: "sales:confirm", client, state });
    await confirm.promise;
    expect(client.createSale).toHaveBeenCalledWith("org_jd", {
      customer: { docType: "0", docNumber: null, name: "Juan Pérez" },
      lines: [{ description: "Polo blanco", quantity: 3, unitPriceCents: 2500 }],
      discountCents: 0, notes: null, paymentMethod: "yape",
    });
    expect(confirm.calls.sendButtons.mock.calls[0][1].map((b) => b.id)).toEqual(["sales:invoice:01", "sales:invoice:03", "sales:invoice:none"]);
  });

  it("asks for a missing price instead of inventing it", async () => {
    const state = memoryState();
    const ai = scriptedAi({ intent: "sale", items: [{ description: "Taza estampada", quantity: 2, unitPrice: -1 }] });
    const { promise, calls } = run({ text: "/sales vendí 2 tazas estampadas", client: fakeClient(), ai, state });
    await promise;
    expect(calls.reply.mock.calls[0][0]).toContain("¿A cuánto está *Taza estampada*?");
  });

  it("creates a quote and shares it with a link button", async () => {
    const state = memoryState();
    const client = fakeClient();
    const ai = scriptedAi({ intent: "quote", items: [{ description: "Volantes A5", quantity: 100, unitPrice: 1.5 }],
      customer: { name: "Comercial Lima", docNumber: "20123456789" } });
    await run({ text: "/sales cotiza 100 volantes", client, ai, state }).promise;
    const { promise, calls } = run({ interactionId: "sales:confirm", client, state });
    await promise;
    expect(client.createQuote).toHaveBeenCalledWith("org_jd", expect.objectContaining({
      customer: { docType: "6", docNumber: "20123456789", name: "Comercial Lima" },
      lines: [{ description: "Volantes A5", quantity: 100, unitPriceCents: 150 }],
    }));
    expect(calls.sendCtaUrl).toHaveBeenCalledWith(expect.stringContaining("Cotización N.° 7"), "Ver cotización",
      "https://app.meowlab.tech/cotizacion/AbCdEfGhIjKlMnOpQrStUv");
  });

  it("answers questions with the period summary", async () => {
    const state = memoryState();
    const client = fakeClient();
    const ai = scriptedAi({ intent: "query", period: "week" });
    const { promise, calls } = run({ text: "/sales ¿cuánto vendí esta semana?", client, ai, state });
    await promise;
    expect(client.summary).toHaveBeenCalledWith("org_jd", "week");
    expect(calls.reply.mock.calls[0][0]).toContain("*Ventas hoy:* 3 por S/ 225.00 (S/ 50.00 al crédito).");
  });

  it("asks before cancelling a sale and records it", async () => {
    const state = memoryState();
    const client = fakeClient();
    await run({ text: "/sales anula la venta 12", client, ai: scriptedAi({ intent: "cancel_sale", saleNumber: 12 }), state }).promise;
    expect(client.cancelSale).not.toHaveBeenCalled();
    await run({ interactionId: "sales:cancelsale:12", client, state }).promise;
    expect(client.cancelSale).toHaveBeenCalledWith("org_jd", 12, null);
  });

  it("closes with /salir", async () => {
    const state = memoryState();
    await run({ text: "/sales", client: fakeClient(), state }).promise;
    const { promise, calls } = run({ text: "/salir", client: fakeClient(), state });
    await promise;
    expect(state.store.size).toBe(0);
    expect(calls.reply.mock.calls[0][0]).toContain("saliste de Sales Cat");
  });

  it("issues a boleta through Invoice Cat for the same company and links it to the sale", async () => {
    const state = memoryState();
    const client = fakeClient();
    const facturaya = {
      resolveTenantAccess: vi.fn(async () => ({ status: "authorized", tenant: { id: "org_jd" }, tenants: [{ id: "org_jd" }] })),
      selectTenant: vi.fn(),
      importInvoiceDraft: vi.fn(async () => ({ ok: true, data: { id: "draft-1", status: "review_required", totals: { total: 75, igv: 11.44 } } })),
      issueInvoice: vi.fn(async () => ({ ok: true, data: { id: "inv", number: "B001-00000009", status: "accepted", files: { pdf: "https://f/x.pdf" } } })),
      downloadFile: vi.fn(async () => ({ ok: true, data: { bytes: new Uint8Array([37, 80]), mimeType: "application/pdf", filename: "B001-9.pdf" } })),
    } as unknown as FacturayaClient;
    const ai = scriptedAi({ intent: "sale", items: [{ description: "Polo blanco", quantity: 3, unitPrice: 25 }], paymentMethod: "efectivo" });
    await run({ text: "/sales vendí 3 polos en efectivo", client, ai, state }).promise;
    await run({ interactionId: "sales:confirm", client, state }).promise;
    const boleta = run({ interactionId: "sales:invoice:03", client, state, facturaya });
    await boleta.promise;
    expect(facturaya.importInvoiceDraft).toHaveBeenCalledWith(expect.objectContaining({
      documentType: "03", customerDocumentType: "0", customerRuc: null, taxMode: "included",
      productsText: "3 Polo blanco, precio unitario PEN 25.00",
    }));
    const issue = run({ interactionId: "sales:issue:draft-1", client, state, facturaya });
    await issue.promise;
    expect(client.linkInvoice).toHaveBeenCalledWith("org_jd", 12, "B001-00000009");
    expect(issue.calls.sendDocument).toHaveBeenCalled();
  });

  it("does not issue a factura without the customer's RUC", async () => {
    const state = memoryState();
    const client = fakeClient();
    const facturaya = {
      resolveTenantAccess: vi.fn(async () => ({ status: "authorized", tenant: { id: "org_jd" }, tenants: [{ id: "org_jd" }] })),
      importInvoiceDraft: vi.fn(),
    } as unknown as FacturayaClient;
    const ai = scriptedAi({ intent: "sale", items: [{ description: "Polo blanco", quantity: 1, unitPrice: 25 }], paymentMethod: "efectivo" });
    await run({ text: "/sales vendí un polo", client, ai, state }).promise;
    await run({ interactionId: "sales:confirm", client, state }).promise;
    const { promise, calls } = run({ interactionId: "sales:invoice:01", client, state, facturaya });
    await promise;
    expect(facturaya.importInvoiceDraft).not.toHaveBeenCalled();
    expect(calls.reply.mock.calls[0][0]).toContain("RUC");
  });

  it("formats an empty period plainly", () => {
    expect(formatSummary({ period: "yesterday", from: "", to: "", salesCount: 0, totalCents: 0, creditCents: 0, quotesCount: 0,
      quotedCents: 0, topProducts: [], topCustomers: [] })).toBe("No hay ventas ni cotizaciones registradas ayer.");
  });
});
