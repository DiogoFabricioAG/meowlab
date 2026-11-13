import { describe, expect, it, vi } from "vitest";
import { classifyEnterpriseIntent, fallbackEnterpriseIntent, isResumeText, type IntentContext } from "../src/ai/enterprise-intent";
import type { AiProvider } from "../src/ai/contracts";
const idle: IntentContext = { mode: null, documentKind: null, hasCurrentData: false, completed: false, awaitingFollowUp: false };
describe("enterprise intent routing", () => {
  it.each([
    ["Ignorar esa operación", "park"], ["olvídalo", "park"], ["déjala para después", "park"], ["mejor para luego", "park"],
    ["¿Cómo va la guía?", "status"], ["¿ya salió?", "status"], ["cancelar", "cancel"], ["Hola", "greeting"],
  ])("with a pending operation routes %s to %s", (text, expected) => {
    expect(fallbackEnterpriseIntent(text, { ...idle, pendingOperation: true })).toBe(expected);
  });
  it("never parks or reports status without a pending operation", () => {
    expect(fallbackEnterpriseIntent("Ignorar esa operación", idle)).not.toBe("park");
    expect(fallbackEnterpriseIntent("estado", { ...idle, hasCurrentData: true })).toBe("continue");
  });
  it.each(["retomar", "/retomar", "Retomar la guía", "volver a la operación pendiente"])("recognizes %s as resume", (text) => {
    expect(isResumeText(text)).toBe(true);
  });
  it.each(["no quiero retomar nada", "factura"])("does not treat %s as resume", (text) => {
    expect(isResumeText(text)).toBe(false);
  });
  it.each([
    ["Hola", "greeting"], ["Manolo", "greeting"], ["Hola Manolo", "greeting"],
    ["Manolo hazme una factura", "invoice"], ["Hola, quiero una boleta", "receipt"],
    ["Consulta los borradores", "drafts"], ["Anula F001-123 por error", "credit_note"],
    ["Necesito una guía de remisión", "despatch"], ["Otras opciones", "other_options"],
    ["¿?", "unknown"],
    ["Muestrame el resumen de la anulación", "review"],
    ["Ver el resumen de la nota de crédito", "review"],
    ["Cambia el motivo a devolución total y muestra el resumen", "continue"],
  ])("routes fallback %s to %s", (text, expected) => {
    const state = expected === "continue" ? { ...idle, hasCurrentData: true } : idle;
    expect(fallbackEnterpriseIntent(text, state)).toBe(expected);
  });
  it("uses one Decisions choice with a minimal checkpoint description and safe logs", async () => {
    const decide = vi.fn<NonNullable<AiProvider["decide"]>>(async (request) => {
      expect(request.model).toBe("gpt-6-luna");
      expect(request.input).toBe("Manolo hazme una factura");
      expect(request.questions[0]).toMatchObject({ type: "choice", name: "enterprise_intent" });
      return { answers: [{ type: "choice", name: "enterprise_intent", choice: "invoice", confidence: 0.99 }] };
    });
    const log = vi.fn();
    await expect(classifyEnterpriseIntent({ key: "test", complete: vi.fn(), decide }, "gpt-6-luna", "Manolo hazme una factura", idle, log)).resolves.toBe("invoice");
    expect(decide).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith("whatsapp_enterprise_intent", { intent: "invoice", source: "decisions" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("Manolo hazme");
  });
  it("does not allow the previous processed state to turn a pure greeting into a new invoice", async () => {
    const ai: AiProvider = { key: "test", complete: vi.fn(), decide: vi.fn<NonNullable<AiProvider["decide"]>>(async () => ({
      answers: [{ type: "choice", name: "enterprise_intent", choice: "invoice" }] })) };
    await expect(classifyEnterpriseIntent(ai, "gpt-6-luna", "Hola", { ...idle, completed: true }, vi.fn())).resolves.toBe("greeting");
  });
  it("uses Sí/No as follow-up only in the matching context", () => {
    const active: IntentContext = { ...idle, mode: "billing", documentKind: "invoice", hasCurrentData: true };
    expect(fallbackEnterpriseIntent("No", active)).toBe("continue");
    expect(fallbackEnterpriseIntent("Sí", active)).toBe("continue");
    expect(fallbackEnterpriseIntent("Sí", { ...idle, awaitingFollowUp: true })).toBe("another_action");
    expect(fallbackEnterpriseIntent("No, gracias", { ...idle, awaitingFollowUp: true })).toBe("finish");
  });
  it("falls back safely on malformed answers or provider exceptions", async () => {
    const ai: AiProvider = { key: "test", complete: vi.fn(), decide: vi.fn(async () => { throw Error("private-provider-error"); }) };
    const log = vi.fn();
    await expect(classifyEnterpriseIntent(ai, "gpt-6-luna", "Manolo", idle, log)).resolves.toBe("greeting");
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-provider-error");
    ai.decide = vi.fn<NonNullable<AiProvider["decide"]>>(async () => ({ answers: [{ type: "choice", name: "wrong_question", choice: "invoice" }] }));
    await expect(classifyEnterpriseIntent(ai, "gpt-6-luna", "???", idle, log)).resolves.toBe("unknown");
  });
});
