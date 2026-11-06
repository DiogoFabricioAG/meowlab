import { describe, expect, it, vi } from "vitest";
import type { FacturayaClient, FacturayaTenant } from "../src/facturaya/contracts";
import type { RoleHandlerContext } from "../src/roles/contracts";
import type { RoleStateRepository } from "../src/roles/state";
import { EnterpriseAdvisorRoleHandler } from "../src/roles/enterprise-advisor-role";
import { guideDraft, invoiceId, fullDespatchText, despatchPayload } from "./despatch-fixture";

class Checkpoints implements RoleStateRepository {
  rows = new Map<string, string>();
  async get(tenant: string, contact: number, role: string) { return this.rows.get(`${tenant}:${contact}:${role}`) ?? null; }
  async set(tenant: string, contact: number, role: string, value: string) { this.rows.set(`${tenant}:${contact}:${role}`, value); return true; }
  async clear(tenant: string, contact: number, role: string) { this.rows.delete(`${tenant}:${contact}:${role}`); return true; }
  async compareAndSet(tenant: string, contact: number, role: string, expected: string | null, value: string | null) {
    if (await this.get(tenant, contact, role) !== expected) return false;
    return value === null ? this.clear(tenant, contact, role) : this.set(tenant, contact, role, value);
  }
}
const company: FacturayaTenant = { id: "company-demo", name: "Empresa Demo", legalName: "Empresa Demo SAC",
  ruc: "20123456789", address: null, environment: "beta", permissions: ["view_invoice", "create_invoice", "issue_invoice"] };

function scenario() {
  const store = new Checkpoints();
  const despatch = { create: vi.fn<NonNullable<FacturayaClient["despatch"]>["create"]>(async (input) => {
    const { idempotency_key: _key, ...payload } = input;
    return { ok: true as const, data: { ...guideDraft, payload,
      confirmation_digest: (payload.vehicle_category === "M1" ? "b" : payload.vehicle_category === "L" ? "c" : "a").repeat(64) } };
  }),
    get: vi.fn(async () => ({ ok: true as const, data: { ...guideDraft, status: "pending", ticket: "ticket-demo" } })),
    issue: vi.fn<NonNullable<FacturayaClient["despatch"]>["issue"]>(async () => ({ ok: true, data: { ...guideDraft, status: "pending", ticket: "ticket-demo" } })),
    refresh: vi.fn(async () => ({ ok: true as const, data: { ...guideDraft, status: "accepted", ticket: "ticket-demo" } })) };
  const client: FacturayaClient = { despatch,
    resolveTenantAccess: vi.fn(async () => ({ status: "authorized" as const, tenant: company, tenants: [] })),
    selectTenant: vi.fn(async () => ({ status: "authorized" as const, tenant: company, tenants: [] })), clearTenant: vi.fn(async () => true),
    lookupCustomer: vi.fn(), lookupCustomerByDni: vi.fn(), importInvoiceDraft: vi.fn(), issueInvoice: vi.fn(), createCreditNote: vi.fn(), downloadFile: vi.fn(),
    listInvoiceDrafts: vi.fn(async () => ({ ok: true as const, data: [{ id: "source-draft", status: "issued", document_type: "01",
      issue_date: "2026-01-01", customer: { document_type: "6", ruc: "20999999999", name: "Cliente Demo" },
      invoice: { id: invoiceId, number: "F001-123", status: "accepted", document_type: "01", environment: "beta" } }] })) };
  const handler = new EnterpriseAdvisorRoleHandler();
  const context = (text = "", interactionId: string | null = null, patch: unknown = despatchPayload): RoleHandlerContext => ({
    message: { id: crypto.randomUUID(), interactionId, phoneNumberId: "phone", to: "51999999999", inputType: "text", text },
    tenant: { tenantId: "manolo", phoneNumberId: "phone", roleKey: "enterprise-advisor", systemPrompt: "", aiProvider: "openai", aiModel: "test", temperature: 0, maxTokens: 1800 },
    persisted: { contactId: 7, conversationId: "conversation", duplicate: false }, env: {} as Env, roleState: store,
    ai: { key: "test", complete: vi.fn(async () => JSON.stringify({ user_intent: "update", patch })) }, facturaya: client,
    businessData: null, quoteNumberAllocator: null, history: [], reply: vi.fn(async () => undefined),
    sendText: vi.fn(async () => ({ status: "sent" as const, metaMessageId: "text" })), sendButtons: vi.fn(async () => ({ status: "sent" as const, metaMessageId: "buttons" })),
    sendList: vi.fn(async () => ({ status: "sent" as const, metaMessageId: "list" })), sendDocument: vi.fn(),
    generateAiReply: vi.fn(), generateAiReplyWithHistory: vi.fn(), fallbackReply: "", log: vi.fn(),
  });
  const saved = async () => JSON.parse((await store.get("manolo", 7, "enterprise-advisor"))!).despatch;
  const start = async (category: "M1" | "L" | "other" = "other") => {
    await handler.handle(context("Guía de remisión", "enterprise_despatch"));
    await handler.handle(context(category, `enterprise_gre_category:${category}`));
    await handler.handle(context("F001-123", `enterprise_gre_invoice:${invoiceId}`));
  };
  const prepare = async () => { await start(); const turn = context(fullDespatchText); await handler.handle(turn); return turn; };
  return { store, despatch, client, handler, context, saved, start, prepare };
}

