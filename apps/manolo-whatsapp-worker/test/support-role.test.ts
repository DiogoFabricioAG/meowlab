import { describe, expect, it, vi } from "vitest";
import type { RoleHandlerContext, TenantContext } from "../src/roles/contracts";
import type { RoleStateRepository } from "../src/roles/state";
import { SUPPORT_ROLE_KEY, SupportRoleHandler, isSupportCommand, isSupportOwnerInteraction, type SupportOutbound } from "../src/roles/support-role";
import { handleCustomerMessage, ownerTicketText, type CustomerTurn } from "../src/support/customer";
import type { SupportClient } from "../src/support/client";
import { isSupportBridgeRequest, type CustomerContext, type Ticket } from "../src/support/bridge-contracts";
import { isSupportFaqChange } from "../src/bridge/portal-company-contracts";
import type { AiProvider } from "../src/ai/contracts";
import type { WhatsAppClient } from "../src/whatsapp/contracts";

const tenant: TenantContext = {
  tenantId: "manolo", phoneNumberId: "pn", roleKey: SUPPORT_ROLE_KEY, systemPrompt: "", aiProvider: "groq",
  aiModel: "openai/gpt-oss-120b", temperature: 0, maxTokens: 900,
};
const TICKET_ID = "3f1c2a4e-1111-4a2b-9c3d-000000000001";
const TICKET: Ticket = {
  id: TICKET_ID, number: 7, kind: "question", priority: "normal", status: "open", customerName: "Rosa", customerPhone: "51999888777",
  question: "¿Tienen polos XXL?", answer: null, relayed: false, createdAt: "2026-11-15T16:00:00Z",
};
const CONTEXT: Extract<CustomerContext, { mode: "customer" }> = {
  mode: "customer", companyId: "org_jd", companyName: "CREACIONES J&D", customer: { name: null },
  faqs: [{ question: "¿Horario?", answer: "Lunes a sábado de 9 a 7." }],
  catalog: [{ name: "Polo blanco M", unitPriceCents: 2500 }], quotes: [], sales: [], openTickets: [],
};
const PDF = new TextEncoder().encode(`%PDF-1.4 ${"x".repeat(120)}`);

function memoryState(): RoleStateRepository {
  const store = new Map<string, string>();
  const key = (t: string, c: number, r: string) => `${t}:${c}:${r}`;
  return {
    async get(t, c, r) { return store.get(key(t, c, r)) ?? null; },
    async set(t, c, r, json) { store.set(key(t, c, r), json); return true; },
    async clear(t, c, r) { return store.delete(key(t, c, r)); },
  };
}

function fakeClient(overrides: Partial<SupportClient> = {}): SupportClient & Record<string, ReturnType<typeof vi.fn>> {
  return {
    customerContext: vi.fn(async () => ({ ok: true as const, data: CONTEXT })),
    event: vi.fn(async () => ({ ok: true as const, data: { recorded: true } })),
    openTicket: vi.fn(async () => ({ ok: true as const, data: { ticket: TICKET, companyName: "CREACIONES J&D", ownerPhones: ["51911111111"] } })),
    customerQuote: vi.fn(async () => ({ ok: true as const, data: { quote: { number: 3, totalCents: 7500, validUntil: "2026-11-22", lines: [] }, companyName: "CREACIONES J&D" } })),
    quotePdf: vi.fn(async () => ({ ok: true as const, data: { filename: "Cotizacion-000003.pdf", bytes: PDF } })),
    markNotified: vi.fn(async () => ({ ok: true as const, data: { notified: true } })),
    summaries: vi.fn(),
    companies: vi.fn(async () => ({ ok: true as const, data: [{ id: "org_jd", name: "CREACIONES J&D" }] })),
    pending: vi.fn(async () => ({ ok: true as const, data: { owner: true, companyName: "CREACIONES J&D", open: [TICKET] } })),
    answerTicket: vi.fn(async () => ({ ok: true as const, data: { ticket: { ...TICKET, status: "answered" as const }, companyName: "CREACIONES J&D" } })),
    markRelayed: vi.fn(async () => ({ ok: true as const, data: { ticket: TICKET } })),
    closeTicket: vi.fn(async () => ({ ok: true as const, data: { ticket: { ...TICKET, status: "closed" as const } } })),
    ...overrides,
  } as SupportClient & Record<string, ReturnType<typeof vi.fn>>;
}

const ai = (answer: Record<string, unknown>) => ({ complete: vi.fn(async () => JSON.stringify({
  action: "chat", reply: "", items: [], customerName: "", question: "", ...answer })) }) as unknown as AiProvider;

