import { env } from "cloudflare:test";
import { beforeEach, expect, it, vi } from "vitest";
import { D1RadarContactService } from "../src/adapters/radar/d1-contact-service";
import { RadarSelectionGateway } from "../src/adapters/radar/selection-client";
import { followUpButtons, parseFollowUp } from "../src/radar/follow-up";
import { radarHttp } from "../src/radar/http";
import { editorialWriter } from "./radar-editorial-fixture";
import { radarVerifiedWebhook } from "../src/radar/webhook";
import { RadarRoleHandler } from "../src/roles/radar-role";
import type { RoleHandlerContext } from "../src/roles/contracts";

const phone = "1266091906580349", user = "51955555555";
const alert = { ocid: "ocds-dgv273-seacev3-1258591", code: "LP-ABR-3-2026-WARMI NAN-1",
  description: "ADQUISICION DE CHALECOS INSTITUCIONALES", buyer: "Programa Warmi Nan", amount: "Monto por confirmar",
  deadline: "2026-11-04T04:59:00.000Z", sourceUrl: "https://contratacionesabiertas.oece.gob.pe" };
let clock: number;
const apiEnv = () => ({ ...env, VPS_BRIDGE_ENABLED: "false", META_ACCESS_TOKEN: "test-token", META_APP_SECRET: "test-secret", META_GRAPH_API_VERSION: "v25.0" } as Env);
const call = (path: string, token = "", data?: unknown) => radarHttp(new Request(`https://test/v1/projects/radar${path}`, {
  method: data === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${token}`, "CF-Connecting-IP": crypto.randomUUID() },
  body: data === undefined ? undefined : JSON.stringify(data),
}), apiEnv(), () => clock, editorialWriter);

beforeEach(async () => {
  clock = Date.parse("2026-10-31T15:00:00Z");
  await env.DB.batch(["radar_deliveries", "radar_installations", "radar_windows", "radar_inbound", "radar_rate_limits"]
    .map(t => env.DB.prepare(`DELETE FROM ${t}`)));
  await env.DB.prepare("UPDATE radar_settings SET enabled=1,phone_number_id=?,public_number=? WHERE id=1").bind(phone, user).run();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ messages: [{ id: "wamid.accepted" }] })));
});

async function acceptedDelivery() {
  const response = await call("/installations", "", {});
  const registration = await response.json() as { token: string; message: string; installationId: string };
  await radarVerifiedWebhook({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: {
    metadata: { phone_number_id: phone }, messages: [{ id: crypto.randomUUID(), from: user,
      timestamp: String(clock / 1000), type: "text", text: { body: registration.message } }],
  } }] }] }, apiEnv(), () => clock);
  await call("/alerts", registration.token, alert);
  return registration;
}

function roleContext() {
  const deliveryId = crypto.randomUUID();
  const ctx = { message: { id: "wamid.click", interactionId: null, phoneNumberId: phone, text: "", to: user, inputType: "text" },
    tenant: { tenantId: "manolo", phoneNumberId: phone, roleKey: "radar", systemPrompt: "RADAR", aiProvider: "none", aiModel: "test", temperature: 0, maxTokens: 200 },
    persisted: { duplicate: false, conversationId: "c", contactId: 42 }, env: {} as Env, ai: null, businessData: null,
    quoteNumberAllocator: null, history: [], reply: vi.fn(async () => {}), sendDocument: vi.fn(), generateAiReply: vi.fn(),
    generateAiReplyWithHistory: vi.fn(), fallbackReply: "", log: vi.fn(), radar: {
      latestAlert: vi.fn(async () => ({ deliveryId, alert, sentAt: Date.now(), expiresAt: Date.now() + 3600000 })),
      setInterest: vi.fn(async () => ({ status: "ok" as const })),
    },
  } as unknown as RoleHandlerContext;
  return ctx;
}

it("offers compact interest actions and still parses previously sent action IDs", () => {
  const id = crypto.randomUUID(), buttons = followUpButtons(id);
  expect(buttons.map(b => b.title)).toEqual(["Me interesa", "Ver detalle", "Descartar"]);
  expect(buttons.map(b => parseFollowUp(b.id)?.action)).toEqual(["interest", "detail", "dismiss"]);
  for (const action of ["info", "products", "evaluate", "source"] as const)
    expect(parseFollowUp(`radar:alert:${id}:${action}`)).toEqual({ deliveryId: id, action });
});

it("persists selection before confirmation, skips duplicate button deliveries, and reports persistence failure", async () => {
  const ctx = roleContext(), id = crypto.randomUUID(), role = new RadarRoleHandler();
  ctx.message.interactionId = `radar:alert:${id}:interest`;
  const sequence: string[] = [];
  ctx.radar!.setInterest = vi.fn(async (...args: [string, "interesting" | "dismissed", string]) => {
    sequence.push("persist"); expect(args).toEqual([id, "interesting", "wamid.click"]); return { status: "ok" as const };
  });
  ctx.reply = vi.fn(async () => { sequence.push("confirm"); });
  await role.handle(ctx);
  expect(sequence).toEqual(["persist", "confirm"]);
  expect(ctx.ai).toBeNull();
  ctx.persisted.duplicate = true;
  await role.handle(ctx);
  expect(ctx.radar!.setInterest).toHaveBeenCalledOnce();

  const failed = roleContext(); failed.message.interactionId = `radar:alert:${id}:dismiss`;
  failed.radar!.setInterest = vi.fn(async () => { throw new Error("timeout"); });
  await role.handle(failed);
  expect(failed.reply).toHaveBeenCalledWith(expect.stringContaining("volver a tocar"));
});

it("lets the model save explicit natural-language intent with only a state argument", async () => {
  const ctx = roleContext(), deliveryId = (await ctx.radar!.latestAlert!())!.deliveryId!, role = new RadarRoleHandler();
  ctx.message.text = "Guarda esta oportunidad, sí me interesa";
  const first = { content: null, toolCalls: [{ id: "call_interest", name: "set_opportunity_interest",
    arguments: JSON.stringify({ state: "interesting" }) }] };
  const completeWithTools = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce({
    content: "Listo, quedó guardada como de tu interés.", toolCalls: [],
  });
  ctx.ai = { key: "test", complete: vi.fn(), completeWithTools } as unknown as RoleHandlerContext["ai"];
  await role.handle(ctx);
  expect(completeWithTools).toHaveBeenCalledTimes(2);
  expect(completeWithTools.mock.calls[0]![0]).toMatchObject({ toolChoice: "auto", tools: [{ function: {
    name: "set_opportunity_interest", parameters: { required: ["state"], additionalProperties: false,
      properties: { state: { enum: ["interesting", "dismissed"] } } },
  } }] });
  expect(JSON.stringify(completeWithTools.mock.calls[0]![0].tools)).not.toMatch(/ocid|recipient|account|delivery/i);
  expect(ctx.radar!.setInterest).toHaveBeenCalledWith(deliveryId, "interesting", "wamid.click");
  expect(completeWithTools.mock.calls[1]![0].messages.slice(-2)).toEqual([
    { role: "assistant", content: null, toolCalls: [first.toolCalls[0]] },
    { role: "tool", name: "set_opportunity_interest", toolCallId: "call_interest", content: JSON.stringify({ ok: true, state: "interesting" }) },
  ]);
  expect(ctx.reply).toHaveBeenCalledWith("Listo, quedó guardada como de tu interés.");
});

it("does not save without a model tool call, rejects tool arguments with extra fields, and never claims a failed save", async () => {
  const role = new RadarRoleHandler();
  const idle = roleContext();
  idle.message.text = "¿Qué está comprando la entidad?";
  const noTool = vi.fn(async () => ({ content: "Busca chalecos para su programa.", toolCalls: [] }));
  idle.ai = { key: "test", complete: vi.fn(), completeWithTools: noTool } as unknown as RoleHandlerContext["ai"];
  await role.handle(idle);
  expect(idle.radar!.setInterest).not.toHaveBeenCalled();
  expect(idle.reply).toHaveBeenCalledWith("Busca chalecos para su programa.");

  const noContext = roleContext(); noContext.message.text = "Guárdala como interesante";
  noContext.radar!.latestAlert = vi.fn(async () => null);
  const noContextTool = vi.fn();
  noContext.ai = { key: "test", complete: vi.fn(async () => "No tengo un aviso actual."),
    completeWithTools: noContextTool } as unknown as RoleHandlerContext["ai"];
  await role.handle(noContext);
  expect(noContextTool).not.toHaveBeenCalled();
  expect(noContext.radar!.setInterest).not.toHaveBeenCalled();

  const duplicate = roleContext(); duplicate.message.text = "Sí, guárdala"; duplicate.persisted.duplicate = true;
  const duplicateTools = vi.fn(); duplicate.ai = { key: "test", complete: vi.fn(),
    completeWithTools: duplicateTools } as unknown as RoleHandlerContext["ai"];
  await role.handle(duplicate);
  expect(duplicateTools).not.toHaveBeenCalled();
  expect(duplicate.radar!.setInterest).not.toHaveBeenCalled();

  const invalid = roleContext(); invalid.message.text = "Me interesa";
  const malformed = vi.fn(async () => ({ content: null, toolCalls: [{ id: "call_bad", name: "set_opportunity_interest",
    arguments: JSON.stringify({ state: "interesting", ocid: "attacker-choice" }) }] }));
  invalid.ai = { key: "test", complete: vi.fn(), completeWithTools: malformed } as unknown as RoleHandlerContext["ai"];
  await role.handle(invalid);
  expect(invalid.radar!.setInterest).not.toHaveBeenCalled();
  expect(invalid.reply).toHaveBeenCalledWith(expect.stringContaining("validar esa selección"));

  const failed = roleContext(); failed.message.text = "Descártala";
  const chooseDismiss = vi.fn(async () => ({ content: null, toolCalls: [{ id: "call_dismiss", name: "set_opportunity_interest",
    arguments: JSON.stringify({ state: "dismissed" }) }] }));
  failed.ai = { key: "test", complete: vi.fn(), completeWithTools: chooseDismiss } as unknown as RoleHandlerContext["ai"];
  failed.radar!.setInterest = vi.fn(async () => ({ status: "conflict" as const }));
  await role.handle(failed);
  expect(failed.radar!.setInterest).toHaveBeenCalledOnce();
  expect(failed.reply).toHaveBeenCalledWith(expect.stringContaining("No pude confirmar"));
  expect(failed.reply).not.toHaveBeenCalledWith(expect.stringContaining("Guardé"));
});

it("persists older accepted selections without alert_context and rejects foreign or revoked ownership", async () => {
  const registration = await acceptedDelivery();
  const row = await env.DB.prepare("SELECT id FROM radar_deliveries WHERE state='accepted'").first<{ id: string }>();
  expect(row).toBeTruthy();
  await env.DB.prepare("DELETE FROM radar_alert_context WHERE delivery_id=?").bind(row!.id).run();
  const gateway = { setInterest: vi.fn(async () => ({ status: "ok" as const })) };
  const service = new D1RadarContactService(env.DB, "manolo", phone, user, () => clock, gateway);
  expect(await service.setInterest(row!.id, "interesting", "wamid.old-click")).toMatchObject({ status: "ok" });
  expect(gateway.setInterest).toHaveBeenCalledOnce();
  expect(await new D1RadarContactService(env.DB, "other-tenant", phone, user, () => clock, gateway)
    .setInterest(row!.id, "interesting", "wamid.foreign")).toEqual({ status: "forbidden" });
  await env.DB.prepare("UPDATE radar_installations SET revoked_at=? WHERE id=?").bind(clock, registration.installationId).run();
  expect(await service.setInterest(row!.id, "dismissed", "wamid.revoked")).toEqual({ status: "forbidden" });
  expect(gateway.setInterest).toHaveBeenCalledOnce();
});

it("retries uncertain VPS selection with the same Meta-derived idempotency key", async () => {
  const execute = vi.fn().mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce({
    version: 1, requestId: "radar-selection:wamid.retry", status: "ok",
    selection: { seq: 3, ocid: alert.ocid, state: "interesting", changedAt: new Date().toISOString(), candidate: { alert } },
  });
  const gateway = new RadarSelectionGateway({ execute } as never);
  const input = { tenantId: "manolo", phoneNumberId: phone, whatsappUserId: user,
    installationId: "installation", ocid: alert.ocid, state: "interesting" as const, metaMessageId: "wamid.retry" };
  await expect(gateway.setInterest(input)).rejects.toThrow();
  expect(await gateway.setInterest(input)).toMatchObject({ status: "ok", revision: 3 });
  expect(execute.mock.calls[0]![0].requestId).toBe(execute.mock.calls[1]![0].requestId);
});
