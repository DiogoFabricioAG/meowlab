import { env } from "cloudflare:test";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { AiRadarAlertWriter } from "../src/adapters/radar/ai-alert-writer";
import { friendlyAlertText, safeAlertDraft } from "../src/radar/presentation";
import { RadarRoleHandler } from "../src/roles/radar-role";
import type { RoleHandlerContext } from "../src/roles/contracts";
import type { AiCompletionRequest, AiProvider } from "../src/ai/contracts";
import { radarHttp } from "../src/radar/http";
import { editorialWriter } from "./radar-editorial-fixture";
import { validateAlert } from "../src/radar/contracts";
import { radarVerifiedWebhook } from "../src/radar/webhook";
import { D1RadarContactService } from "../src/adapters/radar/d1-contact-service";
import { followUpButtons, parseFollowUp } from "../src/radar/follow-up";
import { validateEvidence } from "../src/radar/evidence";
import { applyRadarAiConfig } from "../src/adapters/radar/configure-ai";

const alert = { ocid: "ocds-dgv273-seacev3-1258591", code: "LP-ABR-3-2026-WARMI NAN-1",
  description: "ADQUISICION DE CHALECOS INSTITUCIONALES", buyer: "Programa Warmi Nan", amount: "Monto por confirmar",
  deadline: "2026-11-04T04:59:00.000Z", sourceUrl: "https://contratacionesabiertas.oece.gob.pe" };
const phone = "1266091906580349", user = "51955555555";
const evidence = { sourceUrl: "https://prod4.seace.gob.pe/openegocio/#/ficha/idProceso/tipo/1258591/2",
  observedAt: "2026-10-31T14:00:00Z", items: [{ description: "Chalecos institucionales", quantity: 5856, unit: "Unidad" }],
  documents: [{ title: "Bases Integradas", url: "https://prod1.seace.gob.pe/SeaceWeb-PRO/SdescargarArchivoAlfresco?fileCode=b2d9e3d9-a48e-4a51-969e-358008e4a53f" }],
  registrationDeadline: "2026-11-03T23:59:00-05:00", offerDeadline: "2026-11-04T23:59:00-05:00" };
