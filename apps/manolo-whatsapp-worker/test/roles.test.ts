import { describe, expect, it, vi } from "vitest";
import {
  CAT_CHAT_ACTIVATED_MESSAGE,
  CAT_ROLE_KEY,
  CAT_SYSTEM_PROMPT,
  CatRoleHandler,
  ENTERPRISE_ACTIVATION_MESSAGE,
  ONBOARDING_CAT_BUTTON_ID,
  ONBOARDING_ENTERPRISE_BUTTON_ID,
  ONBOARDING_MENU_BUTTON_ID,
  ONBOARDING_PENDING_BUTTONS,
  ONBOARDING_QUOTES_BUTTON_ID,
  ONBOARDING_ROLE_BUTTONS,
  ONBOARDING_WELCOME_MESSAGE,
  QUOTES_ACTIVATION_MESSAGE,
} from "../src/roles/cat-role";
import type {
  RoleHandler,
  RoleHandlerContext,
  TenantContext,
} from "../src/roles/contracts";
import { RoleRegistry, roleRegistry } from "../src/roles/registry";
import type { RoleStateRepository } from "../src/roles/state";
import { STORE_DESIGNER_ROLE_KEY } from "../src/roles/store-designer-role";
import { ENTERPRISE_ADVISOR_ROLE_KEY } from "../src/roles/enterprise-advisor-role";

const baseTenant: TenantContext = {
  tenantId: "test-tenant",
  phoneNumberId: "test-phone",
  roleKey: "custom",
  systemPrompt: "Custom prompt",
  aiProvider: "groq",
  aiModel: "test-model",
  temperature: 0.5,
  maxTokens: 180,
};

function createMemoryRoleState(): RoleStateRepository {
  const store = new Map<string, string>();
  const keyOf = (tenantId: string, contactId: number, roleKey: string) =>
    `${tenantId}:${contactId}:${roleKey}`;

  return {
    async getForUpdate(tenantId, contactId, roleKey) {
      return store.get(keyOf(tenantId, contactId, roleKey)) ?? null;
    },
    async compareAndSet(
      tenantId,
      contactId,
      roleKey,
      expectedStateJson,
      stateJson,
    ) {
      const current = store.get(keyOf(tenantId, contactId, roleKey)) ?? null;
      if (current !== expectedStateJson) return false;
      if (stateJson === null) {
        store.delete(keyOf(tenantId, contactId, roleKey));
      } else {
        store.set(keyOf(tenantId, contactId, roleKey), stateJson);
      }
      return true;
    },
    async get(tenantId, contactId, roleKey) {
      return store.get(keyOf(tenantId, contactId, roleKey)) ?? null;
    },
    async set(tenantId, contactId, roleKey, stateJson) {
      store.set(keyOf(tenantId, contactId, roleKey), stateJson);
      return true;
    },
    async clear(tenantId, contactId, roleKey) {
      return store.delete(keyOf(tenantId, contactId, roleKey));
    },
  };
}

function createOnboardingContext(
  overrides: Partial<RoleHandlerContext> & {
    text?: string;
    interactionId?: string | null;
    contactId?: number | null;
    duplicate?: boolean;
  } = {},
) {
  const reply = vi.fn(async () => undefined);
  const sendButtons = vi.fn(async () => ({
    status: "sent" as const,
    metaMessageId: "wamid.buttons.1",
  }));
  const generateAiReply = vi.fn(
    async () =>
      "¡Miau! 🐱 Bienvenido a MeowLab. Puedo ayudarte con Facturación electrónica, Cotizaciones en PDF o charlar como Gato Manolo.",
  );
  const generateAiReplyWithHistory = vi.fn(
    async () =>
      "¡Miau! Con FacturaYa puedes emitir facturas, boletas y guías de remisión.",
  );
  const log = vi.fn();

  const context: RoleHandlerContext = {
    message: {
      id: "wamid.in.1",
      interactionId: overrides.interactionId ?? null,
      phoneNumberId: baseTenant.phoneNumberId,
      to: "51999999999",
      inputType: "text",
      text: overrides.text ?? "Hola",
    },
    tenant: roleRegistry.apply(baseTenant, CAT_ROLE_KEY),
    persisted: {
      duplicate: overrides.duplicate ?? false,
      conversationId: "test-tenant:51999999999",
      contactId: overrides.contactId !== undefined ? overrides.contactId : 101,
    },
    env: {} as Env,
    ai: null,
    businessData: null,
    quoteNumberAllocator: null,
    roleState: overrides.roleState ?? createMemoryRoleState(),
    history: overrides.history ?? [],
    reply,
    sendButtons,
    sendDocument: vi.fn(async () => ({
      status: "sent" as const,
      metaMessageId: "wamid.doc.1",
    })),
    generateAiReply,
    generateAiReplyWithHistory,
    fallbackReply: "Miau fallback",
    log,
    ...overrides,
  };

  return {
    context,
    reply,
    sendButtons,
    generateAiReply,
    generateAiReplyWithHistory,
    log,
  };
}

