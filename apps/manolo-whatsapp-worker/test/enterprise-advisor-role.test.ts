import { describe, expect, it, vi } from "vitest";
import type { AiProvider } from "../src/ai/contracts";
import type { IncomingDocument, DocumentStore } from "../src/documents/contracts";
import type {
  FacturayaClient,
  FacturayaInvoiceDraft,
} from "../src/facturaya/contracts";
import { EnterpriseAdvisorRoleHandler } from "../src/roles/enterprise-advisor-role";
import type { RoleHandlerContext } from "../src/roles/contracts";
import type { RoleStateRepository } from "../src/roles/state";

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
    finance: null,
    businessData: null,
    quoteNumberAllocator: null,
    roleState: state,
    facturaya,
    document,
    documentStore: documents,
    history: [],
    reply: vi.fn(async () => undefined),
    sendButtons: vi.fn(async () => ({ status: "sent" as const, metaMessageId: "wamid.reply" })),
    sendList: vi.fn(async () => ({ status: "sent" as const, metaMessageId: "wamid.reply" })),
    sendDocument: vi.fn(async () => ({ status: "sent" as const, metaMessageId: "wamid.document" })),
    generateAiReply: vi.fn(async () => null),
    generateAiReplyWithHistory: vi.fn(async () => null),
    fallbackReply: "fallback",
    log: vi.fn(),
  };
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
  it("starts a 20-minute session with finance and billing buttons", async () => {
    const state = new MemoryState();
    const context = makeContext(state, new MemoryDocuments(), new FakeFacturaya(), fakeAi("{}"), { text: "hola" });

    await new EnterpriseAdvisorRoleHandler().handle(context);

    expect(context.sendButtons).toHaveBeenCalledWith(
      "¿Qué deseas hacer hoy?",
      [
        { id: "enterprise_finance", title: "Finanzas" },
        { id: "enterprise_billing", title: "Facturación" },
      ],
    );
  });

  it("activates the finance mode without consulting FacturaYa", async () => {
    const state = new MemoryState();
    const documents = new MemoryDocuments();
    const facturaya = new FakeFacturaya();
    const ai = fakeAi("{}");
    const handler = new EnterpriseAdvisorRoleHandler();
    await handler.handle(makeContext(state, documents, facturaya, ai, { text: "hola" }));
    const context = makeContext(state, documents, facturaya, ai, {
      interactionId: "enterprise_finance",
      text: "enterprise_finance",
    });

    await handler.handle(context);

    expect(context.reply).toHaveBeenCalledWith(
      "Finanzas activadas. Puedes registrar entradas, salidas o consultar tu balance durante los próximos 20 minutos.",
    );
    expect(facturaya.resolveTenantAccess).not.toHaveBeenCalled();
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
      "¿Qué comprobante deseas crear?",
      [
        { id: "enterprise_invoice", title: "Factura" },
        { id: "enterprise_receipt", title: "Boleta" },
      ],
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
      interactionId: "enterprise_billing",
      text: "enterprise_billing",
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
      expect.arrayContaining([{ id: "enterprise_issue_invoice", title: "Emitir factura" }]),
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
      expect.arrayContaining([{ id: "enterprise_issue_invoice", title: "Emitir boleta" }]),
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
      interactionId: "enterprise_issue_invoice",
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
      expect.arrayContaining([{ id: "enterprise_issue_invoice", title: "Emitir boleta" }]),
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
      expect.arrayContaining([{ id: "enterprise_issue_invoice", title: "Emitir boleta" }]),
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
      expect.not.arrayContaining([{ id: "enterprise_issue_invoice", title: "Emitir boleta" }]),
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
        { id: "enterprise_issue_invoice", title: "Emitir boleta" },
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
        .mockResolvedValueOnce("Ya registré el RUC. Ahora necesito el nombre del cliente y el detalle de los productos o servicios.")
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
        .mockResolvedValueOnce("El RUC sigue guardado. También necesito el nombre del cliente y el concepto del monto.")
        .mockImplementation(async () => null);
    const ai: AiProvider = { key: "openai", complete };
    const handler = new EnterpriseAdvisorRoleHandler();

    await startBilling(handler, state, documents, facturaya, ai);
    const first = makeContext(state, documents, facturaya, ai, { text: "20557288016 RUC" });
    await handler.handle(first);

    expect(facturaya.importInvoiceDraft).not.toHaveBeenCalled();
    expect(first.reply).toHaveBeenCalledWith(
      "Ya registré el RUC. Ahora necesito el nombre del cliente y el detalle de los productos o servicios.",
    );

    const second = makeContext(state, documents, facturaya, ai, { text: "Monto 700" });
    await handler.handle(second);

    expect(second.reply).toHaveBeenCalledWith(
      "El RUC sigue guardado. También necesito el nombre del cliente y el concepto del monto.",
    );
    const guidanceRequest = complete.mock.calls[3]?.[0];
    expect(guidanceRequest?.messages[0]?.content).toEqual(expect.stringContaining("20557288016"));
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

  it("preserves explicit invoice details when the AI provider fails", async () => {
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
    const context = makeContext(state, documents, facturaya, ai, {
      text: "Realizar una factura de 700 soles RUC 20557288016 detalle por concepto de bordados computarizado, 350 bordados",
    });
    await handler.handle(context);

    expect(facturaya.lookupCustomer).toHaveBeenCalledWith("20557288016");
    expect(facturaya.importInvoiceDraft).toHaveBeenCalledWith(expect.objectContaining({
      customerRuc: "20557288016",
      customerName: "AGU BELLO E.I.R.L.",
      productsText: expect.stringMatching(/700[\s\S]*bordados[\s\S]*350/iu),
    }));
    expect(context.sendButtons).toHaveBeenCalledWith(
      expect.stringContaining("Borrador de factura creado"),
      expect.any(Array),
    );
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
      "Sesión reiniciada. ¿Qué deseas hacer ahora?",
      [
        { id: "enterprise_finance", title: "Finanzas" },
        { id: "enterprise_billing", title: "Facturación" },
      ],
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
});
