import { describe, expect, it, vi } from "vitest";
import type { RoleHandlerContext, TenantContext } from "../src/roles/contracts";
import type { RoleStateRepository } from "../src/roles/state";
import {
  STOCK_ROLE_KEY,
  StockRoleHandler,
  formatAlerts,
  formatAnswer,
  isStockCommand,
  parseStockState,
  stockAlertsAfterInvoice,
} from "../src/roles/stock-role";
import type { StockClient } from "../src/stock/client";
import { isStockBridgeRequest } from "../src/stock/bridge-contracts";
import type { AiProvider } from "../src/ai/contracts";

const tenant: TenantContext = {
  tenantId: "manolo", phoneNumberId: "pn", roleKey: STOCK_ROLE_KEY, systemPrompt: "", aiProvider: "groq",
  aiModel: "openai/gpt-oss-120b", temperature: 0, maxTokens: 900,
};

function memoryState(): RoleStateRepository {
  const store = new Map<string, string>();
  const key = (t: string, c: number, r: string) => `${t}:${c}:${r}`;
  return {
    async get(t, c, r) { return store.get(key(t, c, r)) ?? null; },
    async set(t, c, r, json) { store.set(key(t, c, r), json); return true; },
    async clear(t, c, r) { return store.delete(key(t, c, r)); },
  };
}

const ALERT = { name: "Polo blanco M", onHand: 4, minQty: 5, needsCount: false };

function fakeClient(overrides: Partial<StockClient> = {}): StockClient & Record<string, ReturnType<typeof vi.fn>> {
  return {
    companies: vi.fn(async () => ({ ok: true as const, data: [{ id: "org_jd", name: "CREACIONES J&D" }] })),
    items: vi.fn(async () => ({ ok: true as const, data: { items: [{ name: "Polo blanco M", kind: "product" as const, onHand: 20, minQty: 5, low: false, needsCount: false }],
      owner: true, settings: { allowNegative: true } } })),
    move: vi.fn(async () => ({ ok: true as const, data: { moved: [{ name: "Polo blanco M", onHand: 4, delta: -16 }], alerts: [ALERT] } })),
    setMin: vi.fn(async () => ({ ok: true as const, data: { item: { name: "Polo blanco M", onHand: 20, minQty: 5 }, alerts: [] } })),
    settings: vi.fn(async (_c: string, allowNegative: boolean) => ({ ok: true as const, data: { settings: { allowNegative } } })),
    query: vi.fn(async () => ({ ok: true as const, data: { items: [{ name: "Polo blanco M", kind: "product" as const, onHand: 4, minQty: 5, low: true, needsCount: false }] } })),
    syncDocuments: vi.fn(async () => ({ ok: true as const, data: { processed: 0, alerts: [], unmatched: [], available: true } })),
    linkAlias: vi.fn(async () => ({ ok: true as const, data: { item: { name: "Taza personalizada", onHand: 9 }, applied: 1, alerts: [] } })),
    ...overrides,
  } as StockClient & Record<string, ReturnType<typeof vi.fn>>;
}

function scriptedAi(...answers: Array<Record<string, unknown>>): AiProvider {
  const base = { intent: "other", items: [], minQty: -1, queryType: "none", itemName: "", period: "none", allowNegative: "none",
    alias: { description: "", name: "" }, reply: "" };
  return { complete: vi.fn(async () => JSON.stringify({ ...base, ...answers.shift() })) } as unknown as AiProvider;
}

