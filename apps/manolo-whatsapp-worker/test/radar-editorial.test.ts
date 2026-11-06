import { env } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AiRadarAlertWriter } from "../src/adapters/radar/ai-alert-writer";
import { friendlyAlertText, groundedAlertDraft, safeAlertDraft } from "../src/radar/presentation";
import { radarHttp } from "../src/radar/http";
import { radarVerifiedWebhook } from "../src/radar/webhook";
import type { RadarAlert } from "../src/radar/contracts";
import type { AiCompletionRequest } from "../src/ai/contracts";

const alert: RadarAlert = { ocid: "ocds-test-1262189", code: "SYNTHETIC-EDITORIAL-TEST", buyer: "Entidad de prueba",
  description: "ADQUISICION DE CEMENTO PORTLAND TIPO IP PARA EL PROYECTO: MEJORAMIENTO DEL SERVICIO DE TRANSITABILIDAD VIAL INTERURBANA EN LOS TRAMOS AP-643 CCANABAMBA - LLAÑLUCANCHA - ASILLO - EMP. AP-646 Y VILLA GLORIA - TARACCASA (MIRADOR)",
  amount: "Monto por confirmar", deadline: "2026-11-10T04:59:00Z", sourceUrl: "https://contratacionesabiertas.oece.gob.pe" };
const draft = { what: "Buscan cemento Portland tipo IP.", purpose: "Para mejorar las vías interurbanas.",
  objectQuote: "CEMENTO PORTLAND TIPO IP", purposeQuote: "MEJORAMIENTO DEL SERVICIO DE TRANSITABILIDAD VIAL INTERURBANA" };
const phone = "123456", recipient = "51999999999";
let time: number;
const runtime = (): Env => ({ ...env, VPS_BRIDGE_ENABLED: "false", META_ACCESS_TOKEN: "test-token", META_APP_SECRET: "test-secret", META_GRAPH_API_VERSION: "v25.0" });
const call = (path: string, token = "", body?: unknown, writer?: { draft: () => Promise<string | null> }) => radarHttp(new Request(`https://example.test/v1/projects/radar${path}`, {
  method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "CF-Connecting-IP": crypto.randomUUID() },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}), runtime(), () => time, writer);
async function linked() {
  const registration = await (await call("/installations", "", {})).json() as { token: string; message: string };
  await radarVerifiedWebhook({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: phone }, messages: [
    { id: crypto.randomUUID(), from: recipient, timestamp: String(time / 1000), type: "text", text: { body: registration.message } },
  ] } }] }] }, runtime(), () => time);
  vi.mocked(fetch).mockClear(); return registration.token;
}
beforeEach(async () => {
  time = Date.parse("2026-11-04T15:00:00Z");
  await env.DB.batch(["radar_deliveries", "radar_installations", "radar_windows", "radar_inbound", "radar_rate_limits"].map(table => env.DB.prepare(`DELETE FROM ${table}`)));
  await env.DB.prepare("UPDATE radar_settings SET enabled=1,phone_number_id=?,public_number=? WHERE id=1").bind(phone, recipient).run();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ messages: [{ id: "wamid." + crypto.randomUUID() }] })));
});
afterEach(() => vi.unstubAllGlobals());

it("turns the long cement project into understandable object and purpose blocks, without an official-title fallback", async () => {
  const complete = vi.fn(async (_request: AiCompletionRequest) => JSON.stringify(draft));
  const writer = new AiRadarAlertWriter({ key: "test", complete }, "configured-model");
  const summary = await writer.draft(alert);
  expect(summary).toBe("Buscan cemento Portland tipo IP.\n\nPara mejorar las vías interurbanas.");
  const body = friendlyAlertText(alert, summary);
  expect(body).toContain("*Qué necesitan*\nBuscan cemento Portland tipo IP.");
  expect(body).toContain("*Para qué*\nPara mejorar las vías interurbanas.");
  for (const unwanted of ["AP-643", "AP-646", "CCANABAMBA", "TARACCASA", "…", "SYNTHETIC-EDITORIAL-TEST"])
    expect(body).not.toContain(unwanted);
  expect(complete.mock.calls[0]![0].responseFormat).toMatchObject({ type: "json_schema", json_schema: { strict: true } });
});

