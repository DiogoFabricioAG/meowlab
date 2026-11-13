import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processConversationTurn } from "../src/index";
import { planBurst, type BurstEntry } from "../src/conversations/burst-policy";
import type { IncomingMessage } from "../src/roles/contracts";
import type { FacturayaTenant } from "../src/facturaya/contracts";

const company: FacturayaTenant = { id: "visual-company", name: "Prueba Visual", legalName: "Prueba Visual SAC",
  ruc: "20123456789", address: null, environment: "beta", permissions: ["view_invoice", "create_invoice", "issue_invoice"] };
const testEnv = { ...env, ENVIRONMENT: "production", META_ACCESS_TOKEN: "test-meta", OPENAI_API_KEY: "test-openai", ENTERPRISE_AI_PROVIDER: "openai",
  ENTERPRISE_AI_MODEL: "gpt-6-luna", ENTERPRISE_AI_BASE_URL: "https://api.openai.com/v1", VPS_BRIDGE_ENABLED: "true", VPS_PLATFORM_SHADOW_ENABLED: "false",
  VPS_BRIDGE_API_URL: "https://bridge.test", VPS_BRIDGE_HMAC_SECRET: "test-bridge-hmac-at-least-32-characters" } as unknown as Env;
const customerRuc = "20999999999";
function input(text: string, inputType: "text" | "image" = "text"): IncomingMessage {
  return { id: crypto.randomUUID(), interactionId: null, phoneNumberId: "444444444444443", to: "51900000009", text, inputType,
    ...(inputType === "image" ? { imageMediaId: "multimodal-image", imageMimeType: "image/png", imageCaption: text } : {}) };
}
function setup(visionFails = false) {
  const operations: string[] = [];
  const decisionInputs: string[] = [];
  let vision = 0, extraction = 0, decisions = 0;
  const outgoing: string[] = [];
  const fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const endpoint = String(url);
    if (endpoint.startsWith("https://bridge.test/")) {
      const body = JSON.parse(String(init?.body));
      if (endpoint.endsWith("/resolve-role")) return Response.json({ version: 1, requestId: body.requestId, roleKey: "enterprise-advisor", source: "contact" });
      const requestId = new Headers(init?.headers).get("X-Manolo-Request-Id");
      expect(new Headers(init?.headers).get("X-Manolo-Signature")).toMatch(/^sha256=/);
      operations.push(body.operation);
      if (body.operation === "resolve_tenant") return Response.json({ request_id: requestId, ok: true, replayed: false,
        data: { status: "authorized", tenant: company, tenants: [] } });
      throw Error("No import or fiscal issuance is expected");
    }
    if (endpoint.startsWith("https://api.openai.com/")) {
      const body = JSON.parse(String(init?.body));
      if (endpoint.endsWith("/decisions")) {
        decisions++;
        decisionInputs.push(body.input);
        return Response.json({ answers: [{ type: "choice", name: "enterprise_intent", choice: "invoice" }] });
      }
      if (body.messages?.some((message: { content: unknown }) => Array.isArray(message.content))) {
        vision++;
        return Response.json({ choices: [{ message: { content: visionFails ? null : "Productos: 2 chalecos bordados, precio unitario S/ 10.00, total S/ 20.00. Cliente no visible." } }] });
      }
      extraction++;
      expect(body.messages.at(-1).content).toContain(customerRuc);
      if (!visionFails) expect(body.messages.at(-1).content).toContain("2 chalecos bordados");
      return Response.json({ choices: [{ message: { content: JSON.stringify({ user_intent: "billing_update", action: "invoice",
        customer_document: customerRuc, customer_name: "Cliente Visual", payment_method: "credito",
        products_changed: !visionFails, products_text: visionFails ? null : "2 chalecos bordados a S/10, total S/20", products_ready: !visionFails,
        installments: [{ due_date: "2026-12-05", amount: null }] }) } }] });
    }
    if (endpoint.includes("graph.facebook.com") && endpoint.includes("multimodal-image")) {
      return Response.json({ url: "https://media.test/products.png", mime_type: "image/png", file_size: 3 });
    }
    if (endpoint === "https://media.test/products.png") return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } });
    if (endpoint.includes("graph.facebook.com")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (body.type === "text") outgoing.push(body.text.body);
      return Response.json({ messages: [{ id: `out-${crypto.randomUUID()}` }] });
    }
    throw Error("Unexpected external request");
  });
  vi.stubGlobal("fetch", fetch);
  return { operations, decisionInputs, outgoing, counts: () => ({ vision, extraction, decisions }) };
}