describe("role registry", () => {
  it("applies the cat role configuration", () => {
    const configured = roleRegistry.apply(baseTenant, CAT_ROLE_KEY);

    expect(configured.roleKey).toBe(CAT_ROLE_KEY);
    expect(configured.systemPrompt).toBe(CAT_SYSTEM_PROMPT);
    expect(configured.temperature).toBe(0.8);
  });

  it("keeps the tenant configuration for an unknown role override", () => {
    expect(roleRegistry.apply(baseTenant, "not-registered")).toEqual(baseTenant);
  });

  it("uses cat as the safe fallback handler", () => {
    expect(roleRegistry.resolve("not-registered")).toBeInstanceOf(CatRoleHandler);
  });

  it("rejects duplicate role keys", () => {
    const first = new CatRoleHandler();
    const duplicate: RoleHandler = {
      key: first.key,
      configure: (tenant) => tenant,
      handle: async () => undefined,
    };

    expect(() => new RoleRegistry([first, duplicate], CAT_ROLE_KEY)).toThrow(
      "Duplicate role handler",
    );
  });

  it("registers store-designer as a first-class handler", () => {
    expect(roleRegistry.keys()).toContain(STORE_DESIGNER_ROLE_KEY);
  });

  it("registers enterprise-advisor as a first-class handler", () => {
    expect(roleRegistry.keys()).toContain(ENTERPRISE_ADVISOR_ROLE_KEY);
    const configured = roleRegistry.apply(baseTenant, ENTERPRISE_ADVISOR_ROLE_KEY);
    expect(configured.roleKey).toBe(ENTERPRISE_ADVISOR_ROLE_KEY);
    expect(configured.systemPrompt).toContain("comprobantes electrónicos");
    expect(configured.temperature).toBe(0.2);
  });
});

