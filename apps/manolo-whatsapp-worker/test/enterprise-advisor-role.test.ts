import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiProvider } from "../src/ai/contracts";
import type { IncomingDocument, DocumentStore } from "../src/documents/contracts";
import type {
  FacturayaClient,
  FacturayaInvoiceDraft,
} from "../src/facturaya/contracts";
import { EnterpriseAdvisorRoleHandler } from "../src/roles/enterprise-advisor-role";
import type { RoleHandlerContext } from "../src/roles/contracts";
import type { RoleStateRepository } from "../src/roles/state";
import { RoleStateStorageError } from "../src/roles/state";

class MemoryState implements RoleStateRepository {
  private readonly values = new Map<string, string>();

  private key(tenantId: string, contactId: number, roleKey: string): string {
    return `${tenantId}:${contactId}:${roleKey}`;
  }

  async get(tenantId: string, contactId: number, roleKey: string): Promise<string | null> {
    return this.values.get(this.key(tenantId, contactId, roleKey)) ?? null;
  }

  async set(tenantId: string, contactId: number, roleKey: string, value: string): Promise<boolean> {
    this.values.set(this.key(tenantId, contactId, roleKey), value);
    return true;
  }

  async clear(tenantId: string, contactId: number, roleKey: string): Promise<boolean> {
    return this.values.delete(this.key(tenantId, contactId, roleKey));
  }

  async compareAndSet(tenantId: string, contactId: number, roleKey: string, expected: string | null, value: string | null): Promise<boolean> {
    const key = this.key(tenantId, contactId, roleKey);
    if ((this.values.get(key) ?? null) !== expected) return false;
    if (value === null) this.values.delete(key);
    else this.values.set(key, value);
    return true;
  }
}

class MemoryDocuments implements DocumentStore {
  readonly values = new Map<string, IncomingDocument>();

  async put(key: string, document: IncomingDocument): Promise<boolean> {
    this.values.set(key, document);
    return true;
  }

  async get(key: string): Promise<IncomingDocument | null> {
    return this.values.get(key) ?? null;
  }

  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }
}

class FakeFacturaya implements FacturayaClient {
  readonly resolveTenantAccess = vi.fn<FacturayaClient["resolveTenantAccess"]>()
    .mockResolvedValue({
      status: "authorized",
      tenant: {
        id: "company-demo",
        name: "Empresa Demo",
        legalName: "Empresa Demo S.A.C.",
        ruc: "20123456789",
        address: null,
        environment: "beta",
        permissions: ["view_invoice", "create_invoice", "issue_invoice", "create_credit_note"],
      },
      tenants: [],
    });
  readonly selectTenant = vi.fn<FacturayaClient["selectTenant"]>();
  readonly clearTenant = vi.fn<FacturayaClient["clearTenant"]>()
    .mockResolvedValue(true);
  readonly lookupCustomer = vi.fn<FacturayaClient["lookupCustomer"]>()
    .mockResolvedValue({ ok: false, reason: "not_found" });
  readonly lookupCustomerByDni = vi.fn<FacturayaClient["lookupCustomerByDni"]>()
    .mockResolvedValue({ ok: false, reason: "not_found" });
  readonly importInvoiceDraft = vi.fn<FacturayaClient["importInvoiceDraft"]>();
  readonly listInvoiceDrafts = vi.fn<FacturayaClient["listInvoiceDrafts"]>();
  readonly issueInvoice = vi.fn<FacturayaClient["issueInvoice"]>();
  readonly createCreditNote = vi.fn<FacturayaClient["createCreditNote"]>();
  readonly downloadFile = vi.fn<FacturayaClient["downloadFile"]>();
}

const draft: FacturayaInvoiceDraft = {
  id: "01K37H3CAX3JJRKRV6HK7Z6R4P",
  status: "review_required",
  customer: { ruc: "20123456789", name: "Cliente Demo" },
  issue_date: "2026-08-20",
  tax_mode: "included",
  currency: "PEN",
  items: [{ description: "Servicio de impresión", quantity: 1, line_total: 118 }],
  totals: { subtotal: 100, igv: 18, total: 118 },
};

const receiptDraft: FacturayaInvoiceDraft = {
  ...draft,
  document_type: "03",
  customer: { document_type: "1", ruc: "12345678", name: "CLIENTE" },
  items: [{ description: "Moto", quantity: 2, line_total: 15_600 }],
  totals: { subtotal: 13_220.34, igv: 2_379.66, total: 15_600 },
};

const anonymousReceiptDraft: FacturayaInvoiceDraft = {
  ...receiptDraft,
  customer: { document_type: "0", ruc: null, name: null },
  items: [{ description: "Accesorio", quantity: 1, line_total: 50 }],
  totals: { subtotal: 42.37, igv: 7.63, total: 50 },
};

function makeContext(
  state: MemoryState,
  documents: MemoryDocuments,
  facturaya: FakeFacturaya,
  ai: AiProvider,
  message: Partial<RoleHandlerContext["message"]>,
  document: IncomingDocument | null = null,
): RoleHandlerContext {
  const reply = vi.fn(async (_text: string) => undefined);
  return {
    message: {
      id: "wamid.enterprise-test",
      interactionId: null,
      phoneNumberId: "phone-test",
      to: "573001234567",
      inputType: "text",
      text: "hola",
      ...message,
    },
    tenant: {
      tenantId: "enterprise-test",
      phoneNumberId: "phone-test",
      roleKey: "enterprise-advisor",
      systemPrompt: "enterprise",
      aiProvider: "openai",
      aiModel: "gpt-5.6-luna",
      temperature: 0.2,
      maxTokens: 1_800,
      aiReasoningEffort: "high",
    },
    persisted: { duplicate: false, conversationId: "conversation", contactId: 1 },
    env: {} as Env,
    ai,
    businessData: null,
    quoteNumberAllocator: null,
    roleState: state,
    facturaya,
    document,
    documentStore: documents,
    history: [],
    reply,
    sendText: async (text) => {
      await reply(text);
      return { status: "sent", metaMessageId: "wamid.text" };
    },
    sendButtons: vi.fn(async () => ({ status: "sent" as const, metaMessageId: "wamid.reply" })),
    sendList: vi.fn(async () => ({ status: "sent" as const, metaMessageId: "wamid.reply" })),
    sendDocument: vi.fn(async () => ({ status: "sent" as const, metaMessageId: "wamid.document" })),
    generateAiReply: vi.fn(async () => null),
    generateAiReplyWithHistory: vi.fn(async () => null),
    fallbackReply: "fallback",
    log: vi.fn(),
  };
}

function creationButton(kind: "factura" | "boleta") {
  return expect.objectContaining({ id: expect.stringMatching(/^enterprise_issue_invoice:/), title: `Crear ${kind}` });
}

const MAIN_MENU_BUTTONS = [
  { id: "enterprise_invoice", title: "Generar Factura" },
  { id: "enterprise_receipt", title: "Generar Boleta" },
  { id: "enterprise_other_options", title: "Otras opciones" },
];

async function savedCheckpoint(state: MemoryState) {
  return JSON.parse((await state.get("enterprise-test", 1, "enterprise-advisor"))!);
}

async function preparedReceipt() {
  const state = new MemoryState();
  const documents = new MemoryDocuments();
  const facturaya = new FakeFacturaya();
  facturaya.importInvoiceDraft.mockResolvedValue({ ok: true, data: anonymousReceiptDraft });
  const ai = fakeAi(JSON.stringify({ user_intent: "billing_update", action: "receipt",
    customer_name: "Cliente Prueba", products_changed: true,
    products_text: "1 accesorio a S/ 50", products_ready: true, missing_product_data: [] }));
  const handler = new EnterpriseAdvisorRoleHandler();
  await startReceipt(handler, state, documents, facturaya, ai);
  const context = makeContext(state, documents, facturaya, ai, { text: "1 accesorio a S/ 50" });
  await handler.handle(context);
  return { state, documents, facturaya, ai, handler, context };
}

function fakeAi(content: string): AiProvider {
  return {
    key: "openai",
    complete: vi.fn(async () => content),
  };
}

async function startBilling(
  handler: EnterpriseAdvisorRoleHandler,
  state: MemoryState,
  documents: MemoryDocuments,
  facturaya: FakeFacturaya,
  ai: AiProvider,
  selectCash = true,
): Promise<void> {
  await handler.handle(makeContext(state, documents, facturaya, ai, { text: "hola" }));
  await handler.handle(makeContext(state, documents, facturaya, ai, {
    interactionId: "enterprise_billing",
    text: "enterprise_billing",
  }));
  await handler.handle(makeContext(state, documents, facturaya, ai, {
    interactionId: "enterprise_invoice",
    text: "enterprise_invoice",
  }));
  // Existing scenarios assume cash; select it explicitly as a user turn.
  if (selectCash) await handler.handle({ ...makeContext(state, documents, facturaya, ai,
    { text: "Al contado" }), ai: fakeAi(JSON.stringify({ interpretation_version: 1, user_intent: "billing_update",
      payment_method: "contado", source_evidence: { payment_method: "Al contado" }, products_changed: false })) });
}

async function startReceipt(
  handler: EnterpriseAdvisorRoleHandler,
  state: MemoryState,
  documents: MemoryDocuments,
  facturaya: FakeFacturaya,
  ai: AiProvider,
): Promise<void> {
  await handler.handle(makeContext(state, documents, facturaya, ai, { text: "hola" }));
  await handler.handle(makeContext(state, documents, facturaya, ai, {
    interactionId: "enterprise_billing",
    text: "enterprise_billing",
  }));
  await handler.handle(makeContext(state, documents, facturaya, ai, {
    interactionId: "enterprise_receipt",
    text: "enterprise_receipt",
  }));
}