function run(options: { text?: string; interactionId?: string | null; client: StockClient; ai?: AiProvider | null; state: RoleStateRepository }) {
  const calls = {
    reply: vi.fn(async (_text: string) => undefined),
    sendButtons: vi.fn(async (_body: string, _buttons: Array<{ id: string; title: string }>) => ({ status: "sent" as const, metaMessageId: "b" })),
    sendList: vi.fn(async () => ({ status: "sent" as const, metaMessageId: "l" })),
    sendDocument: vi.fn(async () => ({ status: "sent" as const, metaMessageId: "d" })),
  };
  const context = {
    message: { id: "wamid.1", interactionId: options.interactionId ?? null, phoneNumberId: "pn", to: "51911111111", inputType: "text",
      text: options.text ?? options.interactionId ?? "" },
    tenant,
    persisted: { duplicate: false, conversationId: "c", contactId: 1 },
    env: {} as unknown as Env,
    ai: options.ai ?? null,
    roleState: options.state,
    history: [],
    ...calls,
    generateAiReply: async () => null,
    generateAiReplyWithHistory: async () => null,
    fallbackReply: "",
    log: vi.fn(),
  } as unknown as RoleHandlerContext;
  return { promise: new StockRoleHandler(() => options.client).handle(context), calls };
}

describe("Stock Cat commands, contracts and texts", () => {
  it("recognises /stock and expires sessions", () => {
    expect(isStockCommand("/stock")).toBe(true);
    expect(isStockCommand("/STOCK me llegaron 5 polos")).toBe(true);
    expect(isStockCommand("stock")).toBe(false);
    expect(parseStockState(JSON.stringify({ v: 1, expiresAt: 10 }), 20)).toBeNull();
    expect(parseStockState(JSON.stringify({ v: 1, expiresAt: 30 }), 20)).not.toBeNull();
  });

  it("validates bridge requests", () => {
    const base = { channel_tenant_id: "manolo", contact_id: 1, company_id: "org_jd" };
    expect(isStockBridgeRequest({ ...base, operation: "move", payload: { kind: "in", lines: [{ name: "Polo", quantity: 2.5, unitCostCents: 1200 }] } })).toBe(true);
    expect(isStockBridgeRequest({ ...base, operation: "move", payload: { kind: "out", lines: [{ name: "Polo", quantity: 0 }] } })).toBe(false);
    expect(isStockBridgeRequest({ ...base, operation: "move", payload: { kind: "count", lines: [{ name: "Polo", quantity: 0 }] } })).toBe(true);
    expect(isStockBridgeRequest({ ...base, operation: "move", payload: { kind: "steal", lines: [{ name: "Polo", quantity: 1 }] } })).toBe(false);
    expect(isStockBridgeRequest({ ...base, operation: "query", payload: { type: "item" } })).toBe(false);
    expect(isStockBridgeRequest({ ...base, operation: "query", payload: { type: "moves", period: "week" } })).toBe(true);
    expect(isStockBridgeRequest({ channel_tenant_id: "manolo", contact_id: 1, operation: "items" })).toBe(false);
  });

  it("writes alerts and answers in plain Spanish", () => {
    expect(formatAlerts([ALERT])).toBe("⚠️ *Se está acabando:*\n• Polo blanco M: quedan 4 (mínimo 5)");
    expect(formatAnswer({ valueCents: 5200, withoutCost: 1, withStock: 3 }, "value"))
      .toBe("*Tu inventario vale S/ 52.00* al costo promedio (3 productos con stock).\n1 producto no tiene costo registrado y no suman.");
    expect(formatAnswer({ items: [] }, "low")).toBe("Nada se está acabando. 👍");
  });
});

