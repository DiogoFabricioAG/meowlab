import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import worker from "../src/index";

const phone = "1266091906580349";
const user = "51977777777";
const secret = "radar-routing-test-secret";
let replies: string[];
beforeEach(async () => {
  replies = [];
  await env.DB.prepare(`INSERT INTO contacts(tenant_id,whatsapp_user_id,active_role_key)
    VALUES('manolo',?,'radar') ON CONFLICT(tenant_id,whatsapp_user_id) DO UPDATE SET active_role_key='radar'`).bind(user).run();
  await env.DB.prepare("UPDATE radar_settings SET enabled=1,phone_number_id=?,public_number=? WHERE id=1").bind(phone, user).run();
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (!String(url).startsWith("https://graph.facebook.com/")) throw Error("Unexpected external provider");
    const body = JSON.parse(String(init?.body || "{}"));
    if (body.text?.body) replies.push(body.text.body);
    if (body.interactive?.body?.text) replies.push(body.interactive.body.text);
    return Response.json({ messages: [{ id: `wamid.${crypto.randomUUID()}` }] });
  }));
});
afterEach(() => vi.unstubAllGlobals());

async function dispatch(text: string, id = crypto.randomUUID(), buttonId?: string) {
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: {
    metadata: { phone_number_id: phone }, messages: [{ id, from: user, timestamp: String(Math.floor(Date.now() / 1000)),
      ...(buttonId ? { type: "interactive", interactive: { type: "button_reply", button_reply: { id: buttonId, title: text } } }
        : { type: "text", text: { body: text } }) }],
  } }] }] });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))].map(x => x.toString(16).padStart(2, "0")).join("");
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request("https://test/webhooks/whatsapp", { method: "POST", body,
    headers: { "X-Hub-Signature-256": `sha256=${signature}` } }) as Request<unknown, IncomingRequestCfProperties>, {
    ...env, META_APP_SECRET: secret, META_ACCESS_TOKEN: "test-token", META_GRAPH_API_VERSION: "v25.0",
    OPENAI_API_KEY: "test-ai-key", ENTERPRISE_AI_BASE_URL: "https://api.openai.com/v1",
    WHATSAPP_PHONE_NUMBER_ID: phone, VPS_BRIDGE_ENABLED: "false", VPS_PLATFORM_SHADOW_ENABLED: "false", WHATSAPP_BURST_ENABLED: "false",
  }, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

it("routes an assigned contact through the real RADAR handler without FacturaYa", async () => {
  expect((await dispatch("RADAR AYUDA")).status).toBe(200);
  expect(replies.join(" ")).toContain("Soy RADAR");
  expect(replies.join(" ")).not.toContain("FacturaYa");
});

it("consumes activation controls before a fiscal contact and does not change their role", async () => {
  await env.DB.prepare("UPDATE contacts SET active_role_key='enterprise-advisor' WHERE tenant_id='manolo' AND whatsapp_user_id=?").bind(user).run();
  const id = crypto.randomUUID();
  expect((await dispatch("RADAR\nACTIVAR invalid", id)).status).toBe(200);
  expect(replies.join(" ")).toContain("Ajustes");
  expect(replies.join(" ")).not.toContain("FacturaYa");
  const count = replies.length;
  await dispatch("RADAR\nACTIVAR invalid", id);
  expect(replies.length).toBe(count);
  const contact = await env.DB.prepare("SELECT active_role_key FROM contacts WHERE tenant_id='manolo' AND whatsapp_user_id=?").bind(user).first();
  expect(contact?.active_role_key).toBe("enterprise-advisor");
});

it("composes AI alert writing and context-aware follow-up through the real Worker", async () => {
  const aiInputs: string[] = [];
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (String(url).includes("graph.facebook.com")) {
      const body = JSON.parse(String(init?.body || "{}"));
      if (body.text?.body) replies.push(body.text.body);
      if (body.interactive?.body?.text) replies.push(body.interactive.body.text);
      return Response.json({ messages: [{ id: `wamid.${crypto.randomUUID()}` }] });
    }
    if (String(url).includes("api.openai.com") || String(url).includes("api.groq.com")) {
      const body = JSON.parse(String(init?.body || "{}"));
      aiInputs.push(JSON.stringify(body.messages));
      const request = JSON.parse(String(init?.body || "{}"));
      const text = "Warmi Nan busca proveedores de chalecos institucionales.";
      return Response.json({ choices: [{ message: { role: "assistant", content: request.response_format
        ? JSON.stringify({ what: text, purpose: null, objectQuote: "CHALECOS INSTITUCIONALES", purposeQuote: null }) : text } }] });
    }
    throw Error("Unexpected provider");
  });
  const api = async (path: string, body: unknown, token = "") => {
    const ctx = createExecutionContext();
    const result = await worker.fetch(new Request(`https://test/v1/projects/radar${path}`, { method: "POST",
      headers: { Authorization: `Bearer ${token}`, "CF-Connecting-IP": crypto.randomUUID() }, body: JSON.stringify(body) }) as Request<unknown, IncomingRequestCfProperties>, {
      ...env, META_APP_SECRET: secret, META_ACCESS_TOKEN: "test-token", META_GRAPH_API_VERSION: "v25.0", OPENAI_API_KEY: "test-ai-key",
      WHATSAPP_PHONE_NUMBER_ID: phone, VPS_BRIDGE_ENABLED: "false", VPS_PLATFORM_SHADOW_ENABLED: "false", WHATSAPP_BURST_ENABLED: "false",
    }, ctx);
    await waitOnExecutionContext(ctx); return result;
  };
  const registration = await (await api("/installations", {})).json() as { message: string; token: string };
  await dispatch(registration.message);
  const alert = { ocid: "ocds-routing-123", code: "TEST-2026", description: "ADQUISICION DE CHALECOS INSTITUCIONALES", buyer: "Programa Warmi Nan",
    amount: "Monto por confirmar", deadline: "2026-11-03T23:59:00-05:00", sourceUrl: "https://contratacionesabiertas.oece.gob.pe" };
  expect(await (await api("/alerts", alert, registration.token)).json()).toMatchObject({ status: "accepted" });
  expect(replies.at(-1)).toContain("Warmi Nan busca proveedores");
  expect(replies.at(-1)).not.toContain(alert.ocid);
  await dispatch("Me interesa");
  expect(aiInputs.at(-1)).toContain(alert.ocid);
  expect(aiInputs.at(-1)).toContain("ultimoAviso");
  expect(replies.at(-1)).not.toContain("FacturaYa");
  const outgoing = vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body || "{}")))
    .find(body => body.interactive?.action?.buttons?.[0]?.reply?.id?.startsWith("radar:alert:"));
  expect(outgoing.interactive.action.buttons.map((b: { reply: { title: string } }) => b.reply.title))
    .toEqual(["Me interesa", "Ver detalle", "Descartar"]);
  const beforeDetail = aiInputs.length;
  await dispatch("Ver detalle", crypto.randomUUID(), outgoing.interactive.action.buttons[1].reply.id);
  expect(aiInputs).toHaveLength(beforeDetail);
  expect(replies.at(-1)).toContain("*Detalle de la convocatoria*");
  expect(replies.at(-1)).toContain("*Entidad*\nPrograma Warmi Nan");
  expect(replies.at(-1)).toContain("buscadorPublico.xhtml");
});