describe("enterprise-advisor role", () => {
  async function creditScenario(overrides: Record<string, unknown> = {}, source?: string) {
    const state = new MemoryState();
    const documents = new MemoryDocuments();
    const facturaya = new FakeFacturaya();
    const creditDraft: FacturayaInvoiceDraft = { ...draft, payment_method: "credito", outstanding_amount: "100.00",
      installments: [{ due_date: "2027-12-05", amount: "60.00" }, { due_date: "2027-12-10", amount: "40.00" }] };
    facturaya.importInvoiceDraft.mockResolvedValue({ ok: true, data: creditDraft });
    const ai = fakeAi(JSON.stringify({ user_intent: "billing_update", action: "invoice", customer_document: "20123456789",
      customer_name: "Cliente Demo", issue_date: "2026-11-05", products_changed: true,
      products_text: "1 servicio a S/ 118", products_ready: true, payment_method: "credito",
      outstanding_amount: "100.00", installments: creditDraft.installments, ...overrides }));
    const handler = new EnterpriseAdvisorRoleHandler();
    await startBilling(handler, state, documents, facturaya, ai, false);
    const context = makeContext(state, documents, facturaya, ai, { text: source
      ?? "Factura RUC 20123456789 a nombre de Cliente Demo, 1 servicio S/ 118. Al crédito, saldo 100.00; cuota 60.00 vence 05 diciembre 2027; cuota 40.00 vence 10/12/2027." });
    await handler.handle(context);
    return { state, documents, facturaya, handler, context, creditDraft };
  }

  it("asks whether a new invoice is cash or credit without assuming cash", async () => {
    const p = await creditScenario({ payment_method: null, outstanding_amount: null, installments: null },
      "Factura RUC 20123456789 a nombre de Cliente Demo, 1 servicio S/ 118");
    expect(p.facturaya.importInvoiceDraft).not.toHaveBeenCalled();
    expect(p.context.reply).toHaveBeenCalledWith(expect.stringContaining("contado o crédito"));
    expect((await savedCheckpoint(p.state)).billing.paymentMethod).toBeNull();
  });

  it("shows balance, currency and every installment before enabling creation", async () => {
    const p = await creditScenario();
    expect(p.facturaya.importInvoiceDraft).toHaveBeenCalledWith(expect.objectContaining({ paymentMethod: "credito",
      outstandingAmount: "100.00", installments: p.creditDraft.installments }));
    expect(p.context.sendButtons).toHaveBeenCalledWith(expect.stringContaining("Condición de pago: Crédito"),
      expect.arrayContaining([creationButton("factura")]));
    const body = vi.mocked(p.context.sendButtons!).mock.calls[0][0];
    expect(body).toContain("Saldo pendiente: S/ 100.00");
    expect(body).toContain("60.00 — vence 2027-12-05");
    expect(body).toContain("40.00 — vence 2027-12-10");
    expect(p.facturaya.issueInvoice).not.toHaveBeenCalled();
  });

  it("captures products and credit together without requiring the word producto", async () => {
    const p = await creditScenario({ products_text: "1 computador a S/ 118" },
      "Factura RUC 20123456789 a nombre de Cliente Demo, 1 computador S/ 118. Al crédito saldo 100.00; cuota 60.00 vence 2027-12-05; cuota 40.00 vence 2027-12-10");
    expect(p.facturaya.importInvoiceDraft).toHaveBeenCalledWith(expect.objectContaining({
      paymentMethod: "credito", productsText: "1 computador a S/ 118" }));
  });

  it("rejects an extractor-invented year and amount and keeps the products", async () => {
    const p = await creditScenario({},
      "Factura RUC 20123456789 a nombre de Cliente Demo, 1 servicio S/ 118. Al crédito, saldo 100.00; vence 05 diciembre.");
    expect(p.facturaya.importInvoiceDraft).not.toHaveBeenCalled();
    expect(p.context.reply).toHaveBeenCalledWith(expect.stringContaining("fecha completa"));
    const checkpoint = await savedCheckpoint(p.state);
    expect(checkpoint.billing.productsText).toBe("1 servicio a S/ 118");
    expect(checkpoint.confirmation).toBeUndefined();
  });

  it("asks for the pending balance and installment amounts instead of inventing them", async () => {
    const p = await creditScenario({ outstanding_amount: null, installments: [{ due_date: "2027-12-05", amount: null }] },
      "Factura RUC 20123456789 a nombre de Cliente Demo, 1 servicio S/ 118. Al crédito, vence 2027-12-05.");
    expect(p.facturaya.importInvoiceDraft).not.toHaveBeenCalled();
    expect(p.context.reply).toHaveBeenCalledWith(expect.stringContaining("importe explícito"));
  });

  it("invalidates the old button on an incomplete payment change, preserving products", async () => {
    const p = await creditScenario();
    const previous = await savedCheckpoint(p.state);
    const change = makeContext(p.state, p.documents, p.facturaya, fakeAi(JSON.stringify({ user_intent: "billing_update",
      products_changed: false, installments: [{ due_date: "2028-12-05", amount: "100.00" }] })),
    { text: "Cambia el vencimiento de la cuota de 100.00 al 05 diciembre" });
    await p.handler.handle(change);
    const current = await savedCheckpoint(p.state);
    expect(current.confirmation).toBeUndefined();
    expect(current.revision).toBeGreaterThan(previous.revision);
    expect(current.billing.productsText).toBe(previous.billing.productsText);
    expect(p.facturaya.importInvoiceDraft).toHaveBeenCalledOnce();
    await p.handler.handle(makeContext(p.state, p.documents, p.facturaya, fakeAi("{}"),
      { text: previous.confirmation.buttonId, interactionId: previous.confirmation.buttonId }));
    expect(p.facturaya.issueInvoice).not.toHaveBeenCalled();
  });

  it.each(["balance_above_total", "api_changed_to_cash"])("blocks the confirmation for %s", async (reason) => {
    const p = await creditScenario();
    p.facturaya.importInvoiceDraft.mockResolvedValue({ ok: true, data: reason === "balance_above_total"
      ? { ...p.creditDraft, totals: { total: 90 }, items: [{ description: "Servicio", quantity: 1, line_total: 90 }] }
      : { ...p.creditDraft, payment_method: "contado", outstanding_amount: null, installments: [] } });
    const context = makeContext(p.state, p.documents, p.facturaya, fakeAi(JSON.stringify({ user_intent: "billing_update",
      customer_name: "Otro Cliente", products_changed: false })), { text: "Cambia el nombre del cliente a Otro Cliente" });
    await p.handler.handle(context);
    expect((await savedCheckpoint(p.state)).confirmation).toBeUndefined();
    expect(context.sendButtons).toHaveBeenCalledWith(expect.any(String),
      expect.not.arrayContaining([creationButton("factura")]));
    expect(p.facturaya.issueInvoice).not.toHaveBeenCalled();
  });

  it("clears credit terms on an explicit change to cash and shows a new confirmation", async () => {
    const p = await creditScenario();
    p.facturaya.importInvoiceDraft.mockResolvedValue({ ok: true, data: { ...draft, payment_method: "contado",
      outstanding_amount: null, installments: [] } });
    const previous = await savedCheckpoint(p.state);
    const context = makeContext(p.state, p.documents, p.facturaya, fakeAi(JSON.stringify({ user_intent: "billing_update",
      payment_method: "contado", products_changed: false })), { text: "Cámbialo a contado" });
    await p.handler.handle(context);
    expect(p.facturaya.importInvoiceDraft).toHaveBeenLastCalledWith(expect.objectContaining({ paymentMethod: "contado",
      outstandingAmount: null, installments: [], productsText: previous.billing.productsText }));
    const current = await savedCheckpoint(p.state);
    expect(current.confirmation.buttonId).not.toBe(previous.confirmation.buttonId);
  });

  it("invalidates confirmation for a partial date even if the extractor supplies no payment fields", async () => {
    const p = await creditScenario();
    const change = makeContext(p.state, p.documents, p.facturaya, fakeAi(JSON.stringify({ user_intent: "unknown" })),
      { text: "Cambia el vencimiento al 05 diciembre" });
    await p.handler.handle(change);
    expect((await savedCheckpoint(p.state)).confirmation).toBeUndefined();
    expect(change.reply).toHaveBeenCalledWith(expect.stringContaining("día, mes y año"));
    expect(p.facturaya.importInvoiceDraft).toHaveBeenCalledOnce();
  });

  it("keeps balance across turns and resumes incomplete installments after a handler restart", async () => {
    const p = await creditScenario({ installments: [{ due_date: "2027-12-05", amount: null }] },
      "Factura RUC 20123456789 a nombre de Cliente Demo, 1 servicio S/ 118. Al crédito saldo 100.00, vence 05 diciembre 2027.");
    expect(p.facturaya.importInvoiceDraft).not.toHaveBeenCalled();
    const followup = makeContext(p.state, p.documents, p.facturaya, fakeAi(JSON.stringify({ user_intent: "billing_update",
      products_changed: false, installments: [{ due_date: "2027-12-05", amount: "100.00" }] })),
      { text: "La cuota pendiente es de 100.00" });
    p.facturaya.importInvoiceDraft.mockResolvedValue({ ok: true, data: { ...p.creditDraft,
      installments: [{ due_date: "2027-12-05", amount: "100.00" }] } });
    await new EnterpriseAdvisorRoleHandler().handle(followup);
    expect((await savedCheckpoint(p.state)).billing).toMatchObject({ paymentMethod: "credito",
      outstandingAmount: "100.00", installments: [{ due_date: "2027-12-05", amount: "100.00" }] });
    expect(p.facturaya.importInvoiceDraft).toHaveBeenCalledWith(expect.objectContaining({ outstandingAmount: "100.00",
      productsText: "1 servicio a S/ 118", installments: [{ due_date: "2027-12-05", amount: "100.00" }] }));
    expect((await savedCheckpoint(p.state)).confirmation).toBeDefined();
  });

  it("rejects credit for a receipt without importing or enabling creation", async () => {
    const p = await preparedReceipt();
    const change = makeContext(p.state, p.documents, p.facturaya, fakeAi(JSON.stringify({ user_intent: "billing_update",
      payment_method: "credito", products_changed: false })), { text: "Cambia a crédito" });
    await p.handler.handle(change);
    expect((await savedCheckpoint(p.state)).confirmation).toBeUndefined();
    expect(p.facturaya.importInvoiceDraft).toHaveBeenCalledOnce();
    expect(change.reply).toHaveBeenCalledWith(expect.stringContaining("sólo está disponible para facturas"));
  });

  afterEach(() => vi.useRealTimers());

  it("interprets a consolidated receipt burst once, resolves DNI once and keeps all commercial fields", async () => {
    const state = new MemoryState();
    const documents = new MemoryDocuments();
    const facturaya = new FakeFacturaya();
    facturaya.lookupCustomerByDni.mockResolvedValue({ ok: true,
      data: { ruc: "12345678", name: "CLIENTE SINTÉTICO" } });
    facturaya.importInvoiceDraft.mockResolvedValue({ ok: true, data: {
      ...receiptDraft, customer: { document_type: "1", ruc: "12345678", name: "CLIENTE SINTÉTICO" },
      items: [{ description: "Chalecos con bordados", quantity: 25, line_total: 900 }],
      totals: { subtotal: 762.71, igv: 137.29, total: 900 }, issue_date: "2026-10-20",
    } });
    const ai = fakeAi(JSON.stringify({ user_intent: "billing_update", action: "receipt",
      customer_document: "12345678", customer_name: null, products_changed: true,
      products_text: "25 chalecos con bordados, precio total 900 soles", products_ready: true,
      missing_product_data: [], issue_date: "2026-10-20" }));
    const handler = new EnterpriseAdvisorRoleHandler();
    await startReceipt(handler, state, documents, facturaya, ai);
    vi.mocked(ai.complete).mockClear();
    const context = makeContext(state, documents, facturaya, ai, { text: [
      "Chalecos con bordados", "25 unidades", "DNI 12345678", "Precio total 900 soles", "Fecha dos días atrás",
    ].join("\n") });
    await handler.handle(context);
    expect(ai.complete).toHaveBeenCalledOnce();
    expect(facturaya.lookupCustomerByDni).toHaveBeenCalledExactlyOnceWith("12345678");
    expect(facturaya.importInvoiceDraft).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      customerName: "CLIENTE SINTÉTICO", productsText: "25 chalecos con bordados, precio total 900 soles",
      issueDate: "2026-10-20", customerRuc: "12345678",
    }));
    expect(facturaya.issueInvoice).not.toHaveBeenCalled();
  });

  it("routes an explicit DNI query despite an AI refusal and preserves products", async () => {
    const p = await preparedReceipt();
    const before = await savedCheckpoint(p.state);
    p.facturaya.lookupCustomerByDni.mockResolvedValue({ ok: true,
      data: { ruc: "12345678", name: "NOMBRE VERIFICADO" } });
    p.facturaya.importInvoiceDraft.mockResolvedValue({ ok: true, data: {
      ...anonymousReceiptDraft, customer: { document_type: "1", ruc: "12345678", name: "NOMBRE VERIFICADO" },
    } });
    const context = makeContext(p.state, p.documents, p.facturaya, fakeAi(JSON.stringify({
      user_intent: "conversation", action: "receipt", reply: "No puedo buscar nombres por DNI",
    })), { text: "Busca el nombre del cliente con DNI 12345678" });
    await p.handler.handle(context);
    expect(p.facturaya.lookupCustomerByDni).toHaveBeenCalledExactlyOnceWith("12345678");
    expect(p.facturaya.importInvoiceDraft).toHaveBeenLastCalledWith(expect.objectContaining({
      customerName: "NOMBRE VERIFICADO", customerRuc: "12345678", productsText: before.billing.productsText,
    }));
    const after = await savedCheckpoint(p.state);
    expect(after.billing.customerName).toBe("NOMBRE VERIFICADO");
    expect(after.confirmation.buttonId).not.toBe(before.confirmation.buttonId);
    expect(p.facturaya.issueInvoice).not.toHaveBeenCalled();
    expect(context.reply).not.toHaveBeenCalledWith("No puedo buscar nombres por DNI");
  });

  it("automatically resolves a receipt DNI without a name", async () => {
    const state = new MemoryState();
    const documents = new MemoryDocuments();
    const facturaya = new FakeFacturaya();
    facturaya.lookupCustomerByDni.mockResolvedValue({ ok: true,
      data: { ruc: "12345678", name: "CLIENTE RESUELTO" } });
    const ai = fakeAi(JSON.stringify({ user_intent: "billing_update", action: "receipt", customer_document: "12345678" }));
    const handler = new EnterpriseAdvisorRoleHandler();
    await startReceipt(handler, state, documents, facturaya, ai);
    await handler.handle(makeContext(state, documents, facturaya, ai, { text: "DNI 12345678" }));
    expect(facturaya.lookupCustomerByDni).toHaveBeenCalledExactlyOnceWith("12345678");
    expect((await savedCheckpoint(state)).billing.customerName).toBe("CLIENTE RESUELTO");
    expect(facturaya.importInvoiceDraft).not.toHaveBeenCalled();
  });

  it("does not repeat DNI lookup when the checkpoint conflicts after the tool", async () => {
    const p = await preparedReceipt();
    p.facturaya.lookupCustomerByDni.mockImplementation(async () => {
      vi.spyOn(p.state, "compareAndSet").mockResolvedValue(false);
      return { ok: true, data: { ruc: "12345678", name: "CLIENTE VERIFICADO" } };
    });
    const context = makeContext(p.state, p.documents, p.facturaya, fakeAi(JSON.stringify({
      user_intent: "conversation", action: "receipt",
    })), { text: "Consulta el nombre del DNI 12345678" });
    await p.handler.handle(context);
    expect(p.facturaya.lookupCustomerByDni).toHaveBeenCalledOnce();
    expect(context.log).toHaveBeenCalledWith("whatsapp_facturaya_checkpoint_failed",
      expect.objectContaining({ reason: "conflict", effectsStarted: true }));
    expect(p.facturaya.issueInvoice).not.toHaveBeenCalled();
  });

  it.each(["not_found", "network_error"] as const)("retains products but clears stale name on DNI change: %s", async (reason) => {
    const p = await preparedReceipt();
    const before = await savedCheckpoint(p.state);
    p.facturaya.lookupCustomerByDni.mockResolvedValue({ ok: false, reason });
    const context = makeContext(p.state, p.documents, p.facturaya, fakeAi(JSON.stringify({
      user_intent: "billing_update", action: "receipt", customer_document: "12345678",
    })), { text: "Cambia el DNI a 12345678" });
    await p.handler.handle(context);
    const after = await savedCheckpoint(p.state);
    expect(after.billing.productsText).toBe(before.billing.productsText);
    expect(after.billing.customerName).toBe("");
    expect(after.confirmation).toBeUndefined();
    expect(context.reply).toHaveBeenCalledWith(expect.stringContaining("Conservé los demás datos"));
    expect(p.facturaya.issueInvoice).not.toHaveBeenCalled();
  });

  it("keeps the checkpoint after a handler restart and a day of inactivity", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const p = await preparedReceipt();
    const previous = await savedCheckpoint(p.state);
    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000);
    const context = makeContext(p.state, p.documents, p.facturaya, fakeAi(JSON.stringify({
      user_intent: "review", action: "unknown",
    })), { text: "Muéstrame el resumen" });
    await new EnterpriseAdvisorRoleHandler().handle(context);
    const current = await savedCheckpoint(p.state);
    expect(current.billing).toEqual(previous.billing);
    expect(current.phase).toBe("review");
    expect(context.sendButtons).toHaveBeenCalledWith(expect.stringContaining("Total: S/ 50.00"), expect.any(Array));
    expect(p.facturaya.importInvoiceDraft).toHaveBeenCalledOnce();
  });

  it("expires a checkpoint after seven inactive days", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const p = await preparedReceipt();
    vi.setSystemTime(Date.now() + 8 * 24 * 60 * 60 * 1000);
    await p.handler.handle(makeContext(p.state, p.documents, p.facturaya, p.ai, { text: "hola" }));
    expect((await savedCheckpoint(p.state)).billing).toBeUndefined();
    expect((await savedCheckpoint(p.state)).confirmation).toBeUndefined();
  });

  it.each(["Hola estás funcionando?", "Gracias por la ayuda"])("does not import conversation as products: %s", async (text) => {
    const p = await preparedReceipt();
    const previous = await savedCheckpoint(p.state);
    // Even a malformed classifier response must not overwrite products with a greeting.
    const ai = fakeAi(JSON.stringify({ action: "receipt", products_changed: true, products_ready: true, products_text: text }));
    await p.handler.handle(makeContext(p.state, p.documents, p.facturaya, ai, { text }));
    expect((await savedCheckpoint(p.state)).billing).toEqual(previous.billing);
    expect(p.facturaya.importInvoiceDraft).toHaveBeenCalledOnce();
  });

  it("applies only a customer name even when the model places it in products_text", async () => {
    const p = await preparedReceipt();
    const ai = fakeAi(JSON.stringify({ user_intent: "billing_update", action: "receipt",
      customer_name: "Cliente Actualizado", products_text: "Cliente Actualizado", products_changed: true }));
    await p.handler.handle(makeContext(p.state, p.documents, p.facturaya, ai, { text: "Cliente Actualizado" }));
    expect(p.facturaya.importInvoiceDraft).toHaveBeenLastCalledWith(expect.objectContaining({
      customerName: "Cliente Actualizado", productsText: "1 accesorio a S/ 50",
    }));
  });

  it("preserves products when a DNI correction is mislabeled as products", async () => {
    const p = await preparedReceipt();
    p.facturaya.lookupCustomerByDni.mockResolvedValue({ ok: true,
      data: { ruc: "87654321", name: "CLIENTE VERIFICADO" } });
    const text = "Quiero cambiar el DNI y que sea 87654321";
    const ai = fakeAi(JSON.stringify({ user_intent: "billing_update", action: "receipt",
      customer_document: "87654321", products_text: text, products_changed: true, products_ready: true }));
    await p.handler.handle(makeContext(p.state, p.documents, p.facturaya, ai, { text }));
    expect(p.facturaya.importInvoiceDraft).toHaveBeenLastCalledWith(expect.objectContaining({
      customerRuc: "87654321", productsText: "1 accesorio a S/ 50",
    }));
  });

  it("keeps a consolidated price correction and invalidates the previous creation button", async () => {
    const p = await preparedReceipt();
    const oldButton = (await savedCheckpoint(p.state)).confirmation.buttonId;
    const ai = fakeAi(JSON.stringify({ user_intent: "billing_update", action: "receipt",
      products_changed: true, products_text: "1 accesorio a S/ 80", products_ready: true }));
    await p.handler.handle(makeContext(p.state, p.documents, p.facturaya, ai, { text: "Cambia el total a 80 soles" }));
    expect(p.facturaya.importInvoiceDraft).toHaveBeenLastCalledWith(expect.objectContaining({ productsText: "1 accesorio a S/ 80" }));
    await p.handler.handle(makeContext(p.state, p.documents, p.facturaya, p.ai, { interactionId: oldButton }));
    expect(p.facturaya.issueInvoice).not.toHaveBeenCalled();
  });

  it("keeps accepted corrections in the checkpoint after an import fails", async () => {
    const p = await preparedReceipt();
    p.facturaya.importInvoiceDraft.mockResolvedValue({ ok: false, reason: "api_error" });
    await p.handler.handle(makeContext(p.state, p.documents, p.facturaya, fakeAi(JSON.stringify({
      user_intent: "billing_update", action: "receipt", customer_name: "Cliente Nuevo", products_changed: false,
    })), { text: "A nombre de Cliente Nuevo" }));
    const checkpoint = await savedCheckpoint(p.state);
    expect(checkpoint.billing.customerName).toBe("Cliente Nuevo");
    expect(checkpoint.billing.productsText).toBe("1 accesorio a S/ 50");
    expect(checkpoint.confirmation).toBeUndefined();
    expect(checkpoint.phase).toBe("collecting");
    p.facturaya.importInvoiceDraft.mockResolvedValue({ ok: true, data: anonymousReceiptDraft });
    await p.handler.handle(makeContext(p.state, p.documents, p.facturaya,
      fakeAi(JSON.stringify({ user_intent: "review", action: "unknown" })), { text: "Muéstrame el resumen" }));
    expect(p.facturaya.importInvoiceDraft).toHaveBeenLastCalledWith(expect.objectContaining({
      customerName: "Cliente Nuevo", productsText: "1 accesorio a S/ 50",
    }));
    expect((await savedCheckpoint(p.state)).confirmation).toBeDefined();
  });

  it("reads legacy session data without accepting its unversioned issue button", async () => {
    const p = await preparedReceipt();
    const current = await savedCheckpoint(p.state);
    const { revision, phase, draft: previousDraft, confirmation, ...legacy } = current;
    await p.state.set("enterprise-test", 1, "enterprise-advisor", JSON.stringify({ ...legacy, version: 1 }));
    await p.handler.handle(makeContext(p.state, p.documents, p.facturaya, p.ai, { interactionId: "enterprise_issue_invoice" }));
    expect(p.facturaya.issueInvoice).not.toHaveBeenCalled();
    expect((await savedCheckpoint(p.state)).billing.productsText).toBe("1 accesorio a S/ 50");
    expect((await savedCheckpoint(p.state)).version).toBe(2);
    p.facturaya.listInvoiceDrafts.mockResolvedValue({ ok: true, data: [anonymousReceiptDraft] });
    await p.handler.handle(makeContext(p.state, p.documents, p.facturaya,
      fakeAi(JSON.stringify({ user_intent: "review", action: "unknown" })), { text: "Muéstrame el resumen" }));
    expect((await savedCheckpoint(p.state)).confirmation.buttonId).toMatch(/^enterprise_issue_invoice:/);
  });

  it.each(["emitir", "confirmar", "Crear boleta"])("does not issue through text: %s", async (text) => {
    const p = await preparedReceipt();
    await p.handler.handle(makeContext(p.state, p.documents, p.facturaya, p.ai, { text }));
    expect(p.facturaya.issueInvoice).not.toHaveBeenCalled();
    expect(p.facturaya.importInvoiceDraft).toHaveBeenCalledOnce();
  });

  it("requires the latest delivered button and processes it only once", async () => {
    const p = await preparedReceipt();
    const oldButton = (await savedCheckpoint(p.state)).confirmation.buttonId;
    const reviewAi = fakeAi(JSON.stringify({ user_intent: "review", action: "unknown" }));
    await p.handler.handle(makeContext(p.state, p.documents, p.facturaya, reviewAi, { text: "Resumen" }));
    const currentButton = (await savedCheckpoint(p.state)).confirmation.buttonId;
    await p.handler.handle(makeContext(p.state, p.documents, p.facturaya, p.ai, { interactionId: oldButton }));
    expect(p.facturaya.issueInvoice).not.toHaveBeenCalled();
    p.facturaya.issueInvoice.mockResolvedValue({ ok: true, data: { id: "invoice-test", number: "B001-1", status: "accepted", document_type: "03" } });
    await p.handler.handle(makeContext(p.state, p.documents, p.facturaya, p.ai, { interactionId: currentButton }));
    await p.handler.handle(makeContext(p.state, p.documents, p.facturaya, p.ai, { interactionId: currentButton, id: "another-click" }));
    expect(p.facturaya.issueInvoice).toHaveBeenCalledOnce();
    expect((await savedCheckpoint(p.state)).phase).toBe("issued");
  });

  it("rejects legacy and forged creation buttons", async () => {
    const p = await preparedReceipt();
    for (const interactionId of ["enterprise_issue_invoice", "enterprise_issue_invoice:forged"]) {
      await p.handler.handle(makeContext(p.state, p.documents, p.facturaya, p.ai, { interactionId }));
    }
    expect(p.facturaya.issueInvoice).not.toHaveBeenCalled();
  });

  it("allows only one concurrent creation attempt for the same checkpoint", async () => {
    const p = await preparedReceipt();
    const interactionId = (await savedCheckpoint(p.state)).confirmation.buttonId;
    p.facturaya.issueInvoice.mockResolvedValue({ ok: true, data: { id: "invoice-test", number: "B001-1", status: "accepted" } });
    await Promise.all([
      p.handler.handle(makeContext(p.state, p.documents, p.facturaya, p.ai, { interactionId, id: "click-a" })),
      p.handler.handle(makeContext(p.state, p.documents, p.facturaya, p.ai, { interactionId, id: "click-b" })),
    ]);
    expect(p.facturaya.issueInvoice).toHaveBeenCalledOnce();
  });

  it.each([false, true])("rebases concurrent product and DNI changes across handler instances (reverse=%s)", async (reverse) => {
    const state = new MemoryState();
    const documents = new MemoryDocuments();
    const facturaya = new FakeFacturaya();
    facturaya.importInvoiceDraft.mockResolvedValue({ ok: false, reason: "api_error" });
    const ai: AiProvider = { key: "openai", complete: vi.fn(async (request) => {
      const text = String(request.messages.at(-1)?.content);
      return JSON.stringify(text.includes("polos")
        ? { user_intent: "billing_update", action: "receipt", products_changed: true,
            products_text: "40 polos con bordados precio total S/ 1080", products_ready: true }
        : { user_intent: "billing_update", action: "receipt", customer_document: "12345678", products_changed: false });
    }) };
    await startReceipt(new EnterpriseAdvisorRoleHandler(), state, documents, facturaya, ai);
    const products = makeContext(state, documents, facturaya, ai, { id: "products", text: "40 polos con bordados precio total 1080 soles" });
    const customer = makeContext(state, documents, facturaya, ai, { id: "dni", text: "Quiero cambiar el DNI a 12345678" });
    const inputs = reverse ? [customer, products] : [products, customer];
    await Promise.all(inputs.map((context) => new EnterpriseAdvisorRoleHandler().handle(context)));
    const checkpoint = await savedCheckpoint(state);
    expect(checkpoint.billing.productsText).toContain("40 polos");
    expect(checkpoint.billing.customerRuc).toBe("12345678");
    expect(checkpoint.billing.productsReady).toBe(true);
    expect(facturaya.issueInvoice).not.toHaveBeenCalled();
    expect(inputs.some((context) => vi.mocked(context.log).mock.calls.some(([event]) => event === "whatsapp_facturaya_checkpoint_retry"))).toBe(true);
  });

  it("does not retry storage failures as conflicts or expose their raw error", async () => {
    const p = await preparedReceipt();
    vi.spyOn(p.state, "compareAndSet").mockRejectedValue(new RoleStateStorageError("compare_and_set"));
    const context = makeContext(p.state, p.documents, p.facturaya, p.ai, { text: "cambiar nombre" });
    await p.handler.handle(context);
    expect(context.log).toHaveBeenCalledWith("whatsapp_facturaya_checkpoint_failed", expect.objectContaining({ reason: "storage_error", attempt: 1, operation: "compare_and_set" }));
    expect(context.reply).toHaveBeenCalledWith(expect.stringContaining("almacenamiento"));
    expect(context.log).not.toHaveBeenCalledWith("whatsapp_facturaya_checkpoint_retry", expect.anything());
  });

  it.each(["read", "compare_and_set"] as const)("handles storage failure %s from an independently bundled adapter", async (operation) => {
    const p = await preparedReceipt();
    const foreignError = Object.assign(new Error("Role state storage unavailable"), { operation });
    vi.spyOn(p.state, operation === "read" ? "get" : "compareAndSet").mockRejectedValue(foreignError);
    const context = makeContext(p.state, p.documents, p.facturaya, p.ai, { text: "cambiar nombre" });
    await p.handler.handle(context);
    expect(context.reply).toHaveBeenCalledWith(expect.stringContaining("almacenamiento"));
    expect(context.log).toHaveBeenCalledWith("whatsapp_facturaya_checkpoint_failed", expect.objectContaining({ reason: "storage_error", attempt: 1, operation }));
    expect(context.log).not.toHaveBeenCalledWith("whatsapp_facturaya_checkpoint_retry", expect.anything());
    expect(p.facturaya.issueInvoice).not.toHaveBeenCalled();
  });

  it("reclassifies a slow product turn against the DNI checkpoint committed during classification", async () => {
    const state = new MemoryState();
    const documents = new MemoryDocuments();
    const facturaya = new FakeFacturaya();
    facturaya.importInvoiceDraft.mockResolvedValue({ ok: false, reason: "api_error" });
    let release!: () => void;
    let started!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const classifying = new Promise<void>((resolve) => { started = resolve; });
    let first = true;
    const ai: AiProvider = { key: "openai", complete: vi.fn(async () => {
      if (first) { first = false; started(); await pending; }
      return JSON.stringify({ user_intent: "billing_update", action: "receipt", products_changed: true,
        products_text: "40 polos precio total S/ 1080", products_ready: true });
    }) };
    await startReceipt(new EnterpriseAdvisorRoleHandler(), state, documents, facturaya, ai);
    const productContext = makeContext(state, documents, facturaya, ai, { id: "slow-products", text: "40 polos precio total 1080 soles" });
    const productTurn = new EnterpriseAdvisorRoleHandler().handle(productContext);
    await classifying;
    const dniAi = fakeAi(JSON.stringify({ user_intent: "billing_update", action: "receipt", products_changed: false, customer_document: "12345678" }));
    await new EnterpriseAdvisorRoleHandler().handle(makeContext(state, documents, facturaya, dniAi, { id: "fast-dni", text: "DNI 12345678" }));
    release();
    await productTurn;
    expect(vi.mocked(ai.complete).mock.calls.length).toBeGreaterThan(1);
    expect((await savedCheckpoint(state)).billing).toMatchObject({ customerRuc: "12345678", productsText: "40 polos precio total S/ 1080" });
    expect(productContext.log).toHaveBeenCalledWith("whatsapp_facturaya_checkpoint_retry", expect.objectContaining({ reason: "conflict" }));
    expect(facturaya.issueInvoice).not.toHaveBeenCalled();
  });

  it("never repeats an import after a post-provider checkpoint conflict", async () => {
    const p = await preparedReceipt();
    p.facturaya.importInvoiceDraft.mockImplementationOnce(async () => {
      const current = await savedCheckpoint(p.state);
      await p.state.set("enterprise-test", 1, "enterprise-advisor", JSON.stringify({ ...current, revision: current.revision + 1 }));
      return { ok: true, data: anonymousReceiptDraft };
    });
    const before = p.facturaya.importInvoiceDraft.mock.calls.length;
    const context = makeContext(p.state, p.documents, p.facturaya,
      fakeAi(JSON.stringify({ user_intent: "billing_update", action: "receipt", customer_name: "Cliente Nuevo", products_changed: false })),
      { text: "Cambia el nombre del cliente a Cliente Nuevo" });
    await p.handler.handle(context);
    expect(p.facturaya.importInvoiceDraft.mock.calls.length).toBe(before + 1);
    expect(context.log).toHaveBeenCalledWith("whatsapp_facturaya_checkpoint_failed", expect.objectContaining({ reason: "conflict", effectsStarted: true }));
    expect(context.reply).toHaveBeenCalledWith(expect.stringContaining("No repetí la operación"));
    expect((await savedCheckpoint(p.state)).billing.customerName).toBe("Cliente Nuevo");
    expect(p.facturaya.issueInvoice).not.toHaveBeenCalled();
  });

  it("keeps the checkpoint when the same company must be selected again", async () => {
    const p = await preparedReceipt();
    const before = await savedCheckpoint(p.state);
    p.facturaya.selectTenant.mockResolvedValue(await p.facturaya.resolveTenantAccess());
    await p.handler.handle(makeContext(p.state, p.documents, p.facturaya, p.ai, {
      interactionId: "enterprise_company:company-demo", text: "enterprise_company:company-demo",
    }));
    expect((await savedCheckpoint(p.state)).billing).toEqual(before.billing);
    expect(p.facturaya.importInvoiceDraft).toHaveBeenCalledOnce();
  });

  it("clears the previous review when selecting another company", async () => {
    const p = await preparedReceipt();
    const access = await p.facturaya.resolveTenantAccess();
    if (access.status !== "authorized") throw new Error("fixture");
    p.facturaya.selectTenant.mockResolvedValue({ ...access, tenant: { ...access.tenant, id: "company-other" } });
    await p.handler.handle(makeContext(p.state, p.documents, p.facturaya, p.ai, {
      interactionId: "enterprise_company:company-other", text: "enterprise_company:company-other",
    }));
    const checkpoint = await savedCheckpoint(p.state);
    expect(checkpoint.billing).toBeUndefined();
    expect(checkpoint.confirmation).toBeUndefined();
    expect(checkpoint.draft).toBeUndefined();
  });

  it("does not process a duplicate Meta event", async () => {
    const p = await preparedReceipt();
    const context = makeContext(p.state, p.documents, p.facturaya, p.ai, {
      interactionId: (await savedCheckpoint(p.state)).confirmation.buttonId,
    });
    context.persisted.duplicate = true;
    await p.handler.handle(context);
    expect(p.facturaya.issueInvoice).not.toHaveBeenCalled();
  });

  it("does not enable creation when the confirmation was not delivered", async () => {
    const p = await preparedReceipt();
    const oldButton = (await savedCheckpoint(p.state)).confirmation.buttonId;
    const context = makeContext(p.state, p.documents, p.facturaya,
      fakeAi(JSON.stringify({ user_intent: "review", action: "unknown" })), { text: "Resumen" });
    context.sendButtons = vi.fn(async () => ({ status: "failed" as const, metaMessageId: null }));
    await p.handler.handle(context);
    expect((await savedCheckpoint(p.state)).confirmation).toBeUndefined();
    await p.handler.handle(makeContext(p.state, p.documents, p.facturaya, p.ai, { interactionId: oldButton }));
    expect(p.facturaya.issueInvoice).not.toHaveBeenCalled();
  });

  it("fails closed on a checkpoint write conflict before issuing", async () => {
    const p = await preparedReceipt();
    const buttonId = (await savedCheckpoint(p.state)).confirmation.buttonId;
    vi.spyOn(p.state, "compareAndSet").mockResolvedValue(false);
    const context = makeContext(p.state, p.documents, p.facturaya, p.ai, { interactionId: buttonId });
    await p.handler.handle(context);
    expect(p.facturaya.issueInvoice).not.toHaveBeenCalled();
    expect(context.log).toHaveBeenCalledWith("whatsapp_facturaya_checkpoint_failed", expect.any(Object));
  });

  it("does not retry an uncertain emission after a network failure", async () => {
    const p = await preparedReceipt();
    const interactionId = (await savedCheckpoint(p.state)).confirmation.buttonId;
    p.facturaya.issueInvoice.mockResolvedValue({ ok: false, reason: "network_error" });
    await p.handler.handle(makeContext(p.state, p.documents, p.facturaya, p.ai, { interactionId }));
    await p.handler.handle(makeContext(p.state, p.documents, p.facturaya, p.ai, { interactionId }));
    expect(p.facturaya.issueInvoice).toHaveBeenCalledOnce();
    expect((await savedCheckpoint(p.state)).phase).toBe("issuing");
  });

  it("shows all items and totals before offering creation for a long summary", async () => {
    const p = await preparedReceipt();
    const longDraft = { ...anonymousReceiptDraft, items: Array.from({ length: 30 }, (_, index) => ({
      description: `Producto ${index + 1}`, quantity: 1, unit_price: 5, line_total: 5,
    })), totals: { subtotal: 127.12, igv: 22.88, total: 150 } };
    const checkpoint = await savedCheckpoint(p.state);
    await p.state.set("enterprise-test", 1, "enterprise-advisor", JSON.stringify({ ...checkpoint, draft: longDraft }));
    const context = makeContext(p.state, p.documents, p.facturaya,
      fakeAi(JSON.stringify({ user_intent: "review", action: "unknown" })), { text: "Resumen" });
    await p.handler.handle(context);
    const fullReview = vi.mocked(context.reply).mock.calls.map(([text]) => text).join("");
    expect(fullReview).toContain("Producto 30");
    expect(fullReview).toContain("Subtotal: S/ 127.12");
    expect(fullReview).toContain("IGV: S/ 22.88");
    expect(fullReview).toContain("Total: S/ 150.00");
    expect(context.sendButtons).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([creationButton("boleta")]));
    expect(vi.mocked(context.reply).mock.invocationCallOrder.at(-1)).toBeLessThan(vi.mocked(context.sendButtons!).mock.invocationCallOrder[0]);
  });

  it("blocks creation if any part of the long review cannot be sent", async () => {
    const p = await preparedReceipt();
    const checkpoint = await savedCheckpoint(p.state);
    const longDraft = { ...anonymousReceiptDraft, items: Array.from({ length: 30 }, (_, index) => ({
      description: `Producto ${index + 1}`, quantity: 1, unit_price: 1, line_total: 1,
    })) };
    await p.state.set("enterprise-test", 1, "enterprise-advisor", JSON.stringify({ ...checkpoint, draft: longDraft }));
    const context = makeContext(p.state, p.documents, p.facturaya,
      fakeAi(JSON.stringify({ user_intent: "review", action: "unknown" })), { text: "Resumen" });
    context.sendText = vi.fn(async () => ({ status: "failed" as const, metaMessageId: null }));
    await p.handler.handle(context);
    expect(context.sendButtons).not.toHaveBeenCalled();
    expect((await savedCheckpoint(p.state)).confirmation).toBeUndefined();
    expect(p.facturaya.issueInvoice).not.toHaveBeenCalled();
  });

  it("starts a durable session with the three main actions", async () => {
    const state = new MemoryState();
    const context = makeContext(state, new MemoryDocuments(), new FakeFacturaya(), fakeAi("{}"), { text: "hola" });

    await new EnterpriseAdvisorRoleHandler().handle(context);

    expect(context.sendButtons).toHaveBeenCalledWith(
      "¡Hola! Soy Manolo. ¿En qué puedo ayudarte hoy?", MAIN_MENU_BUTTONS,
    );
  });

  it("offers factura or boleta after choosing billing", async () => {
    const state = new MemoryState();
    const documents = new MemoryDocuments();
    const facturaya = new FakeFacturaya();
    const ai = fakeAi("{}");
    const handler = new EnterpriseAdvisorRoleHandler();
    await handler.handle(makeContext(state, documents, facturaya, ai, { text: "hola" }));
    const context = makeContext(state, documents, facturaya, ai, {
      interactionId: "enterprise_billing",
      text: "enterprise_billing",
    });

    await handler.handle(context);

    expect(context.sendButtons).toHaveBeenCalledWith(
      "¡Hola! Soy Manolo. ¿En qué puedo ayudarte hoy?", MAIN_MENU_BUTTONS,
    );
  });

  it("asks the user to choose when the phone belongs to several companies", async () => {
    const state = new MemoryState();
    const documents = new MemoryDocuments();
    const facturaya = new FakeFacturaya();
    facturaya.resolveTenantAccess.mockResolvedValue({
      status: "selection_required",
      tenant: null,
      tenants: [
        {
          id: "company-a",
          name: "Empresa A",
          legalName: "Empresa A S.A.C.",
          ruc: "20111111111",
          address: null,
          environment: "production",
          permissions: ["create_invoice"],
        },
        {
          id: "company-b",
          name: "Empresa B",
          legalName: "Empresa B S.A.C.",
          ruc: "20222222222",
          address: null,
          environment: "beta",
          permissions: ["create_invoice"],
        },
      ],
    });
    const handler = new EnterpriseAdvisorRoleHandler();
    await handler.handle(makeContext(state, documents, facturaya, fakeAi("{}"), { text: "hola" }));
    const context = makeContext(state, documents, facturaya, fakeAi("{}"), {
      interactionId: "enterprise_invoice",
      text: "Generar Factura",
    });

    await handler.handle(context);

    expect(context.sendList).toHaveBeenCalledWith(
      expect.stringContaining("varias empresas"),
      "Elegir empresa",
      [expect.objectContaining({
        rows: expect.arrayContaining([
          expect.objectContaining({ id: "enterprise_company:company-a" }),
          expect.objectContaining({ id: "enterprise_company:company-b" }),
        ]),
      })],
    );
    expect(facturaya.importInvoiceDraft).not.toHaveBeenCalled();
  });

  it("creates a billing draft with structured customer data", async () => {
    const state = new MemoryState();
    const documents = new MemoryDocuments();
    const facturaya = new FakeFacturaya();
    facturaya.importInvoiceDraft.mockResolvedValue({ ok: true, data: draft });
    const ai = fakeAi(JSON.stringify({
      action: "invoice",
      customer_ruc: "20123456789",
      customer_name: "Cliente Demo",
      issue_date: "2026-08-20",
      tax_mode: "included",
      products_text: "1 servicio de impresión a S/ 118",
      invoice_number: null,
      reason_code: null,
      reason_description: null,
    }));
    const handler = new EnterpriseAdvisorRoleHandler();

    await startBilling(handler, state, documents, facturaya, ai);
    const context = makeContext(state, documents, facturaya, ai, {
      text: "Factura para Cliente Demo RUC 20123456789: 1 servicio de impresión a S/ 118.",
    });
    await handler.handle(context);

    expect(facturaya.importInvoiceDraft).toHaveBeenCalledWith(expect.objectContaining({
      documentType: "01",
      customerDocumentType: "6",
      customerRuc: "20123456789",
      customerName: "Cliente Demo",
      taxMode: "included",
      productsText: expect.stringContaining("servicio de impresión"),
    }));
    expect(context.sendButtons).toHaveBeenCalledWith(
      expect.stringContaining("Borrador de factura creado"),
      expect.arrayContaining([creationButton("factura")]),
    );
  });

  it("asks for the missing price instead of creating a zero-total draft", async () => {
    const state = new MemoryState();
    const documents = new MemoryDocuments();
    const facturaya = new FakeFacturaya();
    const ai = fakeAi(JSON.stringify({
      action: "invoice",
      customer_document: "10773925360",
      customer_name: "Paola Yanina Dorado Ortiz",
      issue_date: "2026-09-08",
      tax_mode: "included",
      products_text: "32 polos con bordados",
      products_ready: false,
      missing_product_data: ["unit_price_or_total"],
      invoice_number: null,
      reason_code: null,
      reason_description: null,
    }));
    const handler = new EnterpriseAdvisorRoleHandler();
    await startBilling(handler, state, documents, facturaya, ai);
    const context = makeContext(state, documents, facturaya, ai, {
      text: "RUC 10773925360, Paola Yanina Dorado Ortiz, 32 polos con bordados",
    });

    await handler.handle(context);

    expect(facturaya.importInvoiceDraft).not.toHaveBeenCalled();
    expect(context.reply).toHaveBeenCalledWith(expect.stringContaining("costo total o precio unitario"));
    expect(context.sendButtons).not.toHaveBeenCalled();
  });

  it("combines a later total with the products already stored in the session", async () => {
    const state = new MemoryState();
    const documents = new MemoryDocuments();
    const facturaya = new FakeFacturaya();
    facturaya.importInvoiceDraft.mockResolvedValue({
      ok: true,
      data: {
        ...draft,
        customer: { ruc: "10773925360", name: "Paola Yanina Dorado Ortiz" },
        items: [{ description: "Polos con bordados", quantity: 32, line_total: 1_000 }],
        totals: { subtotal: 847.46, igv: 152.54, total: 1_000 },
      },
    });
    const handler = new EnterpriseAdvisorRoleHandler();
    const incompleteAi = fakeAi(JSON.stringify({
      action: "invoice",
      customer_document: "10773925360",
      customer_name: "Paola Yanina Dorado Ortiz",
      issue_date: "2026-09-08",
      tax_mode: "included",
      products_text: "32 polos con bordados",
      products_ready: false,
      missing_product_data: ["unit_price_or_total"],
      invoice_number: null,
      reason_code: null,
      reason_description: null,
    }));
    await startBilling(handler, state, documents, facturaya, incompleteAi);
    await handler.handle(makeContext(state, documents, facturaya, incompleteAi, {
      text: "RUC 10773925360, Paola Yanina Dorado Ortiz, 32 polos con bordados",
    }));

    const completedAi = fakeAi(JSON.stringify({
      action: "invoice",
      customer_document: null,
      customer_name: null,
      issue_date: null,
      tax_mode: null,
      products_text: "32 polos con bordados, costo total S/ 1000",
      products_ready: true,
      missing_product_data: [],
      invoice_number: null,
      reason_code: null,
      reason_description: null,
    }));
    const context = makeContext(state, documents, facturaya, completedAi, {
      text: "El costo total es S/ 1000",
    });
    await handler.handle(context);

    expect(facturaya.importInvoiceDraft).toHaveBeenCalledWith(expect.objectContaining({
      customerRuc: "10773925360",
      customerName: "Paola Yanina Dorado Ortiz",
      productsText: expect.stringMatching(/32 polos[\s\S]*1000/iu),
    }));
    expect(context.sendButtons).toHaveBeenCalledWith(
      expect.stringContaining("Total: S/ 1000.00"),
      expect.any(Array),
    );
  });

  it("blocks emission controls when FacturaYa returns a zero-total draft", async () => {
    const state = new MemoryState();
    const documents = new MemoryDocuments();
    const facturaya = new FakeFacturaya();
    facturaya.importInvoiceDraft.mockResolvedValue({
      ok: true,
      data: {
        ...draft,
        items: [{ description: "Polos con bordados", quantity: 32, line_total: 0 }],
        totals: { subtotal: 0, igv: 0, total: 0 },
      },
    });
    const ai = fakeAi(JSON.stringify({
      action: "invoice",
      customer_document: "10773925360",
      customer_name: "Paola Yanina Dorado Ortiz",
      issue_date: "2026-09-08",
      tax_mode: "included",
      products_text: "32 polos con bordados, costo total S/ 1000",
      products_ready: true,
      missing_product_data: [],
      invoice_number: null,
      reason_code: null,
      reason_description: null,
    }));
    const handler = new EnterpriseAdvisorRoleHandler();
    await startBilling(handler, state, documents, facturaya, ai);
    const context = makeContext(state, documents, facturaya, ai, {
      text: "RUC 10773925360, Paola Yanina Dorado Ortiz, 32 polos con bordados, total S/ 1000",
    });

    await handler.handle(context);

    expect(facturaya.importInvoiceDraft).toHaveBeenCalledOnce();
    expect(context.sendButtons).not.toHaveBeenCalled();
    expect(context.reply).toHaveBeenCalledWith(expect.stringContaining("no pudo determinar un importe válido"));
  });

  it("creates a boleta draft with DNI and the receipt contract", async () => {
    const state = new MemoryState();
    const documents = new MemoryDocuments();
    const facturaya = new FakeFacturaya();
    facturaya.importInvoiceDraft.mockResolvedValue({ ok: true, data: receiptDraft });
    const ai = fakeAi(JSON.stringify({
      action: "receipt",
      customer_document: "12345678",
      customer_name: "CLIENTE",
      issue_date: "2026-08-23",
      tax_mode: "included",
      products_text: "2 motos a S/ 15600 total",
      invoice_number: null,
      reason_code: null,
      reason_description: null,
    }));
    const handler = new EnterpriseAdvisorRoleHandler();
    await handler.handle(makeContext(state, documents, facturaya, ai, { text: "hola" }));
    await handler.handle(makeContext(state, documents, facturaya, ai, {
      interactionId: "enterprise_billing",
      text: "enterprise_billing",
    }));
    await handler.handle(makeContext(state, documents, facturaya, ai, {
      interactionId: "enterprise_receipt",
      text: "enterprise_receipt",
    }));
    const context = makeContext(state, documents, facturaya, ai, {
      text: "DNI 12345678, cliente CLIENTE, 2 motos a S/ 15600 total",
    });

    await handler.handle(context);

    expect(facturaya.lookupCustomer).not.toHaveBeenCalled();
    expect(facturaya.importInvoiceDraft).toHaveBeenCalledWith(expect.objectContaining({
      documentType: "03",
      customerDocumentType: "1",
      customerRuc: "12345678",
      customerName: "CLIENTE",
      taxMode: "included",
      productsText: "2 motos a S/ 15600 total",
    }));
    expect(context.sendButtons).toHaveBeenCalledWith(
      expect.stringContaining("Borrador de boleta creado"),
      expect.arrayContaining([creationButton("boleta")]),
    );
    expect(context.sendButtons).toHaveBeenCalledWith(
      expect.stringContaining("DNI: 12345678"),
      expect.any(Array),
    );

    facturaya.issueInvoice.mockResolvedValue({
      ok: true,
      data: {
        id: "01K37H3CAX3JJRKRV6HK7Z6R4Q",
        number: "B001-00000001",
        status: "accepted",
        document_type: "03",
        sunat: { message: "Aceptada" },
      },
    });
    const issue = makeContext(state, documents, facturaya, ai, {
      interactionId: (await savedCheckpoint(state)).confirmation.buttonId,
      text: "enterprise_issue_invoice",
    });
    await handler.handle(issue);

    expect(facturaya.issueInvoice).toHaveBeenCalledWith(receiptDraft.id);
    expect(issue.reply).toHaveBeenCalledWith("Boleta B001-00000001: aceptada por SUNAT.\nAceptada");
  });

  it("creates an anonymous boleta without asking for DNI below S/ 700", async () => {
    const state = new MemoryState();
    const documents = new MemoryDocuments();
    const facturaya = new FakeFacturaya();
    facturaya.importInvoiceDraft.mockResolvedValue({ ok: true, data: anonymousReceiptDraft });
    const ai = fakeAi(JSON.stringify({
      action: "receipt",
      customer_document: null,
      customer_name: null,
      issue_date: "2026-09-02",
      tax_mode: "included",
      products_text: "1 accesorio a S/ 50",
      invoice_number: null,
      reason_code: null,
      reason_description: null,
    }));
    const handler = new EnterpriseAdvisorRoleHandler();
    await startReceipt(handler, state, documents, facturaya, ai);
    const context = makeContext(state, documents, facturaya, ai, {
      text: "Boleta por 50 soles: 1 accesorio",
    });

    await handler.handle(context);

    expect(facturaya.importInvoiceDraft).toHaveBeenCalledWith(expect.objectContaining({
      documentType: "03",
      customerDocumentType: "0",
      customerRuc: null,
      customerName: null,
      productsText: "1 accesorio a S/ 50",
    }));
    expect(context.sendButtons).toHaveBeenCalledWith(
      expect.stringContaining("Consumidor final"),
      expect.arrayContaining([creationButton("boleta")]),
    );
  });

  it("keeps an optional customer name on an anonymous boleta", async () => {
    const state = new MemoryState();
    const documents = new MemoryDocuments();
    const facturaya = new FakeFacturaya();
    facturaya.importInvoiceDraft.mockResolvedValue({
      ok: true,
      data: {
        ...anonymousReceiptDraft,
        customer: { document_type: "0", ruc: null, name: "Patricia M" },
      },
    });
    const ai = fakeAi(JSON.stringify({
      action: "receipt",
      customer_document: null,
      customer_name: null,
      issue_date: "2026-09-12",
      tax_mode: "included",
      products_text: "Servicio de bordados, 40 unidades, precio total 125 soles",
      products_ready: true,
      missing_product_data: [],
      invoice_number: null,
      reason_code: null,
      reason_description: null,
    }));
    const handler = new EnterpriseAdvisorRoleHandler();
    await startReceipt(handler, state, documents, facturaya, ai);
    const context = makeContext(state, documents, facturaya, ai, {
      text: "Una boleta sin DNI a nombre de Patricia M, concepto de servicio de bordados, 40 unidades, precio total 125 soles",
    });

    await handler.handle(context);

    expect(facturaya.importInvoiceDraft).toHaveBeenCalledWith(expect.objectContaining({
      documentType: "03",
      customerDocumentType: "0",
      customerRuc: null,
      customerName: "Patricia M",
      productsText: "Servicio de bordados, 40 unidades, precio total 125 soles",
    }));
    expect(context.sendButtons).toHaveBeenCalledWith(
      expect.stringMatching(/Cliente: Patricia M[\s\S]*Documento: Sin documento/),
      expect.arrayContaining([creationButton("boleta")]),
    );
  });

  it("does not offer anonymous boleta emission above S/ 700", async () => {
    const state = new MemoryState();
    const documents = new MemoryDocuments();
    const facturaya = new FakeFacturaya();
    facturaya.importInvoiceDraft.mockResolvedValue({
      ok: true,
      data: {
        ...anonymousReceiptDraft,
        totals: { subtotal: 593.22, igv: 106.78, total: 700.01 },
      },
    });
    const ai = fakeAi(JSON.stringify({
      action: "receipt",
      customer_document: null,
      customer_name: null,
      issue_date: "2026-09-02",
      tax_mode: "included",
      products_text: "1 servicio a S/ 700.01",
      invoice_number: null,
      reason_code: null,
      reason_description: null,
    }));
    const handler = new EnterpriseAdvisorRoleHandler();
    await startReceipt(handler, state, documents, facturaya, ai);
    const context = makeContext(state, documents, facturaya, ai, {
      text: "Boleta por 700.01 soles: 1 servicio",
    });

    await handler.handle(context);

    expect(context.sendButtons).toHaveBeenCalledWith(
      expect.stringContaining("supera el límite"),
      expect.not.arrayContaining([creationButton("boleta")]),
    );
  });

  it("keeps the boleta memory when changing only selected data", async () => {
    const state = new MemoryState();
    const documents = new MemoryDocuments();
    const facturaya = new FakeFacturaya();
    facturaya.importInvoiceDraft.mockResolvedValue({ ok: true, data: receiptDraft });
    const complete = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({
        action: "receipt",
        customer_document: "12345678",
        customer_name: "CLIENTE",
        issue_date: "2026-08-23",
        tax_mode: "included",
        products_text: "32 polos con bordados, monto total S/ 1000",
        invoice_number: null,
        reason_code: null,
        reason_description: null,
      }))
      .mockResolvedValueOnce(JSON.stringify({
        action: "receipt",
        customer_document: "40663863",
        customer_name: "Angélica Andrea Pereyra",
        issue_date: null,
        tax_mode: null,
        products_text: null,
        invoice_number: null,
        reason_code: null,
        reason_description: null,
      }));
    const ai: AiProvider = { key: "openai", complete };
    const handler = new EnterpriseAdvisorRoleHandler();

    await handler.handle(makeContext(state, documents, facturaya, ai, { text: "hola" }));
    await handler.handle(makeContext(state, documents, facturaya, ai, {
      interactionId: "enterprise_billing",
      text: "enterprise_billing",
    }));
    await handler.handle(makeContext(state, documents, facturaya, ai, {
      interactionId: "enterprise_receipt",
      text: "enterprise_receipt",
    }));
    await handler.handle(makeContext(state, documents, facturaya, ai, {
      text: "DNI 12345678 CLIENTE, 32 polos con bordados monto total 1000 soles",
    }));

    const change = makeContext(state, documents, facturaya, ai, {
      interactionId: "enterprise_change_invoice",
      text: "enterprise_change_invoice",
    });
    await handler.handle(change);

    expect(change.reply).toHaveBeenCalledWith(expect.stringContaining("Conservo los datos actuales"));

    const update = makeContext(state, documents, facturaya, ai, {
      text: "40663863 Angélica Andrea Pereyra",
    });
    await handler.handle(update);

    expect(facturaya.importInvoiceDraft).toHaveBeenCalledTimes(2);
    expect(facturaya.importInvoiceDraft).toHaveBeenLastCalledWith(expect.objectContaining({
      documentType: "03",
      customerDocumentType: "1",
      customerRuc: "40663863",
      customerName: "Angélica Andrea Pereyra",
      productsText: "32 polos con bordados, monto total S/ 1000",
    }));
    expect(update.sendButtons).toHaveBeenCalledWith(
      expect.stringContaining("Borrador de boleta creado"),
      expect.arrayContaining([
        creationButton("boleta"),
        { id: "enterprise_change_invoice", title: "Cambiar datos" },
      ]),
    );
  });

  it("acknowledges partial data and keeps the RUC across separate messages", async () => {
    const state = new MemoryState();
    const documents = new MemoryDocuments();
    const facturaya = new FakeFacturaya();
    const complete = vi.fn()
        .mockResolvedValueOnce(JSON.stringify({
          action: "invoice",
          customer_ruc: null,
          customer_name: null,
          issue_date: null,
          tax_mode: null,
          products_text: null,
          invoice_number: null,
          reason_code: null,
          reason_description: null,
        }))
        .mockResolvedValueOnce(JSON.stringify({
          action: "invoice",
          customer_ruc: null,
          customer_name: null,
          issue_date: null,
          tax_mode: null,
          products_text: null,
          invoice_number: null,
          reason_code: null,
          reason_description: null,
        }))
        .mockImplementation(async () => null);
    const ai: AiProvider = { key: "openai", complete };
    const handler = new EnterpriseAdvisorRoleHandler();

    await startBilling(handler, state, documents, facturaya, ai);
    const first = makeContext(state, documents, facturaya, ai, { text: "20557288016 RUC" });
    await handler.handle(first);

    expect(facturaya.importInvoiceDraft).not.toHaveBeenCalled();
    expect(first.reply).toHaveBeenCalledWith(
      expect.stringContaining("RUC guardado: 20557288016"),
    );

    const second = makeContext(state, documents, facturaya, ai, { text: "Monto 700" });
    await handler.handle(second);

    expect(second.reply).toHaveBeenCalledWith(
      expect.stringContaining("20557288016"),
    );
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("resolves and shows the legal name as soon as a RUC arrives", async () => {
    const state = new MemoryState();
    const documents = new MemoryDocuments();
    const facturaya = new FakeFacturaya();
    facturaya.lookupCustomer.mockResolvedValue({
      ok: true,
      data: {
        ruc: "20557288016",
        name: "EMPRESA IDENTIFICADA S.A.C.",
        source: "sunat_padron",
        status: "ACTIVO",
        condition: "HABIDO",
      },
    });
    const complete = vi.fn()
      .mockResolvedValueOnce(JSON.stringify({
        action: "invoice",
        customer_ruc: "20557288016",
        customer_name: "RUC",
        issue_date: null,
        tax_mode: null,
        products_text: null,
        invoice_number: null,
        reason_code: null,
        reason_description: null,
      }))
      .mockResolvedValueOnce("Ahora envíame los productos, cantidades y precios.")
      .mockImplementation(async () => null);
    const ai: AiProvider = { key: "openai", complete };
    const handler = new EnterpriseAdvisorRoleHandler();

    await startBilling(handler, state, documents, facturaya, ai);
    const context = makeContext(state, documents, facturaya, ai, { text: "20557288016 RUC" });
    await handler.handle(context);

    expect(facturaya.lookupCustomer).toHaveBeenCalledWith("20557288016");
    expect(context.reply).toHaveBeenCalledWith(expect.stringContaining("EMPRESA IDENTIFICADA S.A.C."));
    expect(context.reply).toHaveBeenCalledWith(expect.stringContaining("20557288016"));
  });

  it("preserves the checkpoint without guessing invoice fields when the AI provider fails", async () => {
    const state = new MemoryState();
    const documents = new MemoryDocuments();
    const facturaya = new FakeFacturaya();
    facturaya.lookupCustomer.mockResolvedValue({
      ok: true,
      data: {
        ruc: "20557288016",
        name: "AGU BELLO E.I.R.L.",
        source: "openruc",
        status: "ACTIVO",
        condition: "HABIDO",
      },
    });
    facturaya.importInvoiceDraft.mockResolvedValue({ ok: true, data: draft });
    const ai: AiProvider = { key: "openai", complete: vi.fn(async () => null) };
    const handler = new EnterpriseAdvisorRoleHandler();

    await startBilling(handler, state, documents, facturaya, ai);
    const before = await savedCheckpoint(state);
    const context = makeContext(state, documents, facturaya, ai, {
      text: "Realizar una factura de 700 soles RUC 20557288016 detalle por concepto de bordados computarizado, 350 bordados",
    });
    await handler.handle(context);

    expect(facturaya.lookupCustomer).not.toHaveBeenCalled();
    expect(facturaya.importInvoiceDraft).not.toHaveBeenCalled();
    expect(context.sendButtons).not.toHaveBeenCalled();
    expect(context.reply).toHaveBeenCalledWith(expect.stringContaining("No pude interpretar este mensaje"));
    expect((await savedCheckpoint(state)).billing).toEqual(before.billing);
  });

  it("resets the enterprise session and removes a pending document", async () => {
    const state = new MemoryState();
    const documents = new MemoryDocuments();
    const facturaya = new FakeFacturaya();
    const handler = new EnterpriseAdvisorRoleHandler();

    await startBilling(handler, state, documents, facturaya, fakeAi("{}"));
    await handler.handle(makeContext(state, documents, facturaya, fakeAi("{}"), {
      inputType: "document",
      text: "",
      documentFilename: "factura.pdf",
      documentMimeType: "application/pdf",
      documentMediaId: "media-reset",
    }, {
      bytes: new Uint8Array([1, 2, 3]),
      filename: "factura.pdf",
      mimeType: "application/pdf",
    }));

    expect(documents.values.size).toBe(1);

    const reset = makeContext(state, documents, facturaya, fakeAi("{}"), { text: "/reiniciar" });
    await handler.handle(reset);

    expect(documents.values.size).toBe(0);
    expect(reset.sendButtons).toHaveBeenCalledWith(
      "Sesión reiniciada. Soy Manolo, ¿en qué puedo ayudarte?", MAIN_MENU_BUTTONS,
    );
  });

  it("keeps an attached document in the session until customer data arrives", async () => {
    const state = new MemoryState();
    const documents = new MemoryDocuments();
    const facturaya = new FakeFacturaya();
    facturaya.importInvoiceDraft.mockResolvedValue({ ok: true, data: draft });
    const ai = fakeAi(JSON.stringify({
      action: "invoice",
      customer_ruc: "20123456789",
      customer_name: "Cliente Demo",
      issue_date: null,
      tax_mode: null,
      products_text: null,
      invoice_number: null,
      reason_code: null,
      reason_description: null,
    }));
    const handler = new EnterpriseAdvisorRoleHandler();

    await startBilling(handler, state, documents, facturaya, ai);
    await handler.handle(makeContext(state, documents, facturaya, ai, {
      inputType: "document",
      text: "",
      documentFilename: "cotizacion.pdf",
      documentMimeType: "application/pdf",
      documentMediaId: "media-1",
    }, {
      bytes: new Uint8Array([1, 2, 3]),
      filename: "cotizacion.pdf",
      mimeType: "application/pdf",
    }));
    expect(facturaya.importInvoiceDraft).not.toHaveBeenCalled();
    expect(documents.values.size).toBe(1);

    await handler.handle(makeContext(state, documents, facturaya, ai, {
      text: "Cliente Demo, RUC 20123456789",
    }));
    expect(facturaya.importInvoiceDraft).toHaveBeenCalledWith(expect.objectContaining({
      document: expect.objectContaining({ filename: "cotizacion.pdf" }),
    }));
    expect(documents.values.size).toBe(0);
  });

  it("displays buttons when user starts conversation with greeting or ambiguous message", async () => {
    const state = new MemoryState();
    const documents = new MemoryDocuments();
    const facturaya = new FakeFacturaya();
    const ai = fakeAi(JSON.stringify({ user_intent: "conversation", reply: "¡Hola! ¿En qué puedo ayudarte?" }));
    ai.decide = vi.fn(async () => ({
      answers: [{ type: "choice" as const, name: "enterprise_intent", choice: "greeting" }],
    }));
    const handler = new EnterpriseAdvisorRoleHandler();

    const context = makeContext(state, documents, facturaya, ai, { text: "hola manolo" });
    await handler.handle(context);

    expect(context.sendButtons).toHaveBeenCalledWith(
      "¡Hola! Soy Manolo. ¿En qué puedo ayudarte hoy?", MAIN_MENU_BUTTONS,
    );
  });

  it("routes a draft query to authenticated data when Decisions chooses drafts", async () => {
    const state = new MemoryState();
    const documents = new MemoryDocuments();
    const facturaya = new FakeFacturaya();
    facturaya.listInvoiceDrafts.mockResolvedValue({ ok: true, data: [] });
    const ai = fakeAi(JSON.stringify({ user_intent: "conversation", reply: "Tus facturas de la última semana son..." }));
    ai.decide = vi.fn(async () => ({
      answers: [{ type: "choice" as const, name: "enterprise_intent", choice: "drafts" }],
    }));
    const handler = new EnterpriseAdvisorRoleHandler();

    const context = makeContext(state, documents, facturaya, ai, {
      text: "Me puedes mostrar los borradores",
    });
    context.generateAiReplyWithHistory = vi.fn(async () => "Para revisar tus facturas de la última semana puedes ingresar a tu panel de FacturaYa.");
    await handler.handle(context);

    expect(facturaya.listInvoiceDrafts).toHaveBeenCalledWith(1);
    expect(context.reply).toHaveBeenCalledWith(expect.stringContaining("No hay borradores pendientes"));
    expect(context.generateAiReplyWithHistory).not.toHaveBeenCalled();
  });

  it("answers within the billing session without Decisions or reopening the menu", async () => {
    const state = new MemoryState();
    const documents = new MemoryDocuments();
    const facturaya = new FakeFacturaya();
    const ai = fakeAi(JSON.stringify({ user_intent: "conversation", reply: "¡Hola! ¿Cómo estás?" }));
    ai.decide = vi.fn(async () => ({
      answers: [{ type: "choice" as const, name: "enterprise_intent", choice: "greeting" }],
    }));
    const handler = new EnterpriseAdvisorRoleHandler();

    await startBilling(handler, state, documents, facturaya, ai);

    const greetingContext = makeContext(state, documents, facturaya, ai, { text: "hola" });
    vi.mocked(ai.decide!).mockClear();
    await handler.handle(greetingContext);

    expect(greetingContext.reply).not.toHaveBeenCalledWith("¡Hola! ¿Cómo estás?");
    expect(greetingContext.reply).toHaveBeenCalledWith(expect.stringContaining("Me falta"));
    expect(greetingContext.sendButtons).not.toHaveBeenCalled();
    expect(ai.decide).not.toHaveBeenCalled();
  });
});