describe("Stock Cat in the chat", () => {
  it("records an entry with cost only after confirming", async () => {
    const state = memoryState();
    const client = fakeClient();
    const ai = scriptedAi({ intent: "in", items: [{ name: "Polo blanco M", quantity: 50, unitCost: 12, kind: "product" }] });
    const first = run({ text: "/stock me llegaron 50 polos blancos M a 12", client, ai, state });
    await first.promise;
    expect(client.move).not.toHaveBeenCalled();
    expect(first.calls.sendButtons).toHaveBeenCalledWith("*Entrada*\n• 50 × Polo blanco M a S/ 12.00 c/u",
      [{ id: "stock:confirm", title: "Guardar" }, { id: "stock:cancel", title: "Cancelar" }]);
    const confirm = run({ interactionId: "stock:confirm", client, state });
    await confirm.promise;
    expect(client.move).toHaveBeenCalledWith("org_jd", "in", [{ name: "Polo blanco M", quantity: 50, unitCostCents: 1200, kind: "product" }], null);
    expect(confirm.calls.reply.mock.calls[0][0]).toContain("⚠️ *Se está acabando:*");
  });

  it("explains why an exit is refused when negatives are not allowed", async () => {
    const state = memoryState();
    const client = fakeClient({ move: vi.fn(async () => ({ ok: false as const, code: "insufficient", details: { name: "Taza", onHand: 2 } })) });
    await run({ text: "/stock salieron 3 tazas", client, ai: scriptedAi({ intent: "out", items: [{ name: "Taza", quantity: 3, unitCost: -1, kind: "none" }] }), state }).promise;
    const { promise, calls } = run({ text: "confirmar", client, state });
    await promise;
    expect(calls.reply.mock.calls[0][0]).toContain("No hay suficiente Taza: quedan 2.");
  });

  it("opens with the documents brought up to date and asks about unknown products", async () => {
    const client = fakeClient({ syncDocuments: vi.fn(async () => ({ ok: true as const, data: { processed: 2, alerts: [ALERT], unmatched: ["TAZA PERSONALIZADA"], available: true } })) });
    const { promise, calls } = run({ text: "/stock", client, state: memoryState() });
    await promise;
    const text = calls.reply.mock.calls[0][0];
    expect(text).toContain("Revisé 2 comprobantes nuevos");
    expect(text).toContain("Polo blanco M: quedan 4 (mínimo 5)");
    expect(text).toContain("TAZA PERSONALIZADA");
    expect(calls.sendButtons).toHaveBeenCalled();
  });

  it("answers questions and sets rules directly", async () => {
    const client = fakeClient();
    const state = memoryState();
    await run({ text: "/stock ¿qué se está acabando?", client, ai: scriptedAi({ intent: "query", queryType: "low" }), state }).promise;
    expect(client.query).toHaveBeenCalledWith("org_jd", "low", {});
    await run({ text: "avísame cuando queden 5 polos", client, ai: scriptedAi({ intent: "set_min", items: [{ name: "Polo blanco M", quantity: 5, unitCost: -1, kind: "none" }], minQty: 5 }), state }).promise;
    expect(client.setMin).toHaveBeenCalledWith("org_jd", "Polo blanco M", 5);
    await run({ text: "no permitas negativos", client, ai: scriptedAi({ intent: "negative", allowNegative: "no" }), state }).promise;
    expect(client.settings).toHaveBeenCalledWith("org_jd", false);
    await run({ text: "TAZA PERSONALIZADA es la taza personalizada", client,
      ai: scriptedAi({ intent: "link", alias: { description: "TAZA PERSONALIZADA", name: "Taza personalizada" } }), state }).promise;
    expect(client.linkAlias).toHaveBeenCalledWith("org_jd", "TAZA PERSONALIZADA", "Taza personalizada");
  });

  it("alerts right after Invoice Cat issues a document, only when something is low", async () => {
    expect(await stockAlertsAfterInvoice(null)).toBeNull();
    expect(await stockAlertsAfterInvoice(fakeClient())).toBeNull();
    const low = fakeClient({ syncDocuments: vi.fn(async () => ({ ok: true as const, data: { processed: 1, alerts: [ALERT], unmatched: [], available: true } })) });
    expect(await stockAlertsAfterInvoice(low)).toContain("Polo blanco M: quedan 4 (mínimo 5)");
    const none = fakeClient({ companies: vi.fn(async () => ({ ok: true as const, data: [] })) });
    expect(await stockAlertsAfterInvoice(none)).toBeNull();
  });
});