describe("multimodal invoice turn", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM tenants WHERE id='visual-burst'"),
      env.DB.prepare("INSERT OR IGNORE INTO tenants(id,name) VALUES ('visual-burst','Visual Burst')"),
      env.DB.prepare("INSERT OR IGNORE INTO bot_configs(tenant_id,system_prompt,ai_provider,ai_model,temperature,max_tokens,role_key) VALUES ('visual-burst','Prueba','openai','gpt-6-luna',0,1800,'enterprise-advisor')"),
      env.DB.prepare("INSERT OR IGNORE INTO whatsapp_numbers(id,tenant_id,phone_number_id) VALUES ('visual-burst-number','visual-burst','444444444444443')"),
    ]);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it.each([false, true])("groups text and an image into one invoice turn (image first: %s)", async (imageFirst) => {
    const p = setup();
    const text = input(`RUC ${customerRuc} genera la factura a crédito, fecha 05/11/2026 para pagar el 05/12/2026`);
    const image = input("", "image");
    const inputs = imageFirst ? [image, text] : [text, image];
    const entries: BurstEntry[] = inputs.map((message, seq) => ({ message, seq, received: seq * 500 }));
    expect(planBurst(entries, 1000)?.due).toBe(3500);
    await processConversationTurn(planBurst(entries, 4000)!.entries.map(row => row.message), testEnv, "visual-burst");
    expect(p.counts()).toEqual({ vision: 1, extraction: 1, decisions: 1 });
    expect(p.decisionInputs).toHaveLength(1);
    expect(p.decisionInputs[0]).toContain(customerRuc);
    expect(p.decisionInputs[0]).toContain("2 chalecos bordados");
    expect(p.outgoing).toHaveLength(1);
    expect(p.outgoing[0]).not.toContain("Todavía no hay datos");
    const state = await env.DB.prepare("SELECT state_json FROM contact_role_states WHERE tenant_id='visual-burst' AND role_key='enterprise-advisor'").first<{ state_json: string }>();
    expect(JSON.parse(state!.state_json).billing).toMatchObject({ customerRuc, paymentMethod: "credito", productsText: "2 chalecos bordados a S/10, total S/20" });
    const originals = await env.DB.prepare("SELECT meta_message_id,message_type,content FROM messages WHERE tenant_id='visual-burst' AND direction='inbound'").all<{ meta_message_id: string; message_type: string; content: string }>();
    expect(originals.results).toHaveLength(2);
    expect(originals.results.find(row => row.meta_message_id === image.id)).toMatchObject({ message_type: "image", content: expect.stringContaining("2 chalecos bordados") });
    expect(originals.results.find(row => row.meta_message_id === text.id)?.content).toBe(text.text);
    await processConversationTurn(inputs, testEnv, "visual-burst");
    expect(p.counts()).toEqual({ vision: 1, extraction: 1, decisions: 1 });
    expect(p.operations).not.toContain("issue_invoice");
  });
  it("preserves textual customer/payment data if the image cannot be read", async () => {
    const p = setup(true);
    await processConversationTurn([input(`RUC ${customerRuc} genera factura a crédito`), input("", "image")], testEnv, "visual-burst");
    const state = await env.DB.prepare("SELECT state_json FROM contact_role_states WHERE tenant_id='visual-burst' AND role_key='enterprise-advisor'").first<{ state_json: string }>();
    expect(JSON.parse(state!.state_json).billing).toMatchObject({ customerRuc, paymentMethod: "credito", productsText: "" });
    expect(p.decisionInputs[0]).toContain("No se pudo leer una imagen");
    expect(p.outgoing).toHaveLength(1);
    expect(p.operations).not.toContain("issue_invoice");
  });
  it("rejects a batch that mixes contacts before persistence or a provider call", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(processConversationTurn([input("Cliente uno"), { ...input("Cliente dos"), to: "51900000010" }], testEnv, "visual-burst")).rejects.toThrow("burst_invalid_conversation_or_content");
    expect(fetch).not.toHaveBeenCalled();
  });
});