let clock: number;
const apiEnv = () => ({ ...env, VPS_BRIDGE_ENABLED: "false", META_ACCESS_TOKEN: "test-token", META_APP_SECRET: "test-secret", META_GRAPH_API_VERSION: "v25.0" } as Env);
const call = (path: string, token = "", data?: unknown, writer?: { draft: (value: typeof alert) => Promise<string | null> }) => radarHttp(
  new Request(`https://test/v1/projects/radar${path}`, { method: data === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token}`, "CF-Connecting-IP": crypto.randomUUID() }, body: data === undefined ? undefined : JSON.stringify(data) }), apiEnv(), () => clock, writer ?? editorialWriter);
async function setup() {
  const response = await call("/installations", "", {});
  const r = await response.json() as { token: string; message: string; installationId: string };
  await radarVerifiedWebhook({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: {
    metadata: { phone_number_id: phone }, messages: [{ id: crypto.randomUUID(), from: user, timestamp: String(clock / 1000), type: "text", text: { body: r.message } }],
  } }] }] }, apiEnv(), () => clock);
  vi.mocked(fetch).mockClear();
  return r;
}
beforeEach(async () => {
  clock = Date.parse("2026-10-31T15:00:00Z");
  await env.DB.batch(["radar_deliveries", "radar_installations", "radar_windows", "radar_inbound", "radar_rate_limits"].map(t => env.DB.prepare(`DELETE FROM ${t}`)));
  await env.DB.prepare("UPDATE radar_settings SET enabled=1,phone_number_id=?,public_number=? WHERE id=1").bind(phone, user).run();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ messages: [{ id: "wamid.conversation" }] })));
});
afterEach(() => vi.unstubAllGlobals());

it("enriches accepted alert replays with public evidence without resend, hash/TTL/window changes", async () => {
  const r = await setup(); await call("/alerts", r.token, alert);
  const original = await env.DB.prepare("SELECT * FROM radar_deliveries").first();
  const originalContext = await env.DB.prepare("SELECT created_at,expires_at FROM radar_alert_context").first();
  vi.mocked(fetch).mockClear();
  expect(await (await call("/alerts", r.token, { ...alert, evidence })).json()).toEqual({ status: "accepted", replayed: true });
  const latest = await new D1RadarContactService(env.DB, "manolo", phone, user, () => clock).latestAlert();
  expect(latest?.evidence).toEqual(evidence);
  expect(latest?.alert.sourceUrl).toBe(alert.sourceUrl); // Original hash inputs retained.
  expect(await env.DB.prepare("SELECT * FROM radar_deliveries").first()).toEqual(original);
  expect(await env.DB.prepare("SELECT created_at,expires_at FROM radar_alert_context").first()).toEqual(originalContext);
  expect(fetch).not.toHaveBeenCalled();
  expect((await call("/alerts", r.token, { ...alert, evidence: { ...evidence, sourceUrl: evidence.sourceUrl.replace("1258591", "999") } })).status).toBe(400);
});

it("rejects untrusted evidence and routes RADAR AI independently of inherited tenant provider", () => {
  expect(validateEvidence(evidence, alert.ocid)).toEqual(evidence);
  expect(validateEvidence({ ...evidence, items: [{ description: "x", quantity: -1, unit: null }] }, alert.ocid)).toBeNull();
  expect(validateEvidence({ ...evidence, documents: [{ title: "secret", url: "https://localhost/x" }] }, alert.ocid)).toBeNull();
  const c = dialogue(); c.tenant.roleKey = "radar"; c.tenant.aiProvider = "groq";
  applyRadarAiConfig(c.tenant, { ...env, ENTERPRISE_AI_PROVIDER: "openai", ENTERPRISE_AI_MODEL: "gpt-6-luna" } as Env);
  expect(c.tenant).toMatchObject({ aiProvider: "openai", aiModel: "gpt-6-luna", aiReasoningEffort: "low", maxTokens: 1600 });
  c.tenant.roleKey = "cat"; c.tenant.aiProvider = "groq";
  applyRadarAiConfig(c.tenant, {} as Env); expect(c.tenant.aiProvider).toBe("groq");
});

it("previews an accepted alert once without unlocking automatic deduplication or renewing the window", async () => {
  const r = await setup();
  expect((await call("/alerts/preview", r.token, alert)).status).toBe(409);
  await call("/alerts", r.token, alert);
  const original = await env.DB.prepare("SELECT * FROM radar_deliveries").first();
  const window = await env.DB.prepare("SELECT * FROM radar_windows").first();
  // A real text preview is retained; the new server-defined format is independent.
  await env.DB.prepare(`INSERT INTO radar_alert_previews(delivery_id,state,provider_message_id,created_at)
    VALUES(?,'accepted','wamid.legacy.preview',?)`).bind(original!.id, clock).run();
  const legacy = await env.DB.prepare("SELECT * FROM radar_alert_previews").first();
  vi.mocked(fetch).mockClear();
  const draft = vi.fn(async () => "Warmi Nan busca chalecos institucionales.");
  expect(await (await call("/alerts/preview", r.token, alert, { draft })).json()).toEqual({ status: "accepted" });
  expect(await (await call("/alerts/preview", r.token, alert, { draft })).json()).toEqual({ status: "accepted", replayed: true });
  expect(draft).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledOnce();
  const outgoing = JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body));
  expect(outgoing.type).toBe("interactive");
  expect(outgoing.interactive.body.text).toContain("¿Te interesa?");
  expect(outgoing.interactive.action.buttons).toHaveLength(3);
  expect(await env.DB.prepare("SELECT * FROM radar_deliveries").first()).toEqual(original);
  expect(await env.DB.prepare("SELECT * FROM radar_windows").first()).toEqual(window);
  expect(await env.DB.prepare("SELECT * FROM radar_alert_previews").first()).toEqual(legacy);
  expect(await env.DB.prepare("SELECT format,state FROM radar_alert_preview_versions").first())
    .toEqual({ format: "buttons-v1", state: "accepted" });
});

it("checks preview ownership, exact facts, expiry after generation and never retries uncertainty", async () => {
  const r = await setup(); await call("/alerts", r.token, alert);
  expect((await call("/alerts/preview", r.token, { ...alert, description: "Different" })).status).toBe(409);
  vi.mocked(fetch).mockClear();
  expect(await (await call("/alerts/preview", r.token, alert, { draft: async () => {
    clock += 86400000; return null;
  } })).json()).toEqual({ status: "window_closed" });
  expect(fetch).not.toHaveBeenCalled();
  const next = await setup();
  vi.mocked(fetch).mockResolvedValue(Response.json({ messages: [{ id: "wamid.other" }] }));
  expect(await (await call("/alerts", next.token, { ...alert, ocid: "ocds-dgv273-seacev3-1258592" })).json()).toEqual({ status: "accepted" });
  const other = { ...alert, ocid: "ocds-dgv273-seacev3-1258592" };
  vi.mocked(fetch).mockClear(); vi.mocked(fetch).mockRejectedValue(Error("timeout"));
  expect(await (await call("/alerts/preview", next.token, other)).json()).toEqual({ status: "unknown" });
  expect(await (await call("/alerts/preview", next.token, other)).json()).toEqual({ status: "unknown", replayed: true });
  expect(fetch).toHaveBeenCalledOnce();
});

it("drafts with public object/buyer only and never asks AI to invent affinity", async () => {
  const complete = vi.fn(async (_request: AiCompletionRequest) => JSON.stringify({ what: "Warmi Nan busca proveedores de chalecos institucionales.",
    purpose: null, objectQuote: "CHALECOS INSTITUCIONALES", purposeQuote: null }));
  const writer = new AiRadarAlertWriter({ key: "test", complete }, "configured-model");
  expect(await writer.draft(alert)).toContain("chalecos");
  const request = complete.mock.calls[0]![0] as unknown as AiCompletionRequest;
  expect(JSON.parse(String(request.messages[1]!.content))).toEqual({ objeto: alert.description, comprador: alert.buyer });
  expect(JSON.stringify(request)).not.toContain(alert.ocid);
  expect(JSON.stringify(request)).not.toContain(alert.amount);
});

it("keeps dates deterministic in Peru, omits technical IDs and invites a genuine reply", () => {
  const text = friendlyAlertText(alert, "Warmi Nan busca proveedores de chalecos institucionales.");
  expect(text).toContain("3 de noviembre de 2026");
  expect(text).toMatch(/11:59/);
  expect(text).toContain("¿Te interesa?");
  expect(text).not.toContain("2026-11-04T");
  expect(text).not.toContain(alert.ocid);
  expect(text).not.toContain(alert.code);
  expect(text).not.toContain("http");
  for (const draft of ["Ganarás 100 soles", "Tienes adjudicación garantizada", "Abre https://bad.test", "Compras con margen alto"]) expect(safeAlertDraft(draft)).toBeNull();
  expect(safeAlertDraft("Warmi Nan busca proveedores de computadoras.", alert)).toBeNull();
});

it("requires an editorial draft on absent provider, exception or bounded generation timeout", async () => {
  expect(await new AiRadarAlertWriter(null, "test").draft(alert)).toBeNull();
  expect(await new AiRadarAlertWriter({ key: "test", complete: async () => { throw Error("private"); } }, "test").draft(alert)).toBeNull();
  expect(await new AiRadarAlertWriter({ key: "test", complete: () => new Promise(() => {}) }, "test", 10).draft(alert)).toBeNull();
  expect(() => friendlyAlertText(alert, null)).toThrow("editorial_summary_required");
});

it("accepts the desktop's exact official SEACE detail and rejects other IDs/hosts", () => {
  const sourceUrl = "https://prod4.seace.gob.pe/openegocio/#/ficha/idProceso/tipo/1258591/2";
  expect(validateAlert({ ...alert, sourceUrl })).not.toBeNull();
  expect(validateAlert({ ...alert, sourceUrl: sourceUrl.replace("1258591", "999") })).toBeNull();
  expect(validateAlert({ ...alert, sourceUrl: sourceUrl.replace("prod4.seace.gob.pe", "example.test") })).toBeNull();
});

it("freezes the text/context, preserves idempotency and does not renew the window on outbound", async () => {
  const r = await setup();
  const original = await env.DB.prepare("SELECT last_user_message_at FROM radar_windows WHERE recipient=?").bind(user).first();
  const draft = vi.fn(async () => "Warmi Nan busca chalecos institucionales.");
  expect(await (await call("/alerts", r.token, alert, { draft })).json()).toMatchObject({ status: "accepted" });
  expect(await (await call("/alerts", r.token, alert, { draft })).json()).toMatchObject({ status: "accepted", replayed: true });
  expect(draft).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledOnce();
  const latest = await new D1RadarContactService(env.DB, "manolo", phone, user, () => clock).latestAlert();
  expect(latest?.alert.ocid).toBe(alert.ocid);
  expect(await env.DB.prepare("SELECT last_user_message_at FROM radar_windows WHERE recipient=?").bind(user).first()).toEqual(original);
  expect(await new D1RadarContactService(env.DB, "other-tenant", phone, user, () => clock).latestAlert()).toBeNull();
  expect(await new D1RadarContactService(env.DB, "manolo", phone, "51944444444", () => clock).latestAlert()).toBeNull();
  clock += 48 * 3600000;
  expect(await new D1RadarContactService(env.DB, "manolo", phone, user, () => clock).latestAlert()).toBeNull();
});

it("rechecks the clock and revocation after generation and exposes no rejected alert context", async () => {
  const r = await setup();
  const result = await call("/alerts", r.token, alert, { draft: async () => {
    clock += 86400000;
    return "Warmi Nan busca chalecos institucionales.";
  } });
  expect(await result.json()).toMatchObject({ status: "window_closed" });
  expect(fetch).not.toHaveBeenCalled();
  expect(await new D1RadarContactService(env.DB, "manolo", phone, user, () => clock).latestAlert()).toBeNull();
});

it("reuses the prepared draft after a definitive refusal, without recharging generation", async () => {
  const r = await setup();
  vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 400 }));
  const draft = vi.fn(async () => "Warmi Nan busca chalecos institucionales.");
  expect(await (await call("/alerts", r.token, alert, { draft })).json()).toMatchObject({ status: "rejected" });
  expect(await (await call("/alerts", r.token, alert, { draft })).json()).toMatchObject({ status: "accepted" });
  expect(draft).toHaveBeenCalledOnce();
});

it("restores public facts for a legacy accepted alert without another send or TTL refresh", async () => {
  const r = await setup(); const sentAt = clock;
  await call("/alerts", r.token, alert);
  await env.DB.prepare("DELETE FROM radar_alert_context").run();
  vi.mocked(fetch).mockClear(); clock += 3600000;
  const draft = vi.fn(async () => "Warmi Nan busca chalecos institucionales.");
  expect(await (await call("/alerts", r.token, alert, { draft })).json()).toMatchObject({ replayed: true, status: "accepted" });
  expect(fetch).not.toHaveBeenCalled(); expect(draft).not.toHaveBeenCalled();
  const context = await new D1RadarContactService(env.DB, "manolo", phone, user, () => clock).latestAlert();
  expect(context?.sentAt).toBe(sentAt); expect(context?.expiresAt).toBe(sentAt + 48 * 3600000);
});

it("does not send or expose context after consent is revoked during AI generation", async () => {
  const r = await setup();
  const response = await call("/alerts", r.token, alert, { draft: async () => {
    await env.DB.prepare("UPDATE radar_installations SET revoked_at=? WHERE id=?").bind(clock, r.installationId).run();
    return "Warmi Nan busca chalecos institucionales.";
  } });
  expect(await response.json()).toMatchObject({ status: "window_closed" });
  expect(fetch).not.toHaveBeenCalled();
  expect(await new D1RadarContactService(env.DB, "manolo", phone, user, () => clock).latestAlert()).toBeNull();
});

function dialogue() {
  let saved: string | null = null;
  const complete = vi.fn(async (_request: AiCompletionRequest) => "Podemos revisar el plazo o cómo consultar las bases en RADAR. ¿Qué necesitas?");
  const context = {
    message: { id: "turn-one", phoneNumberId: phone, text: "Me interesa" },
    tenant: { tenantId: "manolo", aiModel: "test", systemPrompt: "RADAR", maxTokens: 400, temperature: 0.2 },
    persisted: { duplicate: false, contactId: 42 }, reply: vi.fn(async () => {}), log: vi.fn(),
    history: [{ role: "assistant", content: "PRIVATE_FISCAL_HISTORY" }],
    ai: { key: "test", complete } as AiProvider,
    radar: { latestAlert: vi.fn(async () => ({ alert, sentAt: Date.now(), expiresAt: Date.now() + 3600000 })) },
    roleState: { get: vi.fn(async () => saved), compareAndSet: vi.fn(async (_t: string, _c: number, _r: string, expected: string | null, next: string | null) => { if (expected !== saved) return false; saved = next; return true; }) },
  } as unknown as RoleHandlerContext & { ai: { complete: typeof complete }; reply: ReturnType<typeof vi.fn> };
  return context;
}

it("legacy summary buttons show expanded facts and the complete source without another AI summary", async () => {
  const c = dialogue(), id = crypto.randomUUID();
  c.ai.complete.mockResolvedValue("Resumen de negocio. ".repeat(150));
  c.radar!.alertById = vi.fn(async () => ({ deliveryId: id, alert, evidence, sentAt: Date.now(), expiresAt: Date.now() + 3600000 }));
  c.message.interactionId = `radar:alert:${id}:summary`;
  const sendButtons = vi.fn<NonNullable<RoleHandlerContext["sendButtons"]>>(async () => ({ status: "sent", metaMessageId: "wamid.summary" }));
  c.sendButtons = sendButtons;
  await new RadarRoleHandler().handle(c);
  const reply = c.reply.mock.calls[0]![0];
  expect(reply).toContain(evidence.sourceUrl);
  expect(reply).toContain("Fuente SEACE");
  expect(reply.length).toBeLessThanOrEqual(3500);
  expect(reply).not.toContain("buscadorPublico");
  expect(reply).toContain("Productos y cantidades");
  expect(reply).toContain(evidence.documents[0]!.url);
  expect(sendButtons).not.toHaveBeenCalled();
  expect(c.ai.complete).not.toHaveBeenCalled();
});

it("labels the SEACE search fallback and nomenclature when summary has no verified ficha", async () => {
  const c = dialogue(), id = crypto.randomUUID();
  c.ai.complete.mockResolvedValue(null as unknown as string);
  c.radar!.alertById = vi.fn(async () => ({ deliveryId: id, alert, sentAt: Date.now(), expiresAt: Date.now() + 3600000 }));
  c.message.interactionId = `radar:alert:${id}:summary`;
  await new RadarRoleHandler().handle(c);
  const reply = c.reply.mock.calls[0]![0];
  expect(reply).toContain("Ficha específica pendiente de verificar");
  expect(reply).toContain("buscadorPublico.xhtml");
  expect(reply).toContain(alert.code);
  expect(reply.length).toBeLessThanOrEqual(1024);
});

it("answers info/products/source differently with real quantities and exact sources when AI fails", async () => {
  const c = dialogue(), id = crypto.randomUUID(), role = new RadarRoleHandler();
  c.ai.complete.mockResolvedValue(null as unknown as string);
  c.radar!.alertById = vi.fn(async () => ({ deliveryId: id, alert, evidence, sentAt: Date.now(), expiresAt: Date.now() + 3600000 }));
  c.message.interactionId = `radar:alert:${id}:info`; await role.handle(c);
  const info = c.reply.mock.calls.at(-1)![0] as string;
  expect(info).toContain("Registro de participantes"); expect(info).toContain("3 de noviembre de 2026");
  expect(info).toContain("Presentación de ofertas"); expect(info).toContain("4 de noviembre de 2026");
  c.message.id = "products"; c.message.interactionId = `radar:alert:${id}:products`; await role.handle(c);
  const products = c.reply.mock.calls.at(-1)![0] as string;
  expect(products).toMatch(/5[.,]856/); expect(products).not.toBe(info);
  expect(products).toContain("tallas, materiales");
  c.message.id = "source"; c.message.interactionId = `radar:alert:${id}:source`; await role.handle(c);
  const source = c.reply.mock.calls.at(-1)![0] as string;
  expect(source).toContain(evidence.sourceUrl); expect(source).toContain(evidence.documents[0]!.url);
  expect(source).not.toContain("buscadorPublico");
});

it("keeps three short, process-scoped reply buttons and rejects unknown actions", () => {
  const id = crypto.randomUUID();
  const buttons = followUpButtons(id);
  expect(buttons.map(b => b.title)).toEqual(["Me interesa", "Ver detalle", "Descartar"]);
  expect(buttons.every(b => b.title.length <= 20 && b.id.length <= 256)).toBe(true);
  expect(parseFollowUp(buttons[1]!.id)).toEqual({ deliveryId: id, action: "detail" });
  expect(parseFollowUp(`radar:alert:${id}:delete`)).toBeNull();
  expect(followUpButtons("not-a-delivery")).toEqual([]);
  expect(parseFollowUp(`radar:alert:${id}:source`)).toEqual({ deliveryId: id, action: "source" });
});

it("resolves the selected accepted alert with contact/tenant checks instead of switching to the newest", async () => {
  const r = await setup(); await call("/alerts", r.token, alert);
  const service = new D1RadarContactService(env.DB, "manolo", phone, user, () => clock);
  const first = (await service.latestAlert())!;
  clock += 30 * 60_000;
  vi.mocked(fetch).mockResolvedValue(Response.json({ messages: [{ id: "wamid.newest" }] }));
  await call("/alerts", r.token, { ...alert, ocid: "ocds-dgv273-seacev3-9999", description: "NEWEST_PROCESS" });
  expect((await service.latestAlert())?.alert.description).toBe("NEWEST_PROCESS");
  expect((await service.alertById(first.deliveryId!))?.alert.description).toBe(alert.description);
  expect(await new D1RadarContactService(env.DB, "other-tenant", phone, user, () => clock).alertById(first.deliveryId!)).toBeNull();
  expect(await new D1RadarContactService(env.DB, "manolo", phone, "51944444444", () => clock).alertById(first.deliveryId!)).toBeNull();
  clock += 48 * 3600000;
  expect(await service.alertById(first.deliveryId!)).toBeNull();
});

it("translates product clicks into grounded follow-up, pins later text and returns useful buttons", async () => {
  const c = dialogue(), id = crypto.randomUUID();
  const chosen = { deliveryId: id, alert, sentAt: Date.now(), expiresAt: Date.now() + 3600000 };
  c.radar!.alertById = vi.fn(async () => chosen);
  c.message.interactionId = `radar:alert:${id}:products`;
  c.message.text = c.message.interactionId;
  c.sendButtons = vi.fn(async () => ({ status: "sent" as const, metaMessageId: "wamid.follow" }));
  const role = new RadarRoleHandler(); await role.handle(c);
  const input = JSON.stringify(c.ai.complete.mock.calls[0]![0]);
  expect(input).toContain("Quiero revisar los productos solicitados");
  expect(input).toContain("No inventes un desglose");
  expect(input).not.toContain(c.message.interactionId);
  expect(c.sendButtons).toHaveBeenCalledOnce(); expect(c.reply).not.toHaveBeenCalled();
  c.message.id = "follow-text"; c.message.interactionId = null; c.message.text = "Tengo capacidad para atenderlo";
  await role.handle(c);
  expect(c.radar!.alertById).toHaveBeenLastCalledWith(id);
  expect(c.radar!.latestAlert).not.toHaveBeenCalled();
  expect(JSON.stringify(c.ai.complete.mock.calls[1]![0])).toContain(alert.description);
});

it("rejects expired/foreign/forged buttons without AI or another opportunity and serves exact sources", async () => {
  const c = dialogue(), id = crypto.randomUUID(); const role = new RadarRoleHandler();
  c.radar!.alertById = vi.fn(async () => null);
  c.message.interactionId = `radar:alert:${id}:info`;
  await role.handle(c);
  expect(c.ai.complete).not.toHaveBeenCalled();
  expect(c.radar!.latestAlert).not.toHaveBeenCalled();
  expect(c.reply).toHaveBeenLastCalledWith(expect.stringContaining("ya no está disponible"));
  c.message.interactionId = `radar:alert:${id}:delete`;
  await role.handle(c); expect(c.ai.complete).not.toHaveBeenCalled();
  c.radar!.alertById = vi.fn(async () => ({ deliveryId: id, alert, sentAt: Date.now(), expiresAt: Date.now() + 3600000 }));
  c.message.interactionId = `radar:alert:${id}:source`;
  await role.handle(c);
  expect(c.reply).toHaveBeenLastCalledWith(expect.stringContaining(alert.sourceUrl));
  expect(c.ai.complete).not.toHaveBeenCalled();
});

it("follows 'me interesa' using the delivered facts and role-only history", async () => {
  const c = dialogue(); const role = new RadarRoleHandler();
  await role.handle(c);
  const first = JSON.stringify(c.ai.complete.mock.calls[0]![0]);
  expect(first).toContain(alert.description); expect(first).not.toContain("PRIVATE_FISCAL_HISTORY");
  c.message.id = "turn-two"; c.message.text = "El plazo";
  await role.handle(c);
  expect(JSON.stringify(c.ai.complete.mock.calls[1]![0])).toContain("Me interesa");
  expect(c.roleState!.compareAndSet).toHaveBeenLastCalledWith("manolo", 42, "radar", expect.any(String), expect.any(String));
});

it("does not answer duplicate turns and does not carry context across channels", async () => {
  const c = dialogue(); const role = new RadarRoleHandler();
  await role.handle(c); await role.handle(c);
  expect(c.ai.complete).toHaveBeenCalledOnce(); expect(c.reply).toHaveBeenCalledOnce();
  c.message.id = "second-channel"; c.message.phoneNumberId = "other-channel"; c.message.text = "Otra consulta";
  c.radar = null;
  await role.handle(c);
  expect(JSON.stringify(c.ai.complete.mock.calls[1]![0])).not.toContain("Me interesa");
  expect(JSON.stringify(c.ai.complete.mock.calls[1]![0])).not.toContain(alert.ocid);
  c.persisted.duplicate = true;
  await role.handle(c); expect(c.ai.complete).toHaveBeenCalledTimes(2);
});

it("expires role memory instead of importing old turns or fiscal history", async () => {
  const c = dialogue();
  c.radar = null;
  c.roleState!.get = vi.fn(async () => JSON.stringify({ version: 1, channel: phone, expiresAt: Date.now() - 1,
    lastMessageId: "old", turns: [{ role: "user", content: "EXPIRED_PRIVATE_TURN" }] }));
  await new RadarRoleHandler().handle(c);
  const request = JSON.stringify(c.ai.complete.mock.calls[0]![0]);
  expect(request).not.toContain("EXPIRED_PRIVATE_TURN");
  expect(request).not.toContain("PRIVATE_FISCAL_HISTORY");
});
