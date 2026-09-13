import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { D1ConversationRepository } from "../src/adapters/conversations/d1-repository";
import type { IncomingMessage, TenantContext } from "../src/roles/contracts";

const tenant: TenantContext = {
  tenantId: "test-quotes",
  phoneNumberId: "888888888888888",
  roleKey: "quotes",
  systemPrompt: "Asistente de cotizaciones de prueba.",
  aiProvider: "groq",
  aiModel: "llama-3.1-8b-instant",
  temperature: 0.2,
  maxTokens: 180,
};

function incomingAudio(id: string, to: string): IncomingMessage {
  return {
    id,
    interactionId: null,
    phoneNumberId: tenant.phoneNumberId,
    to,
    inputType: "audio",
    audioMediaId: "audio-test",
    audioMimeType: "audio/ogg",
    text: "",
  };
}

describe("D1ConversationRepository", () => {
  it("resuelve la configuración del tenant por número de WhatsApp", async () => {
    const repository = new D1ConversationRepository(env.DB, vi.fn());

    const result = await repository.findTenant(tenant.phoneNumberId);

    expect(result).toEqual({
      status: "found",
      tenant: {
        tenantId: tenant.tenantId,
        phoneNumberId: tenant.phoneNumberId,
        roleKey: tenant.roleKey,
        systemPrompt: tenant.systemPrompt,
        aiProvider: tenant.aiProvider,
        aiModel: tenant.aiModel,
        temperature: tenant.temperature,
        maxTokens: tenant.maxTokens,
      },
    });
  });

  it("distingue una base no configurada de un tenant inexistente", async () => {
    const unavailable = new D1ConversationRepository(undefined, vi.fn());
    const repository = new D1ConversationRepository(env.DB, vi.fn());

    await expect(unavailable.findTenant("any")).resolves.toEqual({
      status: "unavailable",
    });
    await expect(repository.findTenant("unknown-number")).resolves.toEqual({
      status: "not_found",
    });
  });

  it("mantiene deduplicación, memoria y rol activo del contacto", async () => {
    const repository = new D1ConversationRepository(env.DB, vi.fn(), {
      maxMemoryMessages: 3,
      maxMemoryMessageLength: 12,
    });
    const suffix = crypto.randomUUID();
    const whatsappUserId = `contact-${suffix}`;
    const message = incomingAudio(`wamid.${suffix}`, whatsappUserId);

    const first = await repository.persistInbound(message, tenant);
    expect(first).toMatchObject({ duplicate: false });
    expect(first.contactId).not.toBeNull();
    expect(first.conversationId).toBe(`${tenant.tenantId}:${whatsappUserId}`);

    await repository.updateInboundContent(
      message,
      tenant,
      "transcripción extensa",
    );
    await repository.persistOutbound(
      tenant,
      first.conversationId,
      "respuesta extensa",
      { status: "sent", metaMessageId: `wamid.reply.${suffix}` },
    );

    const duplicate = await repository.persistInbound(message, tenant);
    expect(duplicate.duplicate).toBe(true);

    await env.DB.prepare(
      `UPDATE contacts
       SET active_role_key = 'quotes'
       WHERE id = ?1 AND tenant_id = ?2`,
    )
      .bind(first.contactId, tenant.tenantId)
      .run();

    await expect(
      repository.resolveContactRole(tenant, first.contactId),
    ).resolves.toBe("quotes");
    await expect(repository.loadHistory(tenant, whatsappUserId)).resolves.toEqual([
      {
        role: "user",
        content: "transcripció",
        createdAt: expect.any(String),
      },
      {
        role: "assistant",
        content: "respuesta ex",
        createdAt: expect.any(String),
      },
    ]);

    const stored = await env.DB.prepare(
      `SELECT COUNT(*) AS total
       FROM messages
       WHERE tenant_id = ?1 AND meta_message_id = ?2`,
    )
      .bind(tenant.tenantId, message.id)
      .first<{ total: number }>();
    expect(stored?.total).toBe(1);
  });
});