describe("enterprise despatch workflow", () => {
  function semantic(ctx: RoleHandlerContext, value: Record<string, unknown>) {
    vi.mocked(ctx.ai!.complete).mockResolvedValue(JSON.stringify({ interpretation_version: 1, user_intent: "update", patch: {}, source_evidence: {}, ...value }));
    return ctx;
  }
  it("understands today and 120 kilos via the model, and asks only for the unresolved locations", async () => {
    const p = scenario(); const listed = await p.client.listInvoiceDrafts(); if (!listed.ok) throw Error("fixture");
    vi.mocked(p.client.listInvoiceDrafts).mockResolvedValue({ ok: true, data: listed.data.map(d => ({ ...d, items: despatchPayload.items })) });
    await p.start("M1");
    const text = "Emoción fecha hoy, partida fecha de hoy llegada fecha de hoy dirección almacén del proveedor peso 120 kilos";
    const ctx = semantic(p.context(text), { patch: { issue_date: despatchPayload.issue_date, transfer_date: despatchPayload.issue_date, weight_kg: "120" },
      source_evidence: { issue_date: "fecha hoy", transfer_date: "partida fecha de hoy", weight_kg: "120 kilos" },
      clarifications: [{ field: "origin.address", question: "¿Cuál es la dirección exacta del almacén del proveedor?" }] });
    await p.handler.handle(ctx);
    expect((await p.saved()).fields).toMatchObject({ issue_date: despatchPayload.issue_date, transfer_date: despatchPayload.issue_date, weight_kg: "120", vehicle_category: "M1" });
    expect(ctx.ai!.complete).toHaveBeenCalledWith(expect.objectContaining({ reasoningEffort: "high", maxTokens: 8000 }), expect.any(Function));
    const reply = String(vi.mocked(ctx.reply).mock.calls[0][0]);
    expect(reply).not.toContain("*Fechas*"); expect(reply).not.toContain("*Peso*"); expect(reply).not.toContain("Dato pendiente");
    expect(reply.match(/\*Punto de partida\*/g)).toHaveLength(1); expect(reply.match(/\*Destino\*/g)).toHaveLength(1);
    expect(reply).toContain("Yo buscaré el ubigeo");
    expect(reply).not.toContain("*Productos*");
  });
  it("finds ubigeos from location names and preserves dates, weight and invoice items across turns", async () => {
    const p = scenario(); await p.start("M1");
    await p.handler.handle(semantic(p.context("Todo hoy, 120 kilos. 4 unidades de Chalecos"), { patch: {
      issue_date: despatchPayload.issue_date, transfer_date: despatchPayload.issue_date, weight_kg: "120", items: despatchPayload.items },
      source_evidence: { issue_date: "hoy", transfer_date: "hoy", weight_kg: "120 kilos", items: "4 unidades de Chalecos" } }));
    await p.handler.handle(semantic(p.context("Partida Calle Uno 123, Miraflores, Lima, Lima"), { patch: { origin: { address: "Calle Uno 123" } },
      locations: { origin: { department: "Lima", province: "Lima", district: "Miraflores" } },
      source_evidence: { "origin.address": "Calle Uno 123", "locations.origin": "Miraflores, Lima, Lima" } }));
    await p.handler.handle(semantic(p.context("Destino Calle Dos 456, San Juan de Lurigancho, Lima, Lima"), { patch: { destination: { address: "Calle Dos 456" } },
      locations: { destination: { department: "Lima", province: "Lima", district: "San Juan de Lurigancho" } },
      source_evidence: { "destination.address": "Calle Dos 456", "locations.destination": "San Juan de Lurigancho, Lima, Lima" } }));
    expect(p.despatch.create).toHaveBeenCalledWith(expect.objectContaining({ origin: { address: "Calle Uno 123", ubigeo: "150122" },
      destination: { address: "Calle Dos 456", ubigeo: "150132" }, weight_kg: "120", items: despatchPayload.items }));
    expect(p.despatch.issue).not.toHaveBeenCalled();
  });
  it("keeps a location clarification until the user identifies the province", async () => {
    const p = scenario(); await p.start("M1");
    const first = semantic(p.context("Partida en Miraflores"), { locations: { origin: { district: "Miraflores" } }, source_evidence: { "locations.origin": "Miraflores" } });
    await p.handler.handle(first); expect((await p.saved()).fields.origin.ubigeo).toBe("");
    expect((await p.saved()).questions["origin.location"]).toContain("varios distritos");
    const next = semantic(p.context("Provincia de Lima, departamento de Lima"), { locations: { origin: { province: "Lima", department: "Lima" } },
      source_evidence: { "locations.origin": "Provincia de Lima, departamento de Lima" } });
    await p.handler.handle(next);
    expect((await p.saved()).fields.origin.ubigeo).toBe("150122");
    expect((await p.saved()).questions["origin.location"]).toBeUndefined();
    expect((await p.saved()).fields.vehicle_category).toBe("M1");
  });
  it("does not accept a model-invented ubigeo or erase stored values on provider failure", async () => {
    const p = scenario(); await p.start("M1");
    const ctx = semantic(p.context("es en mi almacén"), { patch: { origin: { ubigeo: "150101" } }, source_evidence: { "origin.ubigeo": "mi almacén" } });
    await p.handler.handle(ctx); expect((await p.saved()).fields.origin.ubigeo).toBe("");
    const before = await p.saved(); const failed = p.context("hoy"); vi.mocked(failed.ai!.complete).mockResolvedValue(null);
    await p.handler.handle(failed);
    expect((await p.saved()).fields).toEqual(before.fields);
    expect((await p.saved()).evidence).toContain("hoy");
    expect(failed.log).toHaveBeenCalledWith("whatsapp_gre_interpretation_failed", { reason: "provider_unavailable", responseLength: 0 });
    expect(p.despatch.create).not.toHaveBeenCalled();
  });
  it("preserves a reviewed guide and its confirmation during conversation without creating another draft", async () => {
    const p = scenario(); await p.prepare(); const before = await p.saved();
    const ctx = semantic(p.context("Gracias"), { user_intent: "conversation" });
    await p.handler.handle(ctx);
    expect((await p.saved()).confirmation).toEqual(before.confirmation);
    expect(p.despatch.create).toHaveBeenCalledOnce();
    expect(p.despatch.issue).not.toHaveBeenCalled();
  });
  it("does not let model questions reintroduce exempt driver requirements for M1", async () => {
    const p = scenario(); await p.start("M1");
    const ctx = semantic(p.context("Peso 120 kilos"), { patch: { weight_kg: "120" }, source_evidence: { weight_kg: "120 kilos" },
      clarifications: [{ field: "driver.dni", question: "Dime el DNI del conductor" }] });
    await p.handler.handle(ctx);
    expect((await p.saved()).errors["driver.dni"]).toBeUndefined();
    expect((await p.saved()).questions["driver.dni"]).toBeUndefined();
    expect((await p.saved()).fields.weight_kg).toBe("120");
  });
  it("keeps the saved street when changing district and asks for confirmation instead of asking to retype it", async () => {
    const p = scenario(); await p.prepare();
    const ctx = semantic(p.context("La partida es en Miraflores, provincia de Lima"), { locations: { origin: { district: "Miraflores", province: "Lima" } },
      source_evidence: { "locations.origin": "Miraflores, provincia de Lima" } });
    await p.handler.handle(ctx);
    expect((await p.saved()).fields.origin.address).toBe(despatchPayload.origin.address);
    expect((await p.saved()).fields.origin.ubigeo).toBe("150122");
    expect((await p.saved()).questions["origin.address"]).toContain("¿Se mantiene la dirección");
    expect((await p.saved()).confirmation).toBeUndefined();
    expect(p.despatch.create).toHaveBeenCalledOnce();
    await p.handler.handle(semantic(p.context("Sí, esa dirección"), { patch: { origin: { address: despatchPayload.origin.address } },
      source_evidence: { "origin.address": "Sí, esa dirección" } }));
    expect((await p.saved()).questions["origin.address"]).toBeUndefined();
    expect(p.despatch.create).toHaveBeenCalledTimes(2);
    expect(p.despatch.issue).not.toHaveBeenCalled();
  });
  it("shows a pending driver clarification even when a previously saved license has valid format", async () => {
    const p = scenario(); await p.prepare();
    const ctx = semantic(p.context("Creo que la licencia es otra"), { clarifications: [{ field: "driver.license", question: "¿Cuál es la licencia correcta del conductor?" }] });
    await p.handler.handle(ctx);
    expect(String(vi.mocked(ctx.reply).mock.calls[0][0])).toContain("¿Cuál es la licencia correcta del conductor?");
    expect((await p.saved()).fields.driver.license).toBe(despatchPayload.driver!.license);
    expect(p.despatch.create).toHaveBeenCalledOnce();
    await p.handler.handle(semantic(p.context("La licencia es Q87654321"), { patch: { driver: { license: "Q87654321" } }, source_evidence: { "driver.license": "Q87654321" } }));
    expect((await p.saved()).questions["driver.license"]).toBeUndefined();
    expect(p.despatch.create).toHaveBeenCalledTimes(2);
    expect(p.despatch.issue).not.toHaveBeenCalled();
  });
  it("starts a guide after a completed invoice and retains M1, invoice and data on later turns", async () => {
    const p = scenario();
    await p.store.set("manolo", 7, "enterprise-advisor", JSON.stringify({ version: 2, startedAt: Date.now(), expiresAt: Date.now() + 86400000,
      mode: "billing", phase: "issued", revision: 3, billingDocumentKind: "invoice", facturayaTenantId: company.id }));
    await p.start("M1");
    await p.handler.handle(p.context("Partida Calle Uno 123 Lima", null, { origin: { address: "Calle Uno 123 Lima" } }));
    await p.handler.handle(p.context("Peso 25 kg", null, { weight_kg: "25" }));
    const g = await p.saved();
    expect(g.fields.vehicle_category).toBe("M1");
    expect(g.invoice.id).toBe(invoiceId);
    expect(g.fields.origin.address).toBe("Calle Uno 123 Lima");
    expect(g.fields.weight_kg).toBe("25");
  });
  it("repairs the legacy issued parent phase without losing the saved guide", async () => {
    const p = scenario(); await p.start("M1");
    const raw = JSON.parse((await p.store.get("manolo", 7, "enterprise-advisor"))!); raw.phase = "issued";
    await p.store.set("manolo", 7, "enterprise-advisor", JSON.stringify(raw));
    await p.handler.handle(p.context("Peso 25 kg", null, { weight_kg: "25" }));
    expect((await p.saved()).fields.vehicle_category).toBe("M1");
    expect((await p.saved()).invoice.id).toBe(invoiceId);
    expect((await p.saved()).fields.weight_kg).toBe("25");
  });
  it("preloads invoice quantities and does not ask for them again", async () => {
    const p = scenario();
    const response = await p.client.listInvoiceDrafts();
    if (!response.ok) throw Error("fixture");
    vi.mocked(p.client.listInvoiceDrafts).mockResolvedValue({ ok: true, data: response.data.map(d => ({ ...d,
      items: [{ description: "Chalecos", quantity: "4.000000" }] })) });
    await p.handler.handle(p.context("", "enterprise_despatch"));
    await p.handler.handle(p.context("M1", "enterprise_gre_category:M1"));
    const pick = p.context("", `enterprise_gre_invoice:${invoiceId}`); await p.handler.handle(pick);
    expect((await p.saved()).fields.items).toEqual([{ description: "Chalecos", quantity: "4", unit: "NIU" }]);
    expect(pick.reply).toHaveBeenCalledWith(expect.stringContaining("*Productos y cantidades:* tomados de la factura"));
    expect(pick.reply).toHaveBeenCalledWith(expect.stringContaining("\n\n• *"));
  });
  it("hides invoices with accepted credit notes and uses page buttons on a full page", async () => {
    const p = scenario(); const response = await p.client.listInvoiceDrafts(); if (!response.ok) throw Error("fixture");
    vi.mocked(p.client.listInvoiceDrafts).mockResolvedValue({ ok: true, data: Array.from({ length: 10 }, (_, i) => ({ ...response.data[0],
      invoice: { ...response.data[0].invoice!, credit_notes: [{ status: i === 0 ? "accepted" : "rejected" }] } })) });
    await p.handler.handle(p.context("", "enterprise_despatch"));
    const cat = p.context("M1", "enterprise_gre_category:M1"); await p.handler.handle(cat);
    expect(vi.mocked(cat.sendList!).mock.calls[0][2][0].rows).toHaveLength(9);
    expect(cat.sendButtons).toHaveBeenCalledWith("Página 1", [{ id: "enterprise_gre_page:2", title: "Siguiente página" }]);
    const page = p.context("", "enterprise_gre_page:2"); await p.handler.handle(page);
    expect(p.client.listInvoiceDrafts).toHaveBeenLastCalledWith(2);
    expect(page.sendButtons).toHaveBeenCalledWith("Página 2", expect.arrayContaining([{ id: "enterprise_gre_page:1", title: "Anterior página" }]));
  });
  it("blocks issue if the selected invoice acquires a credit note after review", async () => {
    const p = scenario(); await p.prepare(); const state = await p.saved();
    const result = await p.client.listInvoiceDrafts(); if (!result.ok) throw Error("fixture");
    vi.mocked(p.client.listInvoiceDrafts).mockResolvedValue({ ok: true, data: result.data.map(d => ({ ...d, invoice: { ...d.invoice!, credit_notes: [{ status: "accepted" }] } })) });
    await p.handler.handle(p.context("", state.confirmation.buttonId));
    expect(p.despatch.issue).not.toHaveBeenCalled();
    expect((await p.saved()).fields).toEqual(state.fields);
  });
  it("asks category first and never infers it from auto or camioneta", async () => {
    const p = scenario();
    const turn = p.context("Tengo una camioneta, prepara una guía", "enterprise_despatch");
    await p.handler.handle(turn);
    expect(turn.sendButtons).toHaveBeenCalledWith(expect.stringContaining("según su tarjeta"),
      expect.arrayContaining([expect.objectContaining({ title: "M1" }), expect.objectContaining({ title: "L" }), expect.objectContaining({ title: "Otra" })]));
    expect(p.client.listInvoiceDrafts).not.toHaveBeenCalled();
    const unknown = p.context("No sé, es un auto"); await p.handler.handle(unknown);
    expect((await p.saved()).fields.vehicle_category).toBeUndefined();
    expect(unknown.ai!.complete).not.toHaveBeenCalled();
    expect(p.despatch.create).not.toHaveBeenCalled();
  });
  it.each(["M1", "L"] as const)("collects and reviews %s without vehicle or driver", async (category) => {
    const p = scenario(); await p.start(category);
    const { vehicle: _vehicle, driver: _driver, ...payload } = despatchPayload;
    const turn = p.context(fullDespatchText.replace(/, placa ABC123, conductor Juan Pérez DNI 12345678 licencia Q12345678\./, "."),
      null, { ...payload, vehicle_category: category });
    await p.handler.handle(turn);
    const input = p.despatch.create.mock.calls[0][0];
    expect(input.vehicle_category).toBe(category);
    expect(input).not.toHaveProperty("vehicle");
    expect(input).not.toHaveProperty("driver");
    expect((await p.saved()).confirmation).toBeDefined();
    expect(turn.sendText).toHaveBeenCalledWith(expect.stringContaining("Indicador M1/L"));
    expect(turn.sendText).not.toHaveBeenCalledWith(expect.stringContaining("DNI 12345678"));
  });
  it("requires vehicle and driver for other and invalidates their confirmation when switching to M1", async () => {
    const p = scenario(); await p.start();
    const { vehicle: _vehicle, driver: _driver, ...patch } = despatchPayload;
    const incomplete = p.context(fullDespatchText, null, patch); await p.handler.handle(incomplete);
    expect(p.despatch.create).not.toHaveBeenCalled();
    expect(incomplete.reply).toHaveBeenCalledWith(expect.stringContaining("placa principal"));
    await p.handler.handle(p.context(fullDespatchText));
    const previous = await p.saved();
    expect(previous.confirmation).toBeDefined();
    await p.handler.handle(p.context("M1", "enterprise_gre_category:M1"));
    const changed = await p.saved();
    expect(changed.confirmation).toBeUndefined();
    expect(changed.fields).not.toHaveProperty("vehicle");
    expect(changed.fields).not.toHaveProperty("driver");
    expect(changed.evidence).toBe("");
    expect(changed.fields.items).toEqual(previous.fields.items);
    await p.handler.handle(p.context(previous.confirmation.buttonId, previous.confirmation.buttonId));
    expect(p.despatch.issue).not.toHaveBeenCalled();
    await p.handler.handle(p.context("resumen"));
    expect(p.despatch.create).toHaveBeenLastCalledWith(expect.objectContaining({ vehicle_category: "M1" }));
    expect(p.despatch.create.mock.calls.at(-1)![0].idempotency_key).not.toBe(p.despatch.create.mock.calls[0][0].idempotency_key);
    expect((await p.saved()).confirmation.digest).toBe("b".repeat(64));
  });
  it("clears a previously selected category when user is unsure and requires a new explicit choice", async () => {
    const p = scenario(); await p.prepare();
    await p.handler.handle(p.context("No sé si es M1 o L"));
    const state = await p.saved();
    expect(state.confirmation).toBeUndefined();
    expect(state.fields.vehicle_category).toBeUndefined();
    expect(state.fields.vehicle.plate).toBe("");
    expect(state.fields.driver.dni).toBe("");
    expect(p.despatch.create).toHaveBeenCalledOnce();
  });
  it("does not confuse a driver's initial L with category L", async () => {
    const p = scenario(); await p.start();
    await p.handler.handle(p.context("El conductor se llama Juan L Pérez", null, { driver: { first_name: "Juan", last_name: "L Pérez" } }));
    expect((await p.saved()).fields.vehicle_category).toBe("other");
    expect(p.despatch.create).not.toHaveBeenCalled();
  });
  it.each(["Laptop M1", "Manual categoría M1"])("keeps category other and driver when goods contain %s", async (description) => {
    const p = scenario(); await p.prepare(); const previous = await p.saved();
    await p.handler.handle(p.context(`4 unidades NIU de ${description}`, null,
      { items: [{ description, quantity: "4", unit: "NIU" }] }));
    const current = await p.saved();
    expect(current.fields.vehicle_category).toBe("other");
    expect(current.fields.driver).toEqual(previous.fields.driver);
    expect(current.fields.vehicle).toEqual(previous.fields.vehicle);
    expect(current.fields.items[0].description).toBe(description);
  });
  it("accepts an explicit vehicle-category declaration", async () => {
    const p = scenario();
    await p.handler.handle(p.context("Guía de remisión", "enterprise_despatch"));
    await p.handler.handle(p.context("Mi vehículo es M1"));
    expect((await p.saved()).fields.vehicle_category).toBe("M1");
    expect(p.client.listInvoiceDrafts).toHaveBeenCalledOnce();
  });
  it("selects an accepted invoice and never invents its transported items", async () => {
    const p = scenario(); await p.start();
    expect((await p.saved()).fields.items).toEqual([]);
    expect(p.despatch.create).not.toHaveBeenCalled();
  });
  it("delivers full summary and enables a revision-bound confirmation with the digest", async () => {
    const p = scenario(); const turn = await p.prepare();
    expect(p.despatch.create).toHaveBeenCalledWith(expect.objectContaining({ ...despatchPayload, idempotency_key: expect.any(String) }));
    expect(turn.sendText).toHaveBeenCalledWith(expect.stringContaining("Destinatario: Cliente Demo"));
    expect(turn.sendText).toHaveBeenCalledWith(expect.stringContaining("SIMULACIÓN LOCAL"));
    expect(turn.sendText).toHaveBeenCalledWith(expect.stringContaining("formato de trabajo sin QR"));
    expect(turn.sendText).toHaveBeenCalledWith(expect.stringContaining("4 NIU — Chalecos"));
    const state = await p.saved();
    expect(state.confirmation).toMatchObject({ digest: guideDraft.confirmation_digest, guideId: guideDraft.id, revision: state.revision });
    expect(p.despatch.issue).not.toHaveBeenCalled();
  });
  it("accepts only the current button and prevents repeated or textual issue", async () => {
    const p = scenario(); await p.prepare(); const button = (await p.saved()).confirmation.buttonId;
    await p.handler.handle(p.context("confirmar guía"));
    expect(p.despatch.issue).not.toHaveBeenCalled();
    const current = (await p.saved()).confirmation.buttonId;
    await p.handler.handle(p.context(button, button));
    expect(p.despatch.issue).not.toHaveBeenCalled();
    await p.handler.handle(p.context(current, current));
    await p.handler.handle(p.context(current, current));
    expect(p.despatch.issue).toHaveBeenCalledOnce();
    expect(p.despatch.issue).toHaveBeenCalledWith(guideDraft.id, guideDraft.confirmation_digest);
  });
  it("invalidates a delivered button on incomplete changes and preserves other fields", async () => {
    const p = scenario(); await p.prepare(); const old = await p.saved();
    await p.handler.handle(p.context("Cambia traslado al 05 diciembre", null, { transfer_date: "2028-12-05" }));
    const next = await p.saved();
    expect(next.confirmation).toBeUndefined();
    expect(next.fields.origin).toEqual(old.fields.origin);
    expect(next.errors["fecha de traslado"]).toContain("sin completar");
    await p.handler.handle(p.context(old.confirmation.buttonId, old.confirmation.buttonId));
    expect(p.despatch.issue).not.toHaveBeenCalled();
  });
  it("never enables confirmation if the review text failed to send", async () => {
    const p = scenario(); await p.start(); const turn = p.context(fullDespatchText);
    turn.sendText = vi.fn(async () => ({ status: "failed" as const, metaMessageId: null }));
    await p.handler.handle(turn);
    expect((await p.saved()).confirmation).toBeUndefined();
    expect(turn.sendButtons).not.toHaveBeenCalled();
  });
  it("reconciles a lost issue response through get/status and never resends", async () => {
    const p = scenario(); await p.prepare(); const button = (await p.saved()).confirmation.buttonId;
    p.despatch.issue.mockResolvedValueOnce({ ok: false, reason: "network_error" });
    await p.handler.handle(p.context(button, button));
    expect((await p.saved()).phase).toBe("issuing");
    const query = p.context("estado", "enterprise_gre_status");
    await new EnterpriseAdvisorRoleHandler().handle(query);
    expect(p.despatch.get).toHaveBeenCalledWith(guideDraft.id);
    expect(p.despatch.refresh).toHaveBeenCalledWith(guideDraft.id);
    expect(p.despatch.issue).toHaveBeenCalledOnce();
    expect(query.reply).toHaveBeenCalledWith(expect.stringContaining("no enviada a SUNAT"));
  });
  it("requires a new invoice when the authorized company changes", async () => {
    const p = scenario(); await p.prepare();
    vi.mocked(p.client.resolveTenantAccess).mockResolvedValueOnce({ status: "authorized", tenant: { ...company, id: "company-other" }, tenants: [] });
    const turn = p.context("resumen"); await p.handler.handle(turn);
    expect((await p.saved())?.confirmation).toBeUndefined();
    expect((await p.saved())?.invoice).toBeUndefined();
    expect(turn.sendButtons).toHaveBeenCalledWith(expect.stringContaining("empresa activa cambió"), expect.any(Array));
  });
  it("recovers an uncertain draft with the same business idempotency key", async () => {
    const p = scenario();
    p.despatch.create.mockResolvedValueOnce({ ok: false, reason: "network_error" });
    await p.prepare(); const first = p.despatch.create.mock.calls[0][0];
    await p.handler.handle(p.context("resumen"));
    expect(p.despatch.create).toHaveBeenLastCalledWith(first);
    expect((await p.saved()).confirmation).toBeDefined();
    expect(p.despatch.issue).not.toHaveBeenCalled();
  });
  it("offers another action only when a submitted guide reaches a terminal status", async () => {
    const p = scenario(); await p.prepare(); const button = (await p.saved()).confirmation.buttonId;
    const issue = p.context(button, button); await p.handler.handle(issue);
    const pending = JSON.parse((await p.store.get("manolo", 7, "enterprise-advisor"))!);
    expect(pending.followUp).toBeUndefined();
    const status = p.context("estado", "enterprise_gre_status"); await p.handler.handle(status);
    const completed = JSON.parse((await p.store.get("manolo", 7, "enterprise-advisor"))!);
    expect(completed.followUp).toBeDefined();
    expect(status.sendButtons).toHaveBeenCalledWith(expect.stringContaining("otra gestión"), [
      expect.objectContaining({ title: "Sí" }), expect.objectContaining({ title: "No" }),
    ]);
    expect(p.despatch.issue).toHaveBeenCalledOnce();
  });
  it("offers follow-up after cancelling a guide draft without issuing", async () => {
    const p = scenario(); await p.prepare();
    const cancel = p.context("Cancelar", "enterprise_gre_cancel"); await p.handler.handle(cancel);
    expect(p.despatch.issue).not.toHaveBeenCalled();
    expect(JSON.parse((await p.store.get("manolo", 7, "enterprise-advisor"))!).followUp).toBeDefined();
  });
});