function customerTurn(overrides: Partial<CustomerTurn>) {
  const whatsapp = {
    sendButtons: vi.fn(async () => ({ status: "sent" as const, metaMessageId: "b" })),
    sendText: vi.fn(async () => ({ status: "sent" as const, metaMessageId: "t" })),
  } as unknown as WhatsAppClient & Record<string, ReturnType<typeof vi.fn>>;
  const turn: CustomerTurn = {
    context: CONTEXT, text: "", interactionId: null, messageId: "wamid.1", phone: "51999888777", phoneNumberId: "pn", contactId: 9,
    tenantId: "manolo", history: [], client: fakeClient(), whatsapp, roleState: memoryState(),
    reply: vi.fn(async () => ({ status: "sent" as const, metaMessageId: "r" })),
    sendButtons: vi.fn(async () => ({ status: "sent" as const, metaMessageId: "b" })),
    sendDocument: vi.fn(async () => ({ status: "sent" as const, metaMessageId: "d" })),
    ai: null, tenant, log: vi.fn(), now: new Date("2026-11-15T16:00:00Z"),
    ...overrides,
  };
  return { turn, whatsapp };
}

describe("Support Cat contracts", () => {
  it("separates the owner's commands and buttons from the customer's", () => {
    expect(isSupportCommand("/soporte")).toBe(true);
    expect(isSupportCommand("/support hoy")).toBe(true);
    expect(isSupportOwnerInteraction(`support:answer:org_jd:${TICKET_ID}`)).toBe(true);
    expect(isSupportOwnerInteraction("support:rate:yes")).toBe(false);
  });

  it("lets only the platform speak for customers, and only people answer", () => {
    expect(isSupportBridgeRequest({ channel_tenant_id: "manolo", operation: "customer_context", payload: { phoneNumberId: "1266091906580349", phone: "51999888777" } })).toBe(true);
    expect(isSupportBridgeRequest({ channel_tenant_id: "manolo", contact_id: 1, operation: "customer_context", payload: { phoneNumberId: "1", phone: "5199" } })).toBe(false);
    expect(isSupportBridgeRequest({ channel_tenant_id: "manolo", company_id: "org_jd", operation: "answer_ticket", payload: { ticketId: TICKET_ID, answer: "Sí" } })).toBe(false);
    expect(isSupportBridgeRequest({ channel_tenant_id: "manolo", contact_id: 1, company_id: "org_jd", operation: "answer_ticket", payload: { ticketId: TICKET_ID, answer: "Sí" } })).toBe(true);
  });

  it("validates the portal's FAQ changes", () => {
    expect(isSupportFaqChange({ question: "¿Horario?", answer: "De 9 a 7" })).toBe(true);
    expect(isSupportFaqChange({ id: TICKET_ID, remove: true })).toBe(true);
    expect(isSupportFaqChange({ remove: true })).toBe(false);
    expect(isSupportFaqChange({ question: "", answer: "x" })).toBe(false);
  });
});

