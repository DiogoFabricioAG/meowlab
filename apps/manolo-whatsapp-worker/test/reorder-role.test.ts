import { describe, expect, it, vi } from "vitest";
import type { RoleHandlerContext, TenantContext } from "../src/roles/contracts";
import type { RoleStateRepository } from "../src/roles/state";
import {
  REORDER_ROLE_KEY,
  ReorderRoleHandler,
  isReorderCommand,
  offerReorder,
  parseReorderState,
  type ReorderOutbound,
} from "../src/roles/reorder-role";
import type { ReorderClient, ReorderOverview, SupplierMatch } from "../src/reorder/client";
import { isReorderBridgeRequest, type OrderSummary } from "../src/reorder/bridge-contracts";
import { normalizePhone } from "../src/reorder/extractor";
import { orderText, supplierTemplateParameters } from "../src/reorder/messages";
import { handleSupplierMessage, runReorderFollowups } from "../src/reorder/supplier";
import { templatePayload } from "../src/adapters/whatsapp/meta-client";
import type { AiProvider } from "../src/ai/contracts";
import type { WhatsAppClient } from "../src/whatsapp/contracts";

const tenant: TenantContext = {
  tenantId: "manolo", phoneNumberId: "pn", roleKey: REORDER_ROLE_KEY, systemPrompt: "", aiProvider: "groq",
  aiModel: "openai/gpt-oss-120b", temperature: 0, maxTokens: 900,
};
const ORDER_ID = "3f1c2a4e-1111-4a2b-9c3d-000000000002";
const ORDER: OrderSummary = {
  id: ORDER_ID, number: 2, kind: "purchase", status: "proposed",
  supplier: { name: "Textiles Lima", phone: "51987654321", ruc: null },
  lines: [{ item: "Polo blanco M", quantity: 45, receivedQty: 0, unitPriceCents: 1200 }, { item: "Polo negro L", quantity: 16, receivedQty: 0, unitPriceCents: null }],
  estimatedCents: 54000, confirmedCents: null, deliverBy: null, sentAt: null, approved: false, escalated: false, supplierNote: null,
};
const OVERVIEW: ReorderOverview = {
  owner: true, companyName: "CREACIONES J&D", created: [ORDER], settings: { monthlyBudgetCents: null, followupHours: 24, escalateHours: 48 },
  proposals: [ORDER], open: [], notices: [{ id: "3f1c2a4e-1111-4a2b-9c3d-000000000009", kind: "supplier_reply", body: "Cerámicas Perú confirmó el pedido OC-000001.", createdAt: "2026-11-15T15:00:00Z" }],
  needsMax: ["Taza blanca"], needsSupplier: [], monthSpentCents: 0,
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

const PDF = new TextEncoder().encode(`%PDF-1.4 ${"x".repeat(120)}`);

function fakeClient(overrides: Partial<ReorderClient> = {}): ReorderClient & Record<string, ReturnType<typeof vi.fn>> {
  return {
    companies: vi.fn(async () => ({ ok: true as const, data: [{ id: "org_jd", name: "CREACIONES J&D" }] })),
    overview: vi.fn(async () => ({ ok: true as const, data: OVERVIEW })),
    setRule: vi.fn(async () => ({ ok: true as const, data: { rule: { item: "Taza blanca", onHand: 2, minQty: 10, supplyType: "purchase" as const, maxQty: 40, supplier: null, supplierPhone: null } } })),
    setSupplier: vi.fn(async () => ({ ok: true as const, data: { supplier: { name: "Textiles Lima", phone: "51987654321", ruc: null }, linked: ["Polo blanco M"], notFound: [] } })),
    approve: vi.fn(async () => ({ ok: true as const, data: { order: { ...ORDER, approved: true }, companyName: "CREACIONES J&D" } })),
    markSent: vi.fn(async () => ({ ok: true as const, data: { order: { ...ORDER, status: "sent" as const } } })),
    discard: vi.fn(async () => ({ ok: true as const, data: { order: { ...ORDER, status: "cancelled" as const } } })),
    changeLine: vi.fn(async () => ({ ok: true as const, data: { order: ORDER } })),
    settings: vi.fn(async () => ({ ok: true as const, data: { settings: { monthlyBudgetCents: 300000, followupHours: 24, escalateHours: 48 } } })),
    query: vi.fn(async () => ({ ok: true as const, data: { month: [{ supplier: "Textiles Lima", orders: 1, totalCents: 66000 }], totalCents: 66000, budgetCents: 300000 } })),
    orderPdf: vi.fn(async () => ({ ok: true as const, data: { filename: "Orden-de-compra-000002.pdf", bytes: PDF } })),
    noticesDelivered: vi.fn(async () => ({ ok: true as const, data: { delivered: 1 } })),
    supplierMatch: vi.fn(async () => ({ ok: true as const, data: [] })),
    supplierReply: vi.fn(),
    followups: vi.fn(),
    ...overrides,
  } as ReorderClient & Record<string, ReturnType<typeof vi.fn>>;
}

function scriptedAi(...answers: Array<Record<string, unknown>>): AiProvider {
  const base = { intent: "other", item: "", quantity: -1, supplier: { name: "", phone: "", ruc: "" }, items: [], budget: -1, queryType: "none", produced: [], reply: "" };
  return { complete: vi.fn(async () => JSON.stringify({ ...base, ...(answers.shift() ?? {}) })) } as unknown as AiProvider;
}

function run(options: { text?: string; interactionId?: string | null; client: ReorderClient; ai?: AiProvider | null; state: RoleStateRepository;
  outbound?: ReorderOutbound | null }) {
  const calls = {
    reply: vi.fn(async (_text: string) => undefined),
    sendButtons: vi.fn(async (_body: string, _buttons: Array<{ id: string; title: string }>) => ({ status: "sent" as const, metaMessageId: "b" })),
    sendList: vi.fn(async () => ({ status: "sent" as const, metaMessageId: "l" })),
    sendDocument: vi.fn(async (_document: { filename: string; caption: string }) => ({ status: "sent" as const, metaMessageId: "d" })),
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
  const outbound = options.outbound === undefined
    ? { phoneNumberId: "pn", sendTemplate: vi.fn(async () => ({ status: "sent" as const, metaMessageId: "t" })) }
    : options.outbound;
  return { promise: new ReorderRoleHandler(() => options.client, () => outbound).handle(context), calls, outbound };
}

describe("Reorder Cat contracts", () => {
  it("opens with /reorder, /reposicion or /pedidos", () => {
    expect(isReorderCommand("/reorder")).toBe(true);
    expect(isReorderCommand("/Reposición")).toBe(true);
    expect(isReorderCommand("/pedidos hoy")).toBe(true);
    expect(isReorderCommand("/collections")).toBe(false);
    expect(parseReorderState(JSON.stringify({ v: 1, expiresAt: 10 }), 20)).toBeNull();
  });

  it("lets only the platform speak without a contact", () => {
    const base = { channel_tenant_id: "manolo", company_id: "org_jd" };
    expect(isReorderBridgeRequest({ ...base, contact_id: 1, operation: "overview" })).toBe(true);
    expect(isReorderBridgeRequest({ ...base, operation: "overview" })).toBe(false);
    expect(isReorderBridgeRequest({ channel_tenant_id: "manolo", operation: "followups" })).toBe(true);
    expect(isReorderBridgeRequest({ channel_tenant_id: "manolo", operation: "supplier_match", payload: { phone: "51987654321" } })).toBe(true);
    expect(isReorderBridgeRequest({ ...base, operation: "supplier_reply", payload: { orderId: ORDER_ID, phone: "51987654321", reply: { outcome: "maybe" } } })).toBe(false);
    expect(isReorderBridgeRequest({ ...base, contact_id: 1, operation: "settings", payload: { change: { followupHours: 0 } } })).toBe(false);
  });

  it("writes Peruvian mobiles with the country code", () => {
    expect(normalizePhone("987 654 321")).toBe("51987654321");
    expect(normalizePhone("+51 987654321")).toBe("51987654321");
    expect(normalizePhone("123")).toBeNull();
  });

  it("fills the supplier template in one line per parameter", () => {
    expect(supplierTemplateParameters(ORDER, "CREACIONES J&D")).toEqual(["Textiles Lima", "CREACIONES J&D", "45 Polo blanco M, 16 Polo negro L", "OC-000002"]);
    const payload = templatePayload("51987654321", "pedido_reposicion_proveedor", "es_PE", ["Línea 1\nLínea 2", "  mucho     espacio "]);
    expect(payload.template.components?.[0].parameters.map((p) => p.text)).toEqual(["Línea 1 Línea 2", "mucho espacio"]);
    expect(orderText(ORDER)).toContain("Pedido a Textiles Lima · OC-000002");
  });
});

describe("Reorder Cat in the chat", () => {
  it("opens with the news, what is missing and the proposals with buttons", async () => {
    const client = fakeClient();
    const { promise, calls } = run({ text: "/reorder", client, state: memoryState() });
    await promise;
    const text = calls.reply.mock.calls[0][0];
    expect(text).toContain("Cerámicas Perú confirmó el pedido OC-000001.");
    expect(text).toContain("no sé hasta cuánto pedir: Taza blanca");
    expect(client.noticesDelivered).toHaveBeenCalledWith("org_jd", ["3f1c2a4e-1111-4a2b-9c3d-000000000009"]);
    expect(calls.sendButtons.mock.calls[0][1].map((b) => b.id)).toEqual([`reorder:approve:${ORDER_ID}`, `reorder:change:${ORDER_ID}`, `reorder:discard:${ORDER_ID}`]);
  });

  it("approving sends the template to the supplier and the PDF to the owner", async () => {
    const client = fakeClient();
    const { promise, calls, outbound } = run({ interactionId: `reorder:approve:${ORDER_ID}`, client, state: memoryState() });
    await promise;
    expect(outbound!.sendTemplate).toHaveBeenCalledWith("51987654321", "pedido_reposicion_proveedor", "es_PE",
      ["Textiles Lima", "CREACIONES J&D", "45 Polo blanco M, 16 Polo negro L", "OC-000002"]);
    expect(client.markSent).toHaveBeenCalledWith("org_jd", ORDER_ID, true, "pn");
    expect(calls.sendDocument.mock.calls[0][0].caption).toContain("le pedí a Textiles Lima");
  });

  it("when the template cannot be sent, it says so and offers to retry", async () => {
    const client = fakeClient();
    const outbound = { phoneNumberId: "pn", sendTemplate: vi.fn(async () => ({ status: "failed" as const, metaMessageId: null })) };
    const { promise, calls } = run({ interactionId: `reorder:approve:${ORDER_ID}`, client, state: memoryState(), outbound });
    await promise;
    expect(client.markSent).toHaveBeenCalledWith("org_jd", ORDER_ID, false, "pn");
    expect(calls.sendButtons.mock.calls[0][1]).toEqual([{ id: `reorder:approve:${ORDER_ID}`, title: "Reintentar" }]);
    expect(client.orderPdf).not.toHaveBeenCalled();
  });

  it("over the budget, it asks before approving", async () => {
    const client = fakeClient({ approve: vi.fn(async () => ({ ok: false as const, code: "over_budget", details: { spentCents: 250000, budgetCents: 300000, orderCents: 66000 } })) });
    const { promise, calls, outbound } = run({ interactionId: `reorder:approve:${ORDER_ID}`, client, state: memoryState() });
    await promise;
    expect(calls.sendButtons.mock.calls[0][0]).toContain("llevas S/ 2,500.00 de S/ 3,000.00");
    expect(calls.sendButtons.mock.calls[0][1][0]).toEqual({ id: `reorder:force:${ORDER_ID}`, title: "Aprobar igual" });
    expect(outbound!.sendTemplate).not.toHaveBeenCalled();
  });

  it("understands the maximum and the supplier with their WhatsApp", async () => {
    const client = fakeClient({ overview: vi.fn(async () => ({ ok: true as const, data: { ...OVERVIEW, created: [] } })) });
    const state = memoryState();
    let { promise, calls } = run({ text: "el máximo de tazas blancas es 40", client, state, ai: scriptedAi({ intent: "set_max", item: "Taza blanca", quantity: 40 }) });
    await promise;
    expect(client.setRule).toHaveBeenCalledWith("org_jd", "Taza blanca", { maxQty: 40 });
    expect(calls.reply.mock.calls[0][0]).toContain("pediré hasta tener 40");
    ({ promise, calls } = run({ text: "los polos me los vende Textiles Lima, 987654321", client, state,
      ai: scriptedAi({ intent: "set_supplier", supplier: { name: "Textiles Lima", phone: "987654321", ruc: "" }, items: ["Polo blanco M"] }) }));
    await promise;
    expect(client.setSupplier).toHaveBeenCalledWith("org_jd", { name: "Textiles Lima", phone: "51987654321", items: ["Polo blanco M"] });
  });

  it("offers to reorder after Stock Cat's alert only where it is on", async () => {
    const sendButtons = vi.fn(async () => ({ status: "sent" as const, metaMessageId: "b" }));
    const context = { sendButtons } as unknown as RoleHandlerContext;
    await offerReorder(context, fakeClient(), "org_jd");
    expect(sendButtons).toHaveBeenCalledWith("¿Pido la reposición de lo que se acaba?", [{ id: "reorder:open:org_jd", title: "Pedir reposición" }]);
    sendButtons.mockClear();
    await offerReorder(context, fakeClient(), "org_other");
    expect(sendButtons).not.toHaveBeenCalled();
  });
});

describe("Reorder Cat with suppliers", () => {
  const match: SupplierMatch = { companyId: "org_jd", companyName: "CREACIONES J&D", supplierName: "Textiles Lima",
    order: { ...ORDER, status: "sent" }, pdfSent: false, replied: false };
  function whatsapp() {
    return {
      sendText: vi.fn(async () => ({ status: "sent" as const, metaMessageId: "x" })),
      sendDocument: vi.fn(async () => ({ status: "sent" as const, metaMessageId: "d" })),
      sendTemplate: vi.fn(async () => ({ status: "sent" as const, metaMessageId: "t" })),
    } as unknown as WhatsAppClient & Record<string, ReturnType<typeof vi.fn>>;
  }

  it("reads the supplier's answer, thanks them with the PDF and tells the owner", async () => {
    const client = fakeClient({ supplierReply: vi.fn(async () => ({ ok: true as const, data: {
      order: { ...ORDER, status: "confirmed" as const }, companyName: "CREACIONES J&D", notice: { id: "n1", body: "Textiles Lima confirmó el pedido OC-000002." },
      ownerPhones: ["51911111111"], sendPdf: true, phoneNumberId: "pn" } })) });
    const wa = whatsapp();
    const replyToSupplier = vi.fn(async () => undefined);
    const ai = { complete: vi.fn(async () => JSON.stringify({ outcome: "accepted", deliverBy: "2026-11-18", total: 660, unitPrices: [], note: "" })) } as unknown as AiProvider;
    await handleSupplierMessage({ matches: [match], text: "Ok, se lo mando el miércoles, son 660", supplierPhone: "51987654321", phoneNumberId: "pn",
      client, whatsapp: wa, replyToSupplier, ai, tenant, log: vi.fn(), now: new Date("2026-11-15T15:00:00Z") });
    expect(client.supplierReply).toHaveBeenCalledWith("org_jd", ORDER_ID, "51987654321",
      { outcome: "accepted", deliverBy: "2026-11-18", totalCents: 66000, unitPrices: [], note: null });
    expect(replyToSupplier).toHaveBeenCalledWith("¡Gracias! Le confirmo a CREACIONES J&D su respuesta. Le adjunto la orden de compra.");
    expect(wa.sendDocument).toHaveBeenCalledTimes(1);
    expect(wa.sendText).toHaveBeenCalledWith("51911111111", "🛒 *Reorder Cat · CREACIONES J&D*\nTextiles Lima confirmó el pedido OC-000002.", "pn");
    expect(client.noticesDelivered).toHaveBeenCalledWith("org_jd", ["n1"]);
  });

  it("keeps the notice when the owner's window is closed", async () => {
    const client = fakeClient({ supplierReply: vi.fn(async () => ({ ok: true as const, data: {
      order: ORDER, companyName: "CREACIONES J&D", notice: { id: "n2", body: "Textiles Lima no puede atender el pedido OC-000002." },
      ownerPhones: ["51911111111"], sendPdf: true, phoneNumberId: "pn" } })) });
    const wa = whatsapp();
    (wa.sendText as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "failed", metaMessageId: null });
    const ai = { complete: vi.fn(async () => JSON.stringify({ outcome: "declined", deliverBy: "", total: -1, unitPrices: [], note: "Sin stock" })) } as unknown as AiProvider;
    await handleSupplierMessage({ matches: [match], text: "No tengo stock", supplierPhone: "51987654321", phoneNumberId: "pn",
      client, whatsapp: wa, replyToSupplier: vi.fn(async () => undefined), ai, tenant, log: vi.fn() });
    expect(wa.sendDocument).not.toHaveBeenCalled();
    expect(client.noticesDelivered).not.toHaveBeenCalled();
  });

  it("the cron reminds with the template and escalates to the owner", async () => {
    const client = fakeClient({ followups: vi.fn(async () => ({ ok: true as const, data: {
      reminders: [{ companyId: "org_jd", companyName: "CREACIONES J&D", order: { ...ORDER, status: "sent" as const }, phoneNumberId: "pn" }],
      escalations: [{ companyId: "org_jd", companyName: "CREACIONES J&D", orderId: ORDER_ID, notice: { id: "n3", body: "Textiles Lima no respondió." },
        ownerPhones: ["51911111111"], phoneNumberId: "pn" }],
    } })) });
    const wa = whatsapp();
    await runReorderFollowups(client, wa, null, vi.fn());
    expect(wa.sendTemplate).toHaveBeenCalledWith("51987654321", "pedido_reposicion_proveedor", "es_PE",
      ["Textiles Lima", "CREACIONES J&D", "45 Polo blanco M, 16 Polo negro L", "OC-000002"], "pn");
    expect(wa.sendText).toHaveBeenCalledWith("51911111111", "🛒 *Reorder Cat · CREACIONES J&D*\nTextiles Lima no respondió.", "pn");
    expect(client.noticesDelivered).toHaveBeenCalledWith("org_jd", ["n3"]);
  });
});
