import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoleHandlerContext, TenantContext } from "../src/roles/contracts";
import { roleRegistry } from "../src/roles/registry";
import { RadarRoleHandler, RADAR_SYSTEM_PROMPT } from "../src/roles/radar-role";
import { D1RadarContactService } from "../src/adapters/radar/d1-contact-service";

const tenant: TenantContext = { tenantId: "manolo", phoneNumberId: "1266091906580349", roleKey: "enterprise-advisor",
  systemPrompt: "fiscal", aiProvider: "groq", aiModel: "test", temperature: 0.8, maxTokens: 180 };
const handler = new RadarRoleHandler();
function context(text: string) {
  return {
    tenant: handler.configure(tenant), message: { text }, reply: vi.fn(async () => {}),
    generateAiReply: vi.fn(async () => "Revisa las bases en RADAR."),
    generateAiReplyWithHistory: vi.fn(async () => "Historia fiscal"),
    log: vi.fn(), radar: { status: vi.fn(async () => ({ available: true, linked: true, open: true, expiresAt: 123 })) },
  } as unknown as RoleHandlerContext & { reply: ReturnType<typeof vi.fn>; generateAiReply: ReturnType<typeof vi.fn> };
}

describe("RADAR first-class role", () => {
  it("is selectable by the shared registry without replacing fiscal or fallback roles", () => {
    expect(roleRegistry.keys()).toContain("radar");
    expect(roleRegistry.resolve("radar")).toBeInstanceOf(RadarRoleHandler);
    expect(roleRegistry.resolve("enterprise-advisor").key).toBe("enterprise-advisor");
    expect(roleRegistry.resolve("unknown").key).toBe("cat");
    const configured = roleRegistry.apply(tenant, "radar");
    expect(configured.systemPrompt).toBe(RADAR_SYSTEM_PROMPT);
    expect(configured.roleKey).toBe("radar");
    expect(tenant.roleKey).toBe("enterprise-advisor");
  });

  it("reports only real status, and does not call AI for status or pairing controls", async () => {
    const c = context("RADAR ESTADO");
    await handler.handle(c);
    expect(c.radar!.status).toHaveBeenCalledOnce();
    expect(c.reply).toHaveBeenCalledWith(expect.stringContaining("vinculado"));
    expect(c.generateAiReply).not.toHaveBeenCalled();
    c.message.text = "RADAR ACTIVAR invalid";
    await handler.handle(c);
    expect(c.generateAiReply).not.toHaveBeenCalled();
    expect(c.reply).toHaveBeenLastCalledWith(expect.stringContaining("Ajustes"));
  });

  it("never leaks status errors or switches contacts, even when service is unavailable", async () => {
    const c = context("RADAR ESTADO");
    c.radar = { status: vi.fn(async () => { throw Error("database token secret"); }) };
    await handler.handle(c);
    expect(c.reply).toHaveBeenCalledWith(expect.stringContaining("No pude"));
    expect(JSON.stringify(c.reply.mock.calls)).not.toContain("secret");
    expect(c.generateAiReply).not.toHaveBeenCalled();
  });

  it("answers under RADAR without passing prior fiscal history or invoking FacturaYa", async () => {
    const c = context("¿Qué reviso en una convocatoria?");
    await handler.handle(c);
    expect(c.generateAiReply).toHaveBeenCalledOnce();
    expect(c.generateAiReplyWithHistory).not.toHaveBeenCalled();
    expect(c.reply).toHaveBeenCalledWith("Revisa las bases en RADAR.");
  });

  it("uses a RADAR-specific fallback if AI is unavailable", async () => {
    const c = context("Hola");
    c.generateAiReply.mockResolvedValue(null);
    await handler.handle(c);
    expect(c.reply).toHaveBeenCalledWith(expect.stringContaining("Soy RADAR"));
  });
});

describe("RADAR contact adapter isolation", () => {
  const now = Date.parse("2026-10-31T14:00:00Z");
  const user = "51999999999";
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM radar_installations WHERE id='role-install'").run();
    await env.DB.prepare("DELETE FROM radar_windows WHERE phone_number_id=? AND recipient=?").bind(tenant.phoneNumberId, user).run();
    await env.DB.prepare("UPDATE radar_settings SET enabled=1,phone_number_id=?,public_number=? WHERE id=1")
      .bind(tenant.phoneNumberId, user).run();
    await env.DB.prepare("INSERT INTO radar_installations(id,token_hash,phone_number_id,recipient,opted_in_at,created_at) VALUES(?,?,?,?,?,?)")
      .bind("role-install", "a".repeat(64), tenant.phoneNumberId, user, now - 1000, now - 2000).run();
    await env.DB.prepare("INSERT INTO radar_windows(phone_number_id,recipient,last_user_message_at,message_id) VALUES(?,?,?,?)")
      .bind(tenant.phoneNumberId, user, now - 1000, "role-message").run();
  });
  const service = (tenantId = "manolo", recipient = user, clock = now) =>
    new D1RadarContactService(env.DB, tenantId, tenant.phoneNumberId, recipient, () => clock);

  it("queries the exact authenticated channel/contact and returns no secrets", async () => {
    const status = await service().status();
    expect(status).toMatchObject({ available: true, linked: true, open: true });
    expect(JSON.stringify(status)).not.toContain(user);
    expect(await service("another-tenant").status()).toMatchObject({ available: false, linked: false });
    expect(await service("manolo", "51988888888").status()).toMatchObject({ available: true, linked: false });
  });

  it("enforces exact 24h expiry and revocation", async () => {
    expect(await service("manolo", user, now - 1000 + 86400000).status()).toMatchObject({ linked: true, open: false });
    await env.DB.prepare("UPDATE radar_installations SET revoked_at=? WHERE id='role-install'").bind(now).run();
    expect(await service().status()).toMatchObject({ linked: false, open: false });
  });
});