describe("Support Cat with customers", () => {
  it("answers from the FAQs and asks «¿te ayudé?» once a day", async () => {
    const { turn } = customerTurn({ text: "¿a qué hora abren?", ai: ai({ action: "answer", reply: "Abrimos de lunes a sábado de 9 a 7." }) });
    await handleCustomerMessage(turn);
    expect(turn.reply).toHaveBeenCalledWith("Abrimos de lunes a sábado de 9 a 7.");
    expect(turn.client.event).toHaveBeenCalledWith("org_jd", "51999888777", "answered", "wamid.1");
    expect(turn.sendButtons).toHaveBeenCalledWith("¿Te ayudé?", [{ id: "support:rate:yes", title: "Sí, gracias" }, { id: "support:rate:no", title: "No" }]);
    const again = customerTurn({ text: "¿y los domingos?", roleState: turn.roleState, ai: ai({ action: "answer", reply: "Los domingos no abrimos." }) });
    await handleCustomerMessage(again.turn);
    expect(again.turn.sendButtons).not.toHaveBeenCalled();
  });

  it("quotes from the catalog and sends the PDF", async () => {
    const { turn } = customerTurn({ text: "quiero 3 polos blancos M", ai: ai({ action: "quote", items: [{ product: "Polo blanco M", quantity: 3 }], customerName: "Rosa" }) });
    await handleCustomerMessage(turn);
    expect(turn.client.customerQuote).toHaveBeenCalledWith("org_jd", { phone: "51999888777", customerName: "Rosa", items: [{ product: "Polo blanco M", quantity: 3 }], sourceRef: "wamid.1" });
    expect((turn.sendDocument as ReturnType<typeof vi.fn>).mock.calls[0][2]).toContain("Tu cotización N.° 3 de CREACIONES J&D: S/ 75.00");
  });

  it("passes what it does not know to the owner with «Responder»", async () => {
    const { turn, whatsapp } = customerTurn({ text: "¿tienen polos XXL?", ai: ai({ action: "ask_team", question: "¿Tienen polos XXL?", reply: "Lo consulto con el equipo." }) });
    await handleCustomerMessage(turn);
    expect(turn.client.openTicket).toHaveBeenCalledWith("org_jd", { phone: "51999888777", kind: "question", question: "¿Tienen polos XXL?", customerName: null, sourceRef: "wamid.1" });
    expect(whatsapp.sendButtons).toHaveBeenCalledWith("51911111111", ownerTicketText("CREACIONES J&D", TICKET), [{ id: `support:answer:org_jd:${TICKET_ID}`, title: "Responder" }], "pn");
    expect(turn.client.markNotified).toHaveBeenCalledWith("org_jd", [TICKET_ID]);
    expect(turn.reply).toHaveBeenCalledWith("Lo consulto con el equipo.");
  });

  it("a «no» goes to the owner as an unhappy customer", async () => {
    const { turn } = customerTurn({ interactionId: "support:rate:no" });
    await handleCustomerMessage(turn);
    expect(turn.client.event).toHaveBeenCalledWith("org_jd", "51999888777", "rated_no", "wamid.1");
    expect((turn.client.openTicket as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].kind).toBe("unhappy");
  });

  it("products outside the catalog go to the owner as a sale", async () => {
    const client = fakeClient({ customerQuote: vi.fn(async () => ({ ok: false as const, code: "unknown_products", details: { products: ["Gorra"] } })) });
    const { turn } = customerTurn({ client, text: "quiero 2 gorras", ai: ai({ action: "quote", items: [{ product: "Gorra", quantity: 2 }] }) });
    await handleCustomerMessage(turn);
    expect((client.openTicket as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatchObject({ kind: "sale", question: "Quiere comprar: 2 Gorra (no están en el catálogo: Gorra)" });
  });
});

describe("Support Cat with the owner", () => {
  function run(options: { text?: string; interactionId?: string | null; client: SupportClient; state: RoleStateRepository; sendText?: ReturnType<typeof vi.fn> }) {
    const calls = {
      reply: vi.fn(async (_text: string) => undefined),
      sendButtons: vi.fn(async (_body: string, _buttons: Array<{ id: string; title: string }>) => ({ status: "sent" as const, metaMessageId: "b" })),
      sendList: vi.fn(async () => ({ status: "sent" as const, metaMessageId: "l" })),
      sendDocument: vi.fn(async () => ({ status: "sent" as const, metaMessageId: "d" })),
    };
    const sendText = options.sendText ?? vi.fn(async () => ({ status: "sent" as const, metaMessageId: "x" }));
    const context = {
      message: { id: "wamid.o", interactionId: options.interactionId ?? null, phoneNumberId: "pn", to: "51911111111", inputType: "text",
        text: options.text ?? options.interactionId ?? "" },
      tenant, persisted: { duplicate: false, conversationId: "c", contactId: 1 }, env: {} as unknown as Env, ai: null,
      roleState: options.state, history: [], ...calls,
      generateAiReply: async () => null, generateAiReplyWithHistory: async () => null, fallbackReply: "", log: vi.fn(),
    } as unknown as RoleHandlerContext;
    return { promise: new SupportRoleHandler(() => options.client, () => ({ sendText: sendText as unknown as SupportOutbound["sendText"] })).handle(context), calls, sendText };
  }

  it("shows the pending cases with «Responder» and «Cerrar»", async () => {
    const { promise, calls } = run({ text: "/support", client: fakeClient(), state: memoryState() });
    await promise;
    expect(calls.reply.mock.calls[0][0]).toContain("Hay 1 caso pendiente");
    expect(calls.sendButtons.mock.calls[0][1].map((button) => button.id)).toEqual([`support:answer:org_jd:${TICKET_ID}`, `support:close:org_jd:${TICKET_ID}`]);
  });

  it("passes the owner's answer to the customer as written", async () => {
    const client = fakeClient();
    const state = memoryState();
    await run({ interactionId: `support:answer:org_jd:${TICKET_ID}`, client, state }).promise;
    const { promise, calls, sendText } = run({ text: "Sí, tenemos hasta XXL", client, state });
    await promise;
    expect(client.answerTicket).toHaveBeenCalledWith("org_jd", TICKET_ID, "Sí, tenemos hasta XXL");
    expect(sendText).toHaveBeenCalledWith("51999888777", "De parte del equipo de CREACIONES J&D: Sí, tenemos hasta XXL");
    expect(client.markRelayed).toHaveBeenCalledWith("org_jd", TICKET_ID, true);
    expect(calls.reply.mock.calls[0][0]).toContain("le pasé tu respuesta a Rosa");
  });

  it("when the customer's window is closed, it says so and gives the link", async () => {
    const client = fakeClient();
    const state = memoryState();
    await run({ interactionId: `support:answer:org_jd:${TICKET_ID}`, client, state }).promise;
    const sendText = vi.fn(async () => ({ status: "failed" as const, metaMessageId: null }));
    const { promise, calls } = run({ text: "Sí, hasta XXL", client, state, sendText });
    await promise;
    expect(client.markRelayed).toHaveBeenCalledWith("org_jd", TICKET_ID, false);
    expect(calls.reply.mock.calls[0][0]).toContain("wa.me/51999888777");
  });
});
