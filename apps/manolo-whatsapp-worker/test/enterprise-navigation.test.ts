import { describe, expect, it, vi } from "vitest";
import type { AiProvider } from "../src/ai/contracts";
import type { FacturayaClient, FacturayaInvoiceDraft, FacturayaTenant } from "../src/facturaya/contracts";
import type { RoleHandlerContext } from "../src/roles/contracts";
import type { RoleStateRepository } from "../src/roles/state";
import { EnterpriseAdvisorRoleHandler } from "../src/roles/enterprise-advisor-role";

class States implements RoleStateRepository {
  rows = new Map<string, string>();
  key(tenant: string, contact: number, role: string) { return `${tenant}:${contact}:${role}`; }
  async get(tenant: string, contact: number, role: string) { return this.rows.get(this.key(tenant, contact, role)) ?? null; }
  async set(tenant: string, contact: number, role: string, value: string) { this.rows.set(this.key(tenant, contact, role), value); return true; }
  async clear(tenant: string, contact: number, role: string) { this.rows.delete(this.key(tenant, contact, role)); return true; }
  async compareAndSet(tenant: string, contact: number, role: string, old: string | null, value: string | null) {
    if (await this.get(tenant, contact, role) !== old) return false;
    return value === null ? this.clear(tenant, contact, role) : this.set(tenant, contact, role, value);
  }
}
const company: FacturayaTenant = { id: "company", name: "Empresa Prueba", legalName: "Empresa Prueba SAC", ruc: "20123456789",
  environment: "beta", address: null, permissions: ["view_invoice", "create_invoice", "issue_invoice", "create_credit_note"] };
const draft: FacturayaInvoiceDraft = { id: "01k37h3cax3jjrkrv6hk7z6r4p", status: "review_required", document_type: "01",
  issue_date: "2026-11-06", customer: { document_type: "6", ruc: "20999999999", name: "Cliente Prueba" },
  currency: "PEN", tax_mode: "included", payment_method: "contado", outstanding_amount: null, installments: [],
  items: [{ description: "Servicio de bordados", quantity: 1, unit_price: 118, line_total: 118 }], totals: { total: 118, subtotal: 100, igv: 18 } };
const accepted = { id: "01k37h3cax3jjrkrv6hk7z6r4q", number: "F001-123", status: "accepted", document_type: "01", environment: "beta",
  files: { pdf: "https://factura.example/api/invoices/one/files/pdf" } };
const mainButtons = [
  { id: "enterprise_invoice", title: "Generar Factura" }, { id: "enterprise_receipt", title: "Generar Boleta" },
  { id: "enterprise_other_options", title: "Otras opciones" },
];
function ready(phase = "review") {
  return { mode: "billing", billingDocumentKind: "invoice", phase, revision: 2, issuedNumber: phase === "issued" ? "F001-OLD" : undefined,
    billing: { customerRuc: "20999999999", customerName: "Cliente Prueba", issueDate: "2026-11-06", taxMode: "included",
      productsText: "1 servicio de bordados a S/118", productsReady: true, missingProductFields: [],
      paymentMethod: "contado", outstandingAmount: null, installments: [], draftId: draft.id },
    draft, confirmation: phase === "review" ? { buttonId: "enterprise_issue_invoice:ready", draftId: draft.id, revision: 2 } : undefined };
}
function fixture(initial?: Record<string, unknown>) {
  const states = new States();
  if (initial) states.rows.set(states.key("navigation", 1, "enterprise-advisor"), JSON.stringify({
    version: 2, startedAt: Date.now(), expiresAt: Date.now() + 86400000, revision: 0, mode: null,
    phase: "collecting", facturayaTenantId: company.id, billingDocumentKind: null, ...initial,
  }));
  const events: string[] = [];
  const ai = { key: "test", complete: vi.fn<AiProvider["complete"]>(async () => { events.push("extract"); return "{}"; }),
    decide: vi.fn<NonNullable<AiProvider["decide"]>>(async () => { events.push("decide"); return null; }) };
  const client = {
    resolveTenantAccess: vi.fn<FacturayaClient["resolveTenantAccess"]>(async () => ({ status: "authorized", tenant: company, tenants: [] })),
    selectTenant: vi.fn<FacturayaClient["selectTenant"]>(async () => ({ status: "authorized", tenant: company, tenants: [] })), clearTenant: vi.fn(async () => true),
    lookupCustomer: vi.fn<FacturayaClient["lookupCustomer"]>(async () => ({ ok: false, reason: "not_found" })),
    lookupCustomerByDni: vi.fn<FacturayaClient["lookupCustomerByDni"]>(async () => ({ ok: false, reason: "not_found" })),
    importInvoiceDraft: vi.fn<FacturayaClient["importInvoiceDraft"]>(async () => ({ ok: true, data: draft })),
    issueInvoice: vi.fn<FacturayaClient["issueInvoice"]>(async () => ({ ok: true, data: accepted })),
    listInvoiceDrafts: vi.fn<FacturayaClient["listInvoiceDrafts"]>(async () => ({ ok: true, data: [] })),
    createCreditNote: vi.fn<FacturayaClient["createCreditNote"]>(async () => ({ ok: true, data: { id: "credit-one", number: "FC01-123", status: "accepted" } })),
    downloadFile: vi.fn<FacturayaClient["downloadFile"]>(async () => ({ ok: true, data: { bytes: new Uint8Array([1]), filename: "factura.pdf", mimeType: "application/pdf" } })),
    despatch: { create: vi.fn(), get: vi.fn(), issue: vi.fn(), refresh: vi.fn() },
  } satisfies FacturayaClient;
  const handler = new EnterpriseAdvisorRoleHandler();
  const context = (text: string, interactionId: string | null = null, contactId = 1): RoleHandlerContext => ({
    message: { id: crypto.randomUUID(), text, interactionId, phoneNumberId: "phone", to: "51999999999", inputType: "text" },
    tenant: { tenantId: "navigation", phoneNumberId: "phone", roleKey: "enterprise-advisor", systemPrompt: "", aiModel: "gpt-6-luna", aiProvider: "openai", temperature: 0, maxTokens: 1800 },
    persisted: { contactId, conversationId: "conversation", duplicate: false }, env: {} as Env, ai, facturaya: client,
    roleState: states, businessData: null, quoteNumberAllocator: null, history: [],
    reply: vi.fn(async () => { events.push("reply"); }),
    sendText: vi.fn(async () => { events.push("text"); return { status: "sent" as const, metaMessageId: "text" }; }),
    sendButtons: vi.fn<NonNullable<RoleHandlerContext["sendButtons"]>>(async (_body, buttons) => { events.push(buttons.some((item) => item.id.startsWith("enterprise_next_yes:")) ? "follow-up" : "buttons");
      return { status: "sent" as const, metaMessageId: "buttons" }; }),
    sendList: vi.fn(async () => ({ status: "sent" as const, metaMessageId: "list" })),
    sendDocument: vi.fn(async () => { events.push("pdf"); return { status: "sent" as const, metaMessageId: "pdf" }; }),
    generateAiReply: vi.fn(async () => null), generateAiReplyWithHistory: vi.fn(async () => null), fallbackReply: "", log: vi.fn(),
  });
  const saved = async (contact = 1) => JSON.parse((await states.get("navigation", contact, "enterprise-advisor"))!);
  const turn = async (text: string, button: string | null = null) => { const ctx = context(text, button); await handler.handle(ctx); return ctx; };
  return { states, ai, client, handler, context, saved, turn, events };
}