it("allows paraphrases and product designations while rejecting invented subject, unsupported purpose and numbers", () => {
  expect(groundedAlertDraft(draft, alert)).not.toBeNull();
  expect(groundedAlertDraft({ ...draft, purpose: "Para mejorar caminos que conectan localidades." }, alert)).not.toBeNull();
  expect(groundedAlertDraft({ ...draft, what: "Buscan computadoras." }, alert)).toBeNull();
  expect(groundedAlertDraft({ ...draft, what: "Buscan un cementerio." }, alert)).toBeNull();
  expect(groundedAlertDraft({ ...draft, purposeQuote: "CONSTRUIR UN HOSPITAL" }, alert)).toBeNull();
  expect(groundedAlertDraft({ ...draft, purposeQuote: null }, alert)).toBeNull();
  expect(groundedAlertDraft({ ...draft, what: "Buscan 100 toneladas de cemento." }, alert)).toBeNull();
  expect(groundedAlertDraft({ ...draft, what: "Cemento para AP-643." }, alert)).toBeNull();
  expect(groundedAlertDraft({ ...draft, what: "Adquisición de cemento para el proyecto…" }, alert)).toBeNull();
  const paper = { ...alert, description: "PAPEL BOND A4" };
  expect(safeAlertDraft("Buscan papel bond A4.", paper)).not.toBeNull();
  expect(safeAlertDraft("Buscan papel bond A3.", paper)).toBeNull();
  expect(groundedAlertDraft({ what: "Buscan cemento Portland tipo IP.", purpose: null, objectQuote: "CEMENTO PORTLAND TIPO IP", purposeQuote: null }, alert)).not.toBeNull();
});

it("sends only public item descriptions to the editor and accepts an item-backed subject", async () => {
  const evidence = { sourceUrl: "https://prod4.seace.gob.pe/openegocio/#/ficha/idProceso/tipo/1262189/2", observedAt: "2026-11-04T15:00:00Z",
    items: [{ description: "Cemento Portland tipo IP", quantity: 500, unit: "bolsa" }], documents: [] };
  const generic = { ...alert, description: "SUMINISTRO DE MATERIALES PARA OBRA" };
  const complete = vi.fn(async (_request: AiCompletionRequest) => JSON.stringify({ ...draft, purpose: null, purposeQuote: null, objectQuote: "Cemento Portland tipo IP" }));
  expect(await new AiRadarAlertWriter({ key: "test", complete }, "configured-model").draft(generic, evidence)).toContain("cemento");
  const input = JSON.parse(String(complete.mock.calls[0]![0].messages[1]!.content));
  expect(input.productosPublicados).toEqual([{ descripcion: "Cemento Portland tipo IP" }]);
  expect(JSON.stringify(input)).not.toContain("500"); expect(input).not.toHaveProperty("profile");
});

it.each(["absent", "timeout", "invalid", "failure"])("keeps %s composition pending, sends nothing and safely retries", async mode => {
  const token = await linked();
  const writer = mode === "absent" ? undefined : { draft: async () => {
    if (mode === "failure") throw Error("private-provider-detail");
    return mode === "invalid" ? "Ganancia garantizada con cemento." : null;
  } };
  const result = await call("/alerts", token, alert, writer);
  expect(result.status).toBe(503); expect(await result.json()).toEqual({ error: "composition_pending" });
  expect(fetch).not.toHaveBeenCalled();
  expect((await env.DB.prepare("SELECT state FROM radar_deliveries").first())?.state).toBe("rejected");
  const accepted = await call("/alerts", token, alert, { draft: async () => groundedAlertDraft(draft, alert) });
  expect(await accepted.json()).toMatchObject({ status: "accepted" });
  expect(fetch).toHaveBeenCalledOnce();
  const message = JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body));
  expect(message.interactive.body.text).toContain("Buscan cemento Portland tipo IP.");
  expect(message.interactive.action.buttons).toHaveLength(3);
});

it("replaces a legacy cached title on a rejected retry and freezes the edited text after acceptance", async () => {
  const token = await linked();
  const unavailable = await call("/alerts", token, alert); expect(unavailable.status).toBe(503);
  const delivery = await env.DB.prepare("SELECT id FROM radar_deliveries").first<{ id: string }>();
  await env.DB.prepare(`INSERT INTO radar_alert_context(delivery_id,facts_json,message_text,created_at,expires_at)
    VALUES(?,?,?,?,?)`).bind(delivery!.id, JSON.stringify(alert), "*Nueva oportunidad para revisar*\n\nCompra de cemento para el proyecto…", time, time + 48 * 3_600_000).run();
  const generate = vi.fn(async () => groundedAlertDraft(draft, alert));
  await call("/alerts", token, alert, { draft: generate });
  await call("/alerts", token, alert, { draft: generate });
  expect(generate).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledOnce();
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body)).interactive.body.text).not.toContain("proyecto…");
  expect((await env.DB.prepare("SELECT message_text FROM radar_alert_context WHERE delivery_id=?").bind(delivery!.id).first())?.message_text)
    .toContain("*Qué necesitan*\nBuscan cemento Portland tipo IP.");
});

it("does not consume an operator preview when composition fails", async () => {
  const token = await linked(), writer = { draft: async () => groundedAlertDraft(draft, alert) };
  await call("/alerts", token, alert, writer); vi.mocked(fetch).mockClear();
  expect((await call("/alerts/preview", token, alert, { draft: async () => null })).status).toBe(503);
  expect(await env.DB.prepare("SELECT * FROM radar_alert_preview_versions").first()).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  expect(await (await call("/alerts/preview", token, alert, writer)).json()).toMatchObject({ status: "accepted" });
  expect(fetch).toHaveBeenCalledOnce();
});