describe("cat onboarding default role", () => {
  it("keeps the state written by a concurrent turn instead of overwriting it", async () => {
    const handler = new CatRoleHandler();
    const roleState = createMemoryRoleState();
    const concurrent = JSON.stringify({ version: 1, mode: "cat_chat", selectedRole: "cat", updatedAt: new Date().toISOString() });
    const conflicting: RoleStateRepository = {
      ...roleState,
      async getForUpdate() { return null; },
      async compareAndSet(...args) {
        await roleState.set("test-tenant", 101, CAT_ROLE_KEY, concurrent);
        return roleState.compareAndSet!(...args);
      },
      set: vi.fn(roleState.set),
    };
    const { context, log } = createOnboardingContext({
      text: "Facturación y GRE",
      interactionId: ONBOARDING_ENTERPRISE_BUTTON_ID,
      roleState: conflicting,
    });

    await handler.handle(context);

    expect(conflicting.set).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("whatsapp_onboarding_state_conflict");
    expect(await roleState.get("test-tenant", 101, CAT_ROLE_KEY)).toBe(concurrent);
  });

  it("presents hybrid AI reply with the 3 MeowLab role buttons on initial greeting", async () => {
    const handler = new CatRoleHandler();
    const roleState = createMemoryRoleState();
    const { context, sendButtons, reply, generateAiReply } =
      createOnboardingContext({
        text: "Hola, ¿qué servicios tienen en MeowLab?",
        roleState,
      });

    await handler.handle(context);

    expect(generateAiReply).toHaveBeenCalledOnce();
    expect(sendButtons).toHaveBeenCalledWith(
      expect.stringContaining("Bienvenido a MeowLab"),
      ONBOARDING_ROLE_BUTTONS,
    );
    expect(reply).not.toHaveBeenCalled();

    const stored = JSON.parse(
      (await roleState.get("test-tenant", 101, CAT_ROLE_KEY))!,
    );
    expect(stored).toMatchObject({
      version: 1,
      mode: "onboarding",
    });
  });

  it("auto-assigns the public Gato Manolo conversational mode when selected and stops repeating buttons", async () => {
    const handler = new CatRoleHandler();
    const roleState = createMemoryRoleState();

    const firstTurn = createOnboardingContext({
      text: "Gato Manolo 🐱",
      interactionId: ONBOARDING_CAT_BUTTON_ID,
      roleState,
    });
    await handler.handle(firstTurn.context);

    expect(firstTurn.reply).toHaveBeenCalledWith(CAT_CHAT_ACTIVATED_MESSAGE);
    expect(firstTurn.log).toHaveBeenCalledWith(
      "whatsapp_onboarding_role_selected",
      expect.objectContaining({
        tenantId: "test-tenant",
        contactId: 101,
        role: "cat",
        assignment: "auto",
      }),
    );

    const secondTurn = createOnboardingContext({
      text: "Hola Manolo, ¿cómo estás hoy?",
      roleState,
    });
    await handler.handle(secondTurn.context);

    expect(secondTurn.sendButtons).not.toHaveBeenCalled();
    expect(secondTurn.reply).toHaveBeenCalledOnce();
  });

  it("requests admin activation when selecting enterprise-advisor or quotes", async () => {
    const handler = new CatRoleHandler();
    const roleState = createMemoryRoleState();

    const enterpriseTurn = createOnboardingContext({
      text: "Facturación y GRE",
      interactionId: ONBOARDING_ENTERPRISE_BUTTON_ID,
      roleState,
    });
    await handler.handle(enterpriseTurn.context);

    expect(enterpriseTurn.sendButtons).toHaveBeenCalledWith(
      ENTERPRISE_ACTIVATION_MESSAGE,
      ONBOARDING_PENDING_BUTTONS,
    );
    expect(enterpriseTurn.log).toHaveBeenCalledWith(
      "whatsapp_onboarding_role_requested",
      expect.objectContaining({
        requestedRole: "enterprise-advisor",
        assignment: "admin_required",
      }),
    );

    const quotesTurn = createOnboardingContext({
      text: "Cotizaciones PDF",
      interactionId: ONBOARDING_QUOTES_BUTTON_ID,
      roleState,
    });
    await handler.handle(quotesTurn.context);

    expect(quotesTurn.sendButtons).toHaveBeenCalledWith(
      QUOTES_ACTIVATION_MESSAGE,
      ONBOARDING_PENDING_BUTTONS,
    );
    expect(quotesTurn.log).toHaveBeenCalledWith(
      "whatsapp_onboarding_role_requested",
      expect.objectContaining({
        requestedRole: "quotes",
        assignment: "admin_required",
      }),
    );
  });

  it("allows returning to the onboarding menu via button or 'cambiar rol' command", async () => {
    const handler = new CatRoleHandler();
    const roleState = createMemoryRoleState();

    await handler.handle(
      createOnboardingContext({
        interactionId: ONBOARDING_CAT_BUTTON_ID,
        roleState,
      }).context,
    );

    const menuTurn = createOnboardingContext({
      text: "cambiar rol",
      roleState,
    });
    await handler.handle(menuTurn.context);

    expect(menuTurn.sendButtons).toHaveBeenCalledWith(
      ONBOARDING_WELCOME_MESSAGE,
      ONBOARDING_ROLE_BUTTONS,
    );

    const buttonMenuTurn = createOnboardingContext({
      text: "Ver roles",
      interactionId: ONBOARDING_MENU_BUTTON_ID,
      roleState,
    });
    await handler.handle(buttonMenuTurn.context);

    expect(buttonMenuTurn.sendButtons).toHaveBeenCalledWith(
      ONBOARDING_WELCOME_MESSAGE,
      ONBOARDING_ROLE_BUTTONS,
    );
  });

  it("skips duplicate inbound messages without calling AI or sending messages", async () => {
    const handler = new CatRoleHandler();
    const { context, reply, sendButtons, generateAiReply } =
      createOnboardingContext({
        duplicate: true,
      });

    await handler.handle(context);

    expect(generateAiReply).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
    expect(sendButtons).not.toHaveBeenCalled();
  });

  it("isolates onboarding state across tenants and contacts and preserves requestedRole on CAS updates", async () => {
    const handler = new CatRoleHandler();
    const roleState = createMemoryRoleState();

    await handler.handle(
      createOnboardingContext({
        interactionId: ONBOARDING_ENTERPRISE_BUTTON_ID,
        contactId: 101,
        roleState,
      }).context,
    );
    await handler.handle(
      createOnboardingContext({
        interactionId: ONBOARDING_CAT_BUTTON_ID,
        contactId: 101,
        roleState,
      }).context,
    );

    const contact101State = JSON.parse(
      (await roleState.get("test-tenant", 101, CAT_ROLE_KEY))!,
    );
    expect(contact101State).toMatchObject({
      mode: "cat_chat",
      selectedRole: "cat",
      requestedRole: "enterprise-advisor",
    });

    const otherContactTurn = createOnboardingContext({
      text: "Hola, ¿qué roles tienes?",
      contactId: 202,
      roleState,
    });
    await handler.handle(otherContactTurn.context);
    expect(otherContactTurn.sendButtons).toHaveBeenCalledWith(
      expect.any(String),
      ONBOARDING_ROLE_BUTTONS,
    );
  });

  it("expires stale onboarding state after TTL and falls back safely when AI provider returns null", async () => {
    const handler = new CatRoleHandler();
    const roleState = createMemoryRoleState();
    const expiredDate = new Date(
      Date.now() - 8 * 24 * 60 * 60 * 1_000,
    ).toISOString();
    await roleState.set(
      "test-tenant",
      101,
      CAT_ROLE_KEY,
      JSON.stringify({
        version: 1,
        mode: "cat_chat",
        selectedRole: "cat",
        updatedAt: expiredDate,
      }),
    );

    const turn = createOnboardingContext({
      text: "Hola, quiero información",
      contactId: 101,
      roleState,
      generateAiReply: async () => null,
    });
    await handler.handle(turn.context);

    expect(turn.sendButtons).toHaveBeenCalledWith(
      ONBOARDING_WELCOME_MESSAGE,
      ONBOARDING_ROLE_BUTTONS,
    );
  });
});