describe("enterprise despatch PDF", () => {
  function withPdf(ctx: RoleHandlerContext, pdf: Blob | null = new Blob(["%PDF-1.7"], { type: "application/pdf" })) {
    ctx.renderPdf = vi.fn(async () => pdf);
    ctx.sendDocument = vi.fn(async () => ({ status: "sent" as const, metaMessageId: "document" }));
    return ctx;
  }
  const html = (ctx: RoleHandlerContext) => String(vi.mocked(ctx.renderPdf!).mock.calls[0][0]);

  it("sends the draft in the template format before the confirmation button", async () => {
    const p = scenario(); await p.start();
    const turn = withPdf(p.context(fullDespatchText)); await p.handler.handle(turn);
    expect(html(turn)).toContain("GUÍA DE REMISIÓN ELECTRÓNICA");
    expect(html(turn)).toContain("N.º T001 - BORRADOR");
    expect(html(turn)).toContain("Empresa Demo SAC");
    expect(html(turn)).toContain("Cliente Demo");
    expect(html(turn)).toContain("F001-123");
    expect(html(turn)).toContain("Chalecos");
    expect(html(turn)).toContain("Juan Pérez · DNI 12345678 · Licencia Q12345678");
    expect(turn.sendDocument).toHaveBeenCalledWith(expect.objectContaining({
      filename: expect.stringMatching(/^Guia-Remision-T001-borrador-r\d+\.pdf$/), caption: expect.stringContaining("borrador"),
    }));
    const documentOrder = vi.mocked(turn.sendDocument).mock.invocationCallOrder[0];
    const buttonsOrder = vi.mocked(turn.sendButtons!).mock.invocationCallOrder.at(-1)!;
    expect(documentOrder).toBeLessThan(buttonsOrder);
    expect((await p.saved()).confirmation).toBeDefined();
    expect(p.despatch.issue).not.toHaveBeenCalled();
  });
  it("falls back to the Browser Run binding when the runtime does not inject renderPdf", async () => {
    const p = scenario(); await p.start();
    const turn = p.context(fullDespatchText);
    const quickAction = vi.fn(async () => new Response(new Blob(["%PDF-1.7"], { type: "application/pdf" })));
    turn.env = { BROWSER: { quickAction } } as unknown as Env;
    turn.sendDocument = vi.fn(async () => ({ status: "sent" as const, metaMessageId: "document" }));
    await p.handler.handle(turn);
    expect(quickAction).toHaveBeenCalledWith("pdf", expect.objectContaining({
      html: expect.stringContaining("GUÍA DE REMISIÓN ELECTRÓNICA"), pdfOptions: expect.objectContaining({ format: "a4" }) }));
    expect(turn.sendDocument).toHaveBeenCalledWith(expect.objectContaining({ filename: expect.stringMatching(/^Guia-Remision-T001-borrador/) }));
    expect((await p.saved()).confirmation).toBeDefined();
  });
  it("keeps the confirmation available when the PDF cannot be generated", async () => {
    const p = scenario(); await p.start();
    const turn = withPdf(p.context(fullDespatchText), null); await p.handler.handle(turn);
    expect(turn.sendDocument).not.toHaveBeenCalled();
    expect(turn.reply).toHaveBeenCalledWith(expect.stringContaining("No pude generar el PDF"));
    expect(turn.sendButtons).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([
      expect.objectContaining({ title: "Confirmar guía" })]));
    expect((await p.saved()).confirmation).toBeDefined();
  });
  it("sends the issued guide with its number and offers it again without resending", async () => {
    const p = scenario(); await p.prepare(); const button = (await p.saved()).confirmation.buttonId;
    p.despatch.issue.mockResolvedValueOnce({ ok: true, data: { ...guideDraft, status: "pending", ticket: "ticket-demo", correlative: 12 } });
    const issue = withPdf(p.context(button, button)); await p.handler.handle(issue);
    expect(html(issue)).toContain("N.º T001 - 00000012");
    expect(html(issue)).toContain("Ticket ticket-demo");
    expect(issue.sendDocument).toHaveBeenCalledWith(expect.objectContaining({ filename: "Guia-Remision-T001-00000012.pdf" }));
    expect(issue.sendButtons).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([
      expect.objectContaining({ id: "enterprise_gre_pdf", title: "PDF de la guía" })]));
    const again = withPdf(p.context("PDF de la guía", "enterprise_gre_pdf")); await p.handler.handle(again);
    expect(again.sendDocument).toHaveBeenCalledWith(expect.objectContaining({ filename: "Guia-Remision-T001-00000012.pdf" }));
    expect(p.despatch.issue).toHaveBeenCalledOnce();
    expect(p.despatch.get).not.toHaveBeenCalled();
  });
  it("does not print a guide whose issue result is uncertain", async () => {
    const p = scenario(); await p.prepare(); const button = (await p.saved()).confirmation.buttonId;
    p.despatch.issue.mockResolvedValueOnce({ ok: false, reason: "network_error" });
    await p.handler.handle(p.context(button, button));
    const request = withPdf(p.context("pdf")); await p.handler.handle(request);
    expect(request.renderPdf).not.toHaveBeenCalled();
    expect(request.reply).toHaveBeenCalledWith(expect.stringContaining("envío por verificar"));
    expect(p.despatch.issue).toHaveBeenCalledOnce();
  });
  it("explains that the PDF needs a reviewed guide while data is still missing", async () => {
    const p = scenario(); await p.start("M1");
    const request = withPdf(p.context("enviar pdf")); await p.handler.handle(request);
    expect(request.renderPdf).not.toHaveBeenCalled();
    expect(request.reply).toHaveBeenCalledWith(expect.stringContaining("revises el resumen"));
    expect(p.despatch.create).not.toHaveBeenCalled();
  });
});