describe("enterprise intent-first navigation", () => {
  function interpreted(fields: Record<string, unknown>) {
    return JSON.stringify({ interpretation_version: 1, user_intent: "billing_update", products_changed: false, source_evidence: {}, ...fields });
  }
  it.each(["El pago será al crédito en una sola cuota el 06/12/26", "Todo junto el seis de diciembre del veintiséis"])("uses Luna's normalized date without reparsing the wording: %s", async text => {
    const p = fixture(awaitingCredit());
    p.ai.complete.mockResolvedValue(interpreted({ single_payment: true,
      installments: [{ due_date: "2026-12-06", amount: null }], source_evidence: { single_payment: text, due_date: text } }));
    p.client.importInvoiceDraft.mockResolvedValueOnce({ ok: true, data: draft }).mockResolvedValueOnce({ ok: true, data: singleCredit() });
    await p.turn(text);
    expect((await p.saved()).billing.singlePayment.dueDate).toBe("2026-12-06");
    expect((await p.saved()).billing.paymentError).toBeUndefined();
    expect((await p.saved()).billing.paymentUpdate.fields.dueDate).toBe("accepted");
    expect(p.client.importInvoiceDraft).toHaveBeenCalledTimes(2);
    expect(p.client.issueInvoice).not.toHaveBeenCalled();
  });
  it("recovers the date Luna interprets from an earlier user message in this session", async () => {
    const p = fixture(awaitingCredit());
    p.ai.complete.mockResolvedValue(interpreted({ user_intent: "review", single_payment: true, installments: [{ due_date: "2026-12-06", amount: null }],
      source_evidence: { single_payment: "una sola cuota", due_date: "06/12/26" } }));
    p.client.importInvoiceDraft.mockResolvedValueOnce({ ok: true, data: draft }).mockResolvedValueOnce({ ok: true, data: singleCredit() });
    const ctx = p.context("Revisa el mensaje anterior y prepara el borrador");
    ctx.history = [{ role: "user", content: "una sola cuota el 06/12/26", createdAt: new Date().toISOString() }];
    await p.handler.handle(ctx);
    expect((await p.saved()).billing.singlePayment.dueDate).toBe("2026-12-06");
    expect(p.client.issueInvoice).not.toHaveBeenCalled();
  });
  it("uses a model-interpreted amount written entirely in words", async () => {
    const initial = awaitingCredit();
    const p = fixture({ ...initial, billing: { ...initial.billing, singlePayment: { dueDate: "2026-12-06" } } });
    p.ai.complete.mockResolvedValue(interpreted({ outstanding_amount: "12630.00",
      source_evidence: { outstanding_amount: "doce mil seiscientos treinta soles" } }));
    p.client.importInvoiceDraft.mockResolvedValue({ ok: true, data: singleCredit(12630) });
    await p.turn("Serían doce mil seiscientos treinta soles");
    expect((await p.saved()).billing.outstandingAmount).toBe("12630.00");
    expect((await p.saved()).billing.paymentError).toBeUndefined();
  });
  it("retains calendar and positive-amount validation after semantic interpretation", async () => {
    const p = fixture(awaitingCredit());
    p.ai.complete.mockResolvedValue(interpreted({ single_payment: true,
      outstanding_amount: "-10.00", installments: [{ due_date: "2026-02-30", amount: null }],
      source_evidence: { single_payment: "un pago", due_date: "treinta de febrero", outstanding_amount: "menos diez" } }));
    await p.turn("un pago de menos diez, el treinta de febrero");
    expect((await p.saved()).billing.outstandingAmount).toBeNull();
    expect((await p.saved()).billing.paymentError).toBeTruthy();
    expect(p.client.importInvoiceDraft).not.toHaveBeenCalled();
    expect(p.client.issueInvoice).not.toHaveBeenCalled();
  });
  it("persists Luna's specific question and resolves its answer without requiring the original date again", async () => {
    const p = fixture(awaitingCredit());
    p.ai.complete.mockResolvedValue(interpreted({ single_payment: true, source_evidence: { single_payment: "un pago" },
      payment_clarification: { field: "dueDate", question: "¿El pago sería el 6 de diciembre de 2026 o de 2027?" } }));
    const question = await p.turn("un pago el seis de diciembre");
    expect(question.reply).toHaveBeenCalledWith(expect.stringContaining("2026 o de 2027"));
    p.ai.complete.mockResolvedValue(interpreted({ user_intent: "conversation" }));
    await p.turn("Un momento");
    expect((await p.saved()).billing.paymentUpdate.question).toContain("2026 o de 2027");
    p.ai.complete.mockResolvedValue(interpreted({ installments: [{ due_date: "2026-12-06", amount: null }], source_evidence: { due_date: "este año" } }));
    p.client.importInvoiceDraft.mockResolvedValueOnce({ ok: true, data: draft }).mockResolvedValueOnce({ ok: true, data: singleCredit() });
    await p.turn("De este año");
    expect((await p.saved()).billing.singlePayment.dueDate).toBe("2026-12-06");
    expect((await p.saved()).billing.paymentUpdate.question).toBeUndefined();
    expect((await p.saved()).billing.paymentError).toBeUndefined();
  });
  it("rejects unsupported dates and assistant-only evidence without inventing a user statement", async () => {
    const p = fixture({ ...awaitingCredit(), billing: { ...awaitingCredit().billing, singlePayment: { dueDate: null } } });
    p.ai.complete.mockResolvedValue(interpreted({ installments: [{ due_date: "2026-12-06", amount: null }], source_evidence: { due_date: "06/12/26" } }));
    const ctx = p.context("Continúa"); ctx.history = [{ role: "assistant", content: "06/12/26" }]; await p.handler.handle(ctx);
    expect((await p.saved()).billing.singlePayment.dueDate).toBeNull();
    expect(p.client.importInvoiceDraft).not.toHaveBeenCalled();
  });
  it("does not let the legacy fallback turn an order number in an image into a customer RUC", async () => {
    const p = fixture({ mode: "billing", billingDocumentKind: "invoice" });
    p.ai.complete.mockResolvedValue(interpreted({ customer_document: null, customer_name: null, products_changed: true,
      products_text: "4 chalecos, total 118 soles", products_ready: true, payment_method: "contado", source_evidence: { payment_method: "al contado" } }));
    const ctx = p.context("Orden 00000000138, 4 chalecos, total 118 soles, al contado"); ctx.message.hasVisualContext = true; ctx.message.inputType = "image";
    await p.handler.handle(ctx);
    expect((await p.saved()).billing.customerRuc).toBe("");
    expect(p.client.lookupCustomer).not.toHaveBeenCalled();
    expect((await p.saved()).billing.productsText).toContain("chalecos");
  });
  it.each(["12,630 soles", "12630,00 soles", "S/ 12,630.00"])("persists %s through a complaint and review without trusting an AI acknowledgement", async text => {
    const initial = awaitingCredit();
    const p = fixture({ ...initial, draft: undefined, confirmation: undefined,
      billing: { ...initial.billing, draftId: undefined, singlePayment: { dueDate: "2026-12-06" } } });
    p.ai.complete.mockResolvedValue(JSON.stringify({ user_intent: "conversation", reply: "Ya tengo 999999 soles." }));
    p.client.importInvoiceDraft.mockResolvedValue({ ok: true, data: singleCredit(12630) });
    const update = await p.turn(text);
    expect((await p.saved()).billing.outstandingAmount).toBe("12630.00");
    expect((await p.saved()).billing.paymentUpdate.fields.outstandingAmount).toBe("accepted");
    expect((await p.saved()).billing.paymentUpdate.sourceMessageId).toBe(update.message.id);
    expect((await p.saved()).billing.installments).toEqual([{ due_date: "2026-12-06", amount: "12630.00" }]);
    const complaint = await p.turn("Sigues preguntando lo mismo, ya lo tienes");
    expect(complaint.reply).toHaveBeenCalledWith(expect.stringContaining("12630.00"));
    expect(complaint.reply).not.toHaveBeenCalledWith(expect.stringContaining("999999"));
    p.ai.complete.mockResolvedValue(JSON.stringify({ user_intent: "review", products_changed: false }));
    const review = await p.turn("Resumen");
    expect(review.sendButtons).toHaveBeenCalledWith(expect.stringContaining("12630.00"), expect.any(Array));
    expect((await p.saved()).billing.customerRuc).toBe(initial.billing.customerRuc);
    expect((await p.saved()).billing.productsText).toBeTruthy();
    expect(p.client.issueInvoice).not.toHaveBeenCalled();
  });
  it("rejects an ambiguous change without erasing the previous amount or falsely confirming it", async () => {
    const initial = awaitingCredit();
    const p = fixture({ ...initial, billing: { ...initial.billing, outstandingAmount: "118.00", paymentError: undefined,
      installments: [{ due_date: "2026-12-06", amount: "118.00" }], singlePayment: { dueDate: "2026-12-06" } } });
    p.ai.complete.mockResolvedValue(JSON.stringify({ user_intent: "conversation", reply: "Ya guardé 12.630." }));
    const turn = await p.turn("12.630 soles");
    expect((await p.saved()).billing.outstandingAmount).toBe("118.00");
    expect((await p.saved()).billing.paymentUpdate.fields.outstandingAmount).toBe("rejected");
    expect((await p.saved()).billing.paymentError).toBeTruthy();
    expect(turn.reply).toHaveBeenCalledWith(expect.stringContaining("No pude registrar el importe"));
    expect(turn.reply).not.toHaveBeenCalledWith(expect.stringContaining("Datos guardados"));
    expect(p.client.importInvoiceDraft).not.toHaveBeenCalled();
    const complaint = await p.turn("Ya lo tienes");
    expect(complaint.reply).toHaveBeenCalledWith(expect.stringContaining("No pude registrar el importe"));
  });
  it("normalizes numeric model fields and grouped amounts in a full payment instruction", async () => {
    const p = fixture(awaitingCredit());
    p.ai.complete.mockResolvedValue(JSON.stringify({ user_intent: "billing_update", products_changed: false,
      outstanding_amount: 12630, installments: [{ due_date: "2026-12-06", amount: 12630 }] }));
    p.client.importInvoiceDraft.mockResolvedValue({ ok: true, data: singleCredit(12630) });
    await p.turn("Una sola cuota por 12,630 soles para el 06/12/2026");
    expect((await p.saved()).billing.outstandingAmount).toBe("12630.00");
    expect((await p.saved()).billing.paymentError).toBeUndefined();
    expect(p.client.importInvoiceDraft).toHaveBeenLastCalledWith(expect.objectContaining({ outstandingAmount: "12630.00" }));
  });
  it("never confirms a fabricated value when an update proposes no actual changes", async () => {
    const p = fixture(ready());
    p.ai.complete.mockResolvedValue(JSON.stringify({ user_intent: "billing_update", products_changed: false, reply: "Ya guardé 999999 soles." }));
    const turn = await p.turn("Ya lo tienes");
    expect(turn.reply).toHaveBeenCalledWith(expect.stringContaining("Los datos están completos"));
    expect(turn.reply).not.toHaveBeenCalledWith(expect.stringContaining("999999"));
    expect(p.client.issueInvoice).not.toHaveBeenCalled();
  });
  it("keeps a validated balance when a later model response repeats a different historical product price", async () => {
    const initial = awaitingCredit();
    const p = fixture({ ...initial, billing: { ...initial.billing, outstandingAmount: "100.00", paymentError: undefined,
      paymentSourceText: "Precio del producto 118.00. Saldo después del anticipo:100.00.",
      installments: [{ due_date: "2026-12-06", amount: "100.00" }], singlePayment: { dueDate: "2026-12-06" } } });
    p.ai.complete.mockResolvedValue(JSON.stringify({ user_intent: "billing_update", products_changed: false,
      outstanding_amount: "118.00", installments: [{ due_date: "2026-12-06", amount: "118.00" }] }));
    await p.turn("Conserva el pago único");
    expect((await p.saved()).billing.outstandingAmount).toBe("100.00");
    expect((await p.saved()).billing.installments[0].amount).toBe("100.00");
    expect((await p.saved()).billing.paymentUpdate.fields.outstandingAmount).toBe("retained");
  });
  it("stores this year's due date even when the model omits its normalized date", async () => {
    const p = fixture(awaitingCredit());
    p.ai.complete.mockResolvedValue(JSON.stringify({ user_intent: "billing_update", payment_method: "credito", products_changed: false }));
    p.client.importInvoiceDraft.mockResolvedValue({ ok: false, reason: "network_error" });
    await p.turn("A crédito de 1 sola cuota a pagar el 6 de diciembre de este año");
    const year = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric" }).format(new Date());
    expect((await p.saved()).billing.singlePayment.dueDate).toBe(`${year}-12-06`);
    expect((await p.saved()).billing.paymentError).toBeUndefined();
    expect(p.client.issueInvoice).not.toHaveBeenCalled();
  });
  it.each(["06/12/2026", "Fecha de emisión 05/11/2026", "Pago único a la entrega del bien"])("retains a known due date through %s", async (text) => {
    const initial = awaitingCredit();
    const p = fixture({ ...initial, billing: { ...initial.billing, singlePayment: { dueDate: "2026-12-06" } } });
    p.ai.complete.mockResolvedValue(JSON.stringify({ user_intent: "billing_update", products_changed: false, payment_method: "credito" }));
    p.client.importInvoiceDraft.mockResolvedValue({ ok: false, reason: "network_error" });
    await p.turn(text);
    expect((await p.saved()).billing.singlePayment.dueDate).toBe("2026-12-06");
    expect((await p.saved()).billing.paymentError).toBeUndefined();
  });
  it.each(["invoice", "receipt"])("continues an active %s from an image without Decisions or a start menu", async (kind) => {
    const p = fixture({ mode: "billing", billingDocumentKind: kind });
    p.ai.decide.mockRejectedValue(new Error("Must not route an active task"));
    p.ai.complete.mockResolvedValue(JSON.stringify({ user_intent: "billing_update", products_changed: true,
      products_text: "2 chalecos bordados a S/50", products_ready: true }));
    const ctx = p.context("2 chalecos bordados a S/50");
    ctx.message.inputType = "image";
    ctx.message.hasVisualContext = true;
    await p.handler.handle(ctx);
    expect(p.ai.decide).not.toHaveBeenCalled();
    expect(p.ai.complete).toHaveBeenCalled();
    expect((await p.saved()).billing.productsText).toContain("chalecos");
    expect(ctx.sendButtons).not.toHaveBeenCalledWith(expect.any(String), mainButtons);
    expect(p.client.issueInvoice).not.toHaveBeenCalled();
  });
  it.each(["billing", "credit_note", "despatch"])("bypasses Decisions for data in active %s", async (mode) => {
    const p = fixture({ mode, billingDocumentKind: mode === "billing" ? "invoice" : null });
    p.ai.decide.mockResolvedValue({ answers: [{ type: "choice", name: "enterprise_intent", choice: "greeting" }] });
    const ctx = await p.turn("Este es el dato que me pediste");
    expect(p.ai.decide).not.toHaveBeenCalled();
    expect((await p.saved()).mode).toBe(mode);
    expect(ctx.sendButtons).not.toHaveBeenCalledWith(expect.any(String), mainButtons);
  });
  it("keeps an active conversation response brief without reopening the main menu", async () => {
    const p = fixture(ready());
    p.ai.complete.mockResolvedValue(JSON.stringify({ user_intent: "conversation", reply: "Aquí estoy. Puedes continuar con tu factura." }));
    const ctx = await p.turn("Hola");
    expect(p.ai.decide).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Los datos están completos"));
    expect(ctx.sendButtons).not.toHaveBeenCalled();
  });
  function awaitingCredit() {
    const value = ready("collecting");
    return { ...value, billing: { ...value.billing, paymentMethod: "credito", issueDate: "2026-11-05",
      outstandingAmount: null, installments: [], paymentError: "cada cuota con importe explícito y fecha completa (día, mes y año), máximo 12 cuotas" } };
  }
  function singleCredit(total = 118, balance = `${total}.00`) {
    return { ...draft, issue_date: "2026-11-05", payment_method: "credito" as const, outstanding_amount: balance,
      installments: [{ due_date: "2026-12-06", amount: balance }], totals: { total, subtotal: 100, igv: 18 } };
  }
  it("prepares one payment for the canonical total and preserves yesterday as the issue date", async () => {
    const p = fixture(awaitingCredit());
    p.ai.complete.mockResolvedValue(JSON.stringify({ user_intent: "billing_update", issue_date: "2026-12-06", products_changed: false,
      installments: [{ due_date: "2026-12-06", amount: null }] }));
    p.client.importInvoiceDraft.mockResolvedValueOnce({ ok: true, data: { ...draft, issue_date: "2026-11-05" } })
      .mockResolvedValueOnce({ ok: true, data: singleCredit() });
    const ctx = await p.turn("Una sola cuota, fecha de pago el 06 de diciembre del 2026");
    expect(p.client.importInvoiceDraft).toHaveBeenNthCalledWith(1, expect.objectContaining({ issueDate: "2026-11-05", paymentMethod: "contado" }));
    expect(p.client.importInvoiceDraft).toHaveBeenNthCalledWith(2, expect.objectContaining({ issueDate: "2026-11-05", paymentMethod: "credito",
      outstandingAmount: "118.00", installments: [{ due_date: "2026-12-06", amount: "118.00" }] }));
    expect((await p.saved()).billing).toMatchObject({ issueDate: "2026-11-05", singlePayment: { dueDate: "2026-12-06", totalBased: true } });
    expect(ctx.sendButtons).toHaveBeenCalledWith(expect.stringContaining("2026-12-06"), expect.any(Array));
    expect(p.client.issueInvoice).not.toHaveBeenCalled();
  });
  it("keeps a known balance after an advance when consolidating into one payment", async () => {
    const initial = awaitingCredit();
    const p = fixture({ ...initial, billing: { ...initial.billing, outstandingAmount: "100.00", paymentSourceText: "saldo 100.00, anticipo 18.00" } });
    p.ai.complete.mockResolvedValue(JSON.stringify({ user_intent: "billing_update", products_changed: false, installments: [{ due_date: "2026-12-06", amount: null }] }));
    p.client.importInvoiceDraft.mockResolvedValue({ ok: true, data: singleCredit(118, "100.00") });
    await p.turn("Una sola cuota, fecha de pago el 06/12/2026");
    expect(p.client.importInvoiceDraft).toHaveBeenCalledOnce();
    expect(p.client.importInvoiceDraft).toHaveBeenCalledWith(expect.objectContaining({ outstandingAmount: "100.00",
      installments: [{ due_date: "2026-12-06", amount: "100.00" }] }));
  });
  it("retains a complete due date through a pricing failure and never enables fiscal creation", async () => {
    const p = fixture(awaitingCredit());
    p.ai.complete.mockResolvedValue(JSON.stringify({ user_intent: "billing_update", products_changed: false,
      installments: [{ due_date: "2026-12-06", amount: null }] }));
    p.client.importInvoiceDraft.mockResolvedValue({ ok: false, reason: "network_error" });
    const ctx = await p.turn("Una sola cuota para el 06 de diciembre del 2026");
    expect((await p.saved()).billing.singlePayment.dueDate).toBe("2026-12-06");
    expect((await p.saved()).confirmation).toBeUndefined();
    expect(ctx.sendButtons).not.toHaveBeenCalled();
    expect(p.client.issueInvoice).not.toHaveBeenCalled();
  });
  it("does not fill the year of a single payment from the model or reuse an older date", async () => {
    const initial = awaitingCredit();
    const p = fixture({ ...initial, billing: { ...initial.billing, singlePayment: { dueDate: "2026-12-06" } } });
    p.ai.complete.mockResolvedValue(JSON.stringify({ user_intent: "billing_update", products_changed: false,
      installments: [{ due_date: "2027-12-05", amount: null }] }));
    const ctx = await p.turn("Cambia la única cuota al 05 de diciembre");
    expect((await p.saved()).billing.singlePayment.dueDate).toBeNull();
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("fecha completa"));
    expect(p.client.importInvoiceDraft).not.toHaveBeenCalled();
  });
  it("reprices a total-based single payment after a change of products", async () => {
    const initial = awaitingCredit();
    const p = fixture({ ...initial, billing: { ...initial.billing, outstandingAmount: "118.00", installments: [{ due_date: "2026-12-06", amount: "118.00" }],
      paymentError: undefined, singlePayment: { dueDate: "2026-12-06", totalBased: true } } });
    p.ai.complete.mockResolvedValue(JSON.stringify({ user_intent: "billing_update", products_changed: true, products_text: "2 servicios de bordado a S/118, total S/236", products_ready: true }));
    p.client.importInvoiceDraft.mockResolvedValueOnce({ ok: true, data: { ...draft, totals: { total: 236 } } })
      .mockResolvedValueOnce({ ok: true, data: singleCredit(236) });
    await p.turn("Corrige los productos: 2 servicios de bordado a S/118, total S/236");
    expect(p.client.importInvoiceDraft).toHaveBeenLastCalledWith(expect.objectContaining({ outstandingAmount: "236.00",
      installments: [{ due_date: "2026-12-06", amount: "236.00" }] }));
    expect(p.client.issueInvoice).not.toHaveBeenCalled();
  });
  it("recovers the complete due date already received instead of asking it again", async () => {
    const initial = awaitingCredit();
    const p = fixture({ ...initial, billing: { ...initial.billing,
      paymentSourceText: "Una sola cuota, fecha de pago el 06 de diciembre del 2026" } });
    p.ai.complete.mockResolvedValue(JSON.stringify({ user_intent: "conversation", products_changed: false }));
    p.client.importInvoiceDraft.mockResolvedValueOnce({ ok: true, data: draft }).mockResolvedValueOnce({ ok: true, data: singleCredit() });
    await p.turn("Un único pago por el saldo total");
    expect((await p.saved()).billing.installments).toEqual([{ due_date: "2026-12-06", amount: "118.00" }]);
    expect((await p.saved()).billing.issueDate).toBe("2026-11-05");
  });
  it("does not use the year suggested by the model as the amount of a date-only payment", async () => {
    const p = fixture(awaitingCredit());
    p.ai.complete.mockResolvedValue(JSON.stringify({ user_intent: "billing_update", products_changed: false,
      outstanding_amount: "2026.00", installments: [{ due_date: "2026-12-06", amount: "2026.00" }] }));
    p.client.importInvoiceDraft.mockResolvedValueOnce({ ok: true, data: draft }).mockResolvedValueOnce({ ok: true, data: singleCredit() });
    await p.turn("Una sola cuota, fecha de pago el 06 de diciembre del 2026");
    expect((await p.saved()).billing.outstandingAmount).toBe("118.00");
    expect(p.client.issueInvoice).not.toHaveBeenCalled();
  });
  it("blocks creation if the final total differs from the total-based single payment", async () => {
    const p = fixture(awaitingCredit());
    p.ai.complete.mockResolvedValue(JSON.stringify({ user_intent: "billing_update", products_changed: false,
      installments: [{ due_date: "2026-12-06", amount: null }] }));
    p.client.importInvoiceDraft.mockResolvedValueOnce({ ok: true, data: draft })
      .mockResolvedValueOnce({ ok: true, data: { ...singleCredit(), totals: { total: 236 } } });
    await p.turn("Una sola cuota, vence 06/12/2026");
    expect((await p.saved()).confirmation).toBeUndefined();
    expect(p.client.issueInvoice).not.toHaveBeenCalled();
  });
  it("asks only for the balance when a prior advance is known but its remaining balance is missing", async () => {
    const initial = awaitingCredit();
    const p = fixture({ ...initial, billing: { ...initial.billing, paymentSourceText: "Hay un anticipo pagado de 18.00" } });
    p.ai.complete.mockResolvedValue(JSON.stringify({ user_intent: "billing_update", products_changed: false,
      installments: [{ due_date: "2026-12-06", amount: null }] }));
    const ctx = await p.turn("Una sola cuota, pago el 06/12/2026");
    expect((await p.saved()).billing.singlePayment.dueDate).toBe("2026-12-06");
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("saldo pendiente después del anticipo"));
    expect(p.client.importInvoiceDraft).not.toHaveBeenCalled();
  });
  it("persists explicit RUC and credit data even if the extractor mistakenly labels the mixed request review", async () => {
    const p = fixture(); await p.turn("Generar Factura", "enterprise_invoice");
    p.ai.complete.mockResolvedValue(JSON.stringify({ user_intent: "review", products_changed: false }));
    const ctx = await p.turn("RUC 20999999999 genera la factura a crédito con fecha de 5/11 para pagar el 5/12/2026");
    expect((await p.saved()).billing).toMatchObject({ customerRuc: "20999999999", paymentMethod: "credito", productsText: "", outstandingAmount: null, installments: [] });
    expect(JSON.stringify(vi.mocked(ctx.reply).mock.calls)).not.toContain("Todavía no hay datos");
    expect(p.client.issueInvoice).not.toHaveBeenCalled();
  });
  it("does not treat an identifier in a read request as a customer correction", async () => {
    const p = fixture(ready()); const before = (await p.saved()).billing;
    p.ai.complete.mockResolvedValue(JSON.stringify({ user_intent: "review", products_changed: false }));
    await p.turn("Muéstrame el resumen de la factura para el RUC 20123456789");
    expect((await p.saved()).billing).toEqual(before);
    expect(p.client.importInvoiceDraft).not.toHaveBeenCalled();
    expect(p.client.issueInvoice).not.toHaveBeenCalled();
  });
  it.each(["Hola", "Manolo", "Hola Manolo"])("greets %s with three choices after a processed invoice", async (text) => {
    const p = fixture(ready("issued")); const ctx = await p.turn(text);
    expect(p.ai.decide).toHaveBeenCalledOnce();
    expect(ctx.sendButtons).toHaveBeenCalledWith(expect.stringContaining("Soy Manolo"), mainButtons);
    expect(JSON.stringify(vi.mocked(ctx.reply).mock.calls)).not.toContain("F001-OLD");
    expect(p.client.issueInvoice).not.toHaveBeenCalled();
  });
  it("preserves an existing review when greeting", async () => {
    const p = fixture(ready()); const before = await p.saved(); await p.turn("Hola");
    expect((await p.saved()).billing).toEqual(before.billing);
    expect((await p.saved()).confirmation).toEqual(before.confirmation);
    expect(p.client.importInvoiceDraft).not.toHaveBeenCalled();
  });
  it("skips the start menu for an explicit invoice request and does not invent products", async () => {
    const p = fixture(); const ctx = await p.turn("Manolo hazme una factura");
    expect(p.events[0]).toBe("decide");
    expect(ctx.sendButtons).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("Factura activada"));
    expect((await p.saved()).billingDocumentKind).toBe("invoice");
    expect(p.ai.complete).not.toHaveBeenCalled();
    expect(p.client.importInvoiceDraft).not.toHaveBeenCalled();
  });
  it("preserves explicit data in a direct request and sends it to the selected flow", async () => {
    const p = fixture();
    p.ai.complete.mockResolvedValue(JSON.stringify({ user_intent: "billing_update", action: "invoice", customer_document: "20999999999",
      customer_name: "Cliente Prueba", products_changed: true, products_text: "1 servicio de bordados a S/118", products_ready: true, payment_method: "contado" }));
    const ctx = await p.turn("Manolo hazme una factura al contado para Cliente Prueba RUC 20999999999, 1 servicio de bordados a S/118");
    expect(p.events[0]).toBe("decide");
    expect(p.ai.complete).toHaveBeenCalled();
    expect(p.client.importInvoiceDraft).toHaveBeenCalledWith(expect.objectContaining({ customerRuc: "20999999999", paymentMethod: "contado" }));
    expect(ctx.sendButtons).toHaveBeenCalledWith(expect.stringContaining("Borrador de factura"), expect.arrayContaining([
      expect.objectContaining({ id: expect.stringMatching(/^enterprise_issue_invoice:/) }),
    ]));
    expect(p.client.issueInvoice).not.toHaveBeenCalled();
  });
  it("offers real secondary actions without executing a cancellation or issue", async () => {
    const p = fixture(); const ctx = await p.turn("Otras opciones", "enterprise_other_options");
    expect(ctx.sendList).toHaveBeenCalledWith(expect.any(String), "Ver acciones", [expect.objectContaining({ rows: expect.arrayContaining([
      expect.objectContaining({ id: "enterprise_list_drafts" }), expect.objectContaining({ id: "enterprise_credit_note" }),
      expect.objectContaining({ id: "enterprise_despatch" }),
    ]) })]);
    expect(p.client.createCreditNote).not.toHaveBeenCalled();
    expect(p.client.despatch.issue).not.toHaveBeenCalled();
  });
  it("queries only authorized drafts and offers another action after presenting the results", async () => {
    const p = fixture(); p.client.listInvoiceDrafts.mockResolvedValue({ ok: true, data: [draft, { ...draft, invoice: accepted }] });
    const ctx = await p.turn("Consultar borradores", "enterprise_list_drafts");
    expect(p.client.listInvoiceDrafts).toHaveBeenCalledWith(1);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining(draft.id));
    expect(JSON.stringify(vi.mocked(ctx.reply).mock.calls)).not.toContain(accepted.number);
    expect((await p.saved()).followUp).toBeDefined();
    expect(p.client.issueInvoice).not.toHaveBeenCalled();
  });
  it("offers Sí/No after PDF delivery and restarts the menu on Sí", async () => {
    const p = fixture(ready()); await p.turn("Crear", "enterprise_issue_invoice:ready");
    expect(p.events.indexOf("follow-up")).toBeGreaterThan(p.events.indexOf("pdf"));
    const next = await p.saved();
    const ctx = await p.turn("Sí", next.followUp.yesId);
    expect(ctx.sendButtons).toHaveBeenCalledWith(expect.stringContaining("otra gestión"), mainButtons);
    expect(p.client.issueInvoice).toHaveBeenCalledOnce();
  });
  it("closes on No and greets normally on the next contact", async () => {
    const p = fixture(ready()); await p.turn("Crear", "enterprise_issue_invoice:ready");
    const next = await p.saved(); const closed = await p.turn("No", next.followUp.noId);
    expect(closed.reply).toHaveBeenCalledWith(expect.stringContaining("Cuando necesites otra gestión"));
    expect(closed.sendButtons).not.toHaveBeenCalled();
    expect((await p.saved()).conversationClosed).toBe(true);
    const hello = await p.turn("Manolo"); expect(hello.sendButtons).toHaveBeenCalledWith(expect.any(String), mainButtons);
  });
  it("rejects a stale follow-up after starting another invoice", async () => {
    const p = fixture(ready()); await p.turn("Crear", "enterprise_issue_invoice:ready");
    const next = await p.saved(); await p.turn("Generar Factura", "enterprise_invoice");
    const stale = await p.turn("Sí", next.followUp.yesId);
    expect(stale.reply).toHaveBeenCalledWith(expect.stringContaining("seguimiento vigente"));
    expect((await p.saved()).billingDocumentKind).toBe("invoice");
    expect(p.client.issueInvoice).toHaveBeenCalledOnce();
  });
  it("does not offer follow-up as if a failed PDF had been delivered", async () => {
    const p = fixture(ready()); const ctx = p.context("Crear", "enterprise_issue_invoice:ready");
    ctx.sendDocument = vi.fn(async () => ({ status: "failed" as const, metaMessageId: null }));
    await p.handler.handle(ctx);
    expect((await p.saved()).followUp).toBeUndefined();
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("no pude confirmar la entrega del PDF"));
    await p.turn("Crear", "enterprise_issue_invoice:ready"); expect(p.client.issueInvoice).toHaveBeenCalledOnce();
  });
  it("greets during an uncertain issue but blocks a new fiscal task without losing its reference", async () => {
    const p = fixture(ready()); p.client.issueInvoice.mockResolvedValue({ ok: false, reason: "network_error" });
    await p.turn("Crear", "enterprise_issue_invoice:ready"); const before = await p.saved();
    const hello = await p.turn("Hola"); expect(hello.reply).toHaveBeenCalledWith(expect.stringContaining("pendiente de verificar"));
    expect(p.ai.decide).not.toHaveBeenCalled();
    const start = await p.turn("Generar Factura", "enterprise_invoice");
    expect(start.reply).toHaveBeenCalledWith(expect.stringContaining("pendiente de verificar"));
    expect((await p.saved()).billing.draftId).toBe(before.billing.draftId);
    expect((await p.saved()).phase).toBe("issuing");
    expect(p.client.issueInvoice).toHaveBeenCalledOnce();
  });
  it("does not accept another contact's follow-up button", async () => {
    const p = fixture(ready()); await p.turn("Crear", "enterprise_issue_invoice:ready");
    const follow = (await p.saved()).followUp;
    const ctx = p.context("Sí", follow.yesId, 2); await p.handler.handle(ctx);
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("seguimiento vigente"));
    expect((await p.saved()).followUp).toEqual(follow);
  });
  it("resumes an explicit request after company selection, preserving its original data", async () => {
    const p = fixture(); p.client.resolveTenantAccess.mockResolvedValueOnce({ status: "selection_required", tenant: null, tenants: [company] });
    p.ai.complete.mockResolvedValue(JSON.stringify({ user_intent: "billing_update", action: "invoice", customer_document: "20999999999",
      customer_name: "Cliente Prueba", products_changed: true, products_text: "1 servicio de bordados a S/118", products_ready: true, payment_method: "contado" }));
    const text = "Manolo hazme una factura al contado para Cliente Prueba RUC 20999999999, 1 servicio de bordados a S/118";
    await p.turn(text); expect((await p.saved()).pendingText).toBe(text);
    await p.turn("Empresa Prueba", "enterprise_company:company");
    expect(p.client.importInvoiceDraft).toHaveBeenCalledWith(expect.objectContaining({ customerRuc: "20999999999", productsText: "1 servicio de bordados a S/118" }));
    expect((await p.saved()).pendingAction).toBeUndefined();
  });
  it("prepares cancellation, requires the delivered button and prevents a repeated cancellation", async () => {
    const p = fixture(); await p.turn("Anular factura", "enterprise_credit_note");
    expect(p.client.createCreditNote).not.toHaveBeenCalled();
    p.client.listInvoiceDrafts.mockResolvedValue({ ok: true, data: [{ ...draft, invoice: accepted }] });
    p.ai.complete.mockResolvedValue(JSON.stringify({ action: "credit_note", invoice_number: accepted.number, reason_code: "01", reason_description: "Operación duplicada" }));
    await p.turn("Anula F001-123 por operación duplicada");
    const note = (await p.saved()).creditNote;
    expect(note.confirmation.buttonId).toMatch(/^enterprise_credit_confirm:/);
    expect(p.client.createCreditNote).not.toHaveBeenCalled();
    await p.turn("Confirmar", note.confirmation.buttonId);
    await p.turn("Confirmar", note.confirmation.buttonId);
    expect(p.client.createCreditNote).toHaveBeenCalledOnce();
    expect((await p.saved()).followUp).toBeDefined();
  });
  it("invalidates the cancellation button after editing the reason", async () => {
    const p = fixture(); await p.turn("Anular factura", "enterprise_credit_note");
    p.client.listInvoiceDrafts.mockResolvedValue({ ok: true, data: [{ ...draft, invoice: accepted }] });
    p.ai.complete.mockResolvedValue(JSON.stringify({ action: "credit_note", invoice_number: accepted.number, reason_code: "01", reason_description: "Operación duplicada" }));
    await p.turn("Anula F001-123 por operación duplicada");
    const old = (await p.saved()).creditNote.confirmation.buttonId;
    p.ai.complete.mockResolvedValue(JSON.stringify({ action: "credit_note", reason_code: "06", reason_description: "Devolución total" }));
    await p.turn("Cambia el motivo a devolución total");
    expect((await p.saved()).creditNote.confirmation.buttonId).not.toBe(old);
    await p.turn("Confirmar", old);
    expect(p.client.createCreditNote).not.toHaveBeenCalled();
  });
  it("keeps cancellation blocked when its review button was not delivered", async () => {
    const p = fixture(); await p.turn("Anular factura", "enterprise_credit_note");
    p.client.listInvoiceDrafts.mockResolvedValue({ ok: true, data: [{ ...draft, invoice: accepted }] });
    p.ai.complete.mockResolvedValue(JSON.stringify({ action: "credit_note", invoice_number: accepted.number, reason_code: "01", reason_description: "Duplicada" }));
    const ctx = p.context("Anula F001-123 por duplicada");
    ctx.sendButtons = vi.fn(async () => ({ status: "failed" as const, metaMessageId: null }));
    await p.handler.handle(ctx);
    expect((await p.saved()).creditNote.confirmation).toBeUndefined();
    await p.turn("Confirmar", "enterprise_credit_confirm:undelivered");
    expect(p.client.createCreditNote).not.toHaveBeenCalled();
  });
  it("never retries an uncertain cancellation or discards it by changing company", async () => {
    const p = fixture(); await p.turn("Anular factura", "enterprise_credit_note");
    p.client.listInvoiceDrafts.mockResolvedValue({ ok: true, data: [{ ...draft, invoice: accepted }] });
    p.ai.complete.mockResolvedValue(JSON.stringify({ action: "credit_note", invoice_number: accepted.number, reason_code: "01", reason_description: "Duplicada" }));
    await p.turn("Anula F001-123 por duplicada"); const button = (await p.saved()).creditNote.confirmation.buttonId;
    p.client.createCreditNote.mockResolvedValue({ ok: false, reason: "network_error" });
    await p.turn("Confirmar", button); await p.turn("Confirmar", button);
    const ctx = await p.turn("Cambiar empresa", "enterprise_change_company");
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining("pendiente de verificar"));
    expect((await p.saved()).phase).toBe("issuing");
    expect((await p.saved()).creditNote.target.invoice.id).toBe(accepted.id);
    expect(p.client.createCreditNote).toHaveBeenCalledOnce();
    expect(p.client.clearTenant).not.toHaveBeenCalled();
  });
  it("discards the old company draft when resuming a draft query for another company", async () => {
    const p = fixture(ready());
    p.client.resolveTenantAccess.mockResolvedValueOnce({ status: "selection_required", tenant: null, tenants: [{ ...company, id: "company-two" }] });
    p.client.selectTenant.mockResolvedValueOnce({ status: "authorized", tenant: { ...company, id: "company-two" }, tenants: [] });
    await p.turn("Consultar borradores", "enterprise_list_drafts");
    await p.turn("Empresa dos", "enterprise_company:company-two");
    expect((await p.saved()).facturayaTenantId).toBe("company-two");
    expect((await p.saved()).billing).toBeUndefined();
    expect((await p.saved()).confirmation).toBeUndefined();
    expect(p.client.listInvoiceDrafts).toHaveBeenCalledWith(1);
  });
  it("only offers cancellation to users with the permission in the current company", async () => {
    const p = fixture();
    p.client.resolveTenantAccess.mockResolvedValue({ status: "authorized", tenant: { ...company, permissions: ["view_invoice", "create_invoice", "issue_invoice"] }, tenants: [] });
    const menu = await p.turn("Otras opciones", "enterprise_other_options");
    expect(JSON.stringify(vi.mocked(menu.sendList!).mock.calls)).not.toContain("enterprise_credit_note");
    const denied = await p.turn("Anula F001-123 por error");
    expect(denied.reply).toHaveBeenCalledWith(expect.stringContaining("no tiene permiso"));
    expect(p.ai.complete).not.toHaveBeenCalled();
    expect(p.client.listInvoiceDrafts).not.toHaveBeenCalled();
    expect(p.client.createCreditNote).not.toHaveBeenCalled();
  });
  it("resumes the authorized other-options menu after company selection", async () => {
    const p = fixture(); p.client.resolveTenantAccess.mockResolvedValueOnce({ status: "selection_required", tenant: null, tenants: [company] });
    await p.turn("Otras opciones", "enterprise_other_options");
    expect((await p.saved()).pendingAction).toBe("other_options");
    const menu = await p.turn("Empresa Prueba", "enterprise_company:company");
    expect(menu.sendList).toHaveBeenCalledWith(expect.any(String), "Ver acciones", expect.any(Array));
  });
  it("invalidates confirmation if cancellation permission was removed after review", async () => {
    const p = fixture(); await p.turn("Anular factura", "enterprise_credit_note");
    p.client.listInvoiceDrafts.mockResolvedValue({ ok: true, data: [{ ...draft, invoice: accepted }] });
    p.ai.complete.mockResolvedValue(JSON.stringify({ action: "credit_note", invoice_number: accepted.number, reason_code: "01", reason_description: "Duplicada" }));
    await p.turn("Anula F001-123 por duplicada"); const button = (await p.saved()).creditNote.confirmation.buttonId;
    p.client.resolveTenantAccess.mockResolvedValue({ status: "authorized", tenant: { ...company, permissions: ["view_invoice", "create_invoice", "issue_invoice"] }, tenants: [] });
    await p.turn("Confirmar", button);
    expect(p.client.createCreditNote).not.toHaveBeenCalled();
    expect((await p.saved()).phase).toBe("collecting");
    expect((await p.saved()).creditNote.confirmation).toBeUndefined();
    const invoice = await p.turn("Generar Factura", "enterprise_invoice");
    expect(invoice.reply).toHaveBeenCalledWith(expect.stringContaining("Factura activada"));
  });
  it("distinguishes a conclusive permission rejection from an uncertain dispatch and requires a fresh button", async () => {
    const p = fixture(); await p.turn("Anular factura", "enterprise_credit_note");
    p.client.listInvoiceDrafts.mockResolvedValue({ ok: true, data: [{ ...draft, invoice: accepted }] });
    p.ai.complete.mockResolvedValue(JSON.stringify({ action: "credit_note", invoice_number: accepted.number, reason_code: "01", reason_description: "Duplicada" }));
    await p.turn("Anula F001-123 por duplicada"); const button = (await p.saved()).creditNote.confirmation.buttonId;
    p.client.createCreditNote.mockResolvedValueOnce({ ok: false, reason: "forbidden" });
    const denied = await p.turn("Confirmar", button);
    expect(denied.reply).toHaveBeenCalledWith(expect.stringContaining("rechazada por permisos"));
    expect((await p.saved()).phase).toBe("collecting");
    expect((await p.saved()).creditNote.invoiceNumber).toBe(accepted.number);
    expect((await p.saved()).creditNote.confirmation).toBeUndefined();
    await p.turn("Confirmar", button); expect(p.client.createCreditNote).toHaveBeenCalledOnce();
    await p.turn("resumen"); const newButton = (await p.saved()).creditNote.confirmation.buttonId;
    expect(newButton).not.toBe(button);
    await p.turn("Confirmar", newButton); expect(p.client.createCreditNote).toHaveBeenCalledTimes(2);
  });
  it.each(["Muestrame el resumen de la anulación", "Muéstrame el resumen de la nota de crédito", "resumen"])("preserves fiscal data on review-only request: %s", async (text) => {
    const p = fixture(); await p.turn("Anular factura", "enterprise_credit_note");
    p.client.listInvoiceDrafts.mockResolvedValue({ ok: true, data: [{ ...draft, invoice: accepted }] });
    p.ai.complete.mockResolvedValue(JSON.stringify({ action: "credit_note", invoice_number: accepted.number, reason_code: "06", reason_description: "Devolución total", issue_date: "2026-11-05" }));
    await p.turn("Anula F001-123 por devolución total, emisión 05/11/2026");
    const before = (await p.saved()).creditNote;
    p.ai.complete.mockClear();
    // Even a wrong action choice cannot turn a pure summary request into an edit.
    p.ai.decide.mockResolvedValue({ answers: [{ type: "choice", name: "enterprise_intent", choice: "credit_note" }] });
    const review = await p.turn(text);
    const after = (await p.saved()).creditNote;
    expect(after).toMatchObject({ invoiceNumber: before.invoiceNumber, reasonCode: "06", reasonDescription: "Devolución total", issueDate: before.issueDate });
    expect(p.ai.complete).not.toHaveBeenCalled();
    expect(review.sendButtons).toHaveBeenCalledWith(expect.stringContaining("Motivo 06: Devolución total"), expect.any(Array));
    expect(after.confirmation.buttonId).not.toBe(before.confirmation.buttonId);
    await p.turn("Confirmar", before.confirmation.buttonId);
    expect(p.client.createCreditNote).not.toHaveBeenCalled();
    await p.turn("Confirmar", after.confirmation.buttonId);
    expect(p.client.createCreditNote).toHaveBeenCalledWith(accepted.id, {
      issueDate: before.issueDate, reasonCode: "06", reasonDescription: "Devolución total",
    });
    const issued = await p.turn(text);
    expect(issued.sendButtons).not.toHaveBeenCalled();
    expect(issued.reply).toHaveBeenCalledWith(expect.stringContaining("ya fue procesada"));
    expect((await p.saved()).phase).toBe("issued");
    expect(p.client.createCreditNote).toHaveBeenCalledOnce();
  });
  it("requests missing cancellation data without inventing a reason from the summary command", async () => {
    const p = fixture(); await p.turn("Anular factura", "enterprise_credit_note");
    await p.turn("Muéstrame el resumen de la anulación");
    expect((await p.saved()).creditNote).toBeUndefined();
    expect(p.ai.complete).not.toHaveBeenCalled();
    expect(p.client.createCreditNote).not.toHaveBeenCalled();
  });
  it("uses Luna for semantic review during an active cancellation without Decisions", async () => {
    const p = fixture(); await p.turn("Anular factura", "enterprise_credit_note");
    p.client.listInvoiceDrafts.mockResolvedValue({ ok: true, data: [{ ...draft, invoice: accepted }] });
    p.ai.complete.mockResolvedValue(JSON.stringify({ action: "credit_note", invoice_number: accepted.number, reason_code: "01", reason_description: "Operación duplicada" }));
    await p.turn("Anula F001-123 por operación duplicada"); p.ai.complete.mockClear();
    p.ai.complete.mockResolvedValue(JSON.stringify({ user_intent: "review", products_changed: false }));
    await p.turn("¿Cómo quedó lo que voy a anular?");
    expect(p.ai.complete).toHaveBeenCalledOnce();
    expect(p.ai.decide).not.toHaveBeenCalled();
    expect((await p.saved()).creditNote.reasonDescription).toBe("Operación duplicada");
  });
});
