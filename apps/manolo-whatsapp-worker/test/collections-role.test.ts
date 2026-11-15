import { describe, expect, it, vi } from "vitest";
import type { RoleHandlerContext, TenantContext } from "../src/roles/contracts";
import type { RoleStateRepository } from "../src/roles/state";
import {
  COLLECTIONS_ROLE_KEY,
  CollectionsRoleHandler,
  isCollectionsCommand,
  parseCollectionsState,
} from "../src/roles/collections-role";
import type { CollectionsClient, CollectionsOverview, Reminder } from "../src/collections/client";
import { isCollectionsBridgeRequest, isSettingsChange } from "../src/collections/bridge-contracts";
import { dueForReminder, insideWindow, needsOwner, nextReminderOn, toneFor } from "../src/collections/schedule";
import { formatAnswer, reminderText, whatsappLink } from "../src/collections/messages";
import type { AiProvider } from "../src/ai/contracts";

const tenant: TenantContext = {
  tenantId: "manolo", phoneNumberId: "pn", roleKey: COLLECTIONS_ROLE_KEY, systemPrompt: "", aiProvider: "groq",
  aiModel: "openai/gpt-oss-120b", temperature: 0, maxTokens: 900,
};
const RULES = { remindBeforeDays: 2, remindEveryDays: 7, maxReminders: 3 };
const SETTINGS = {
  defaultDueDays: 30, remindBeforeDays: 2, remindEveryDays: 7, maxReminders: 3, windowStartHour: 9, windowEndHour: 19, skipSundays: true,
  yapePhone: "987654321", plinPhone: null, bankText: null, paymentLink: null,
};
const DEBT = {
  id: "3f1c2a4e-1111-4a2b-9c3d-000000000001", customer: "Juan Pérez", phone: "51911222333", balanceCents: 20000, amountCents: 20000,
  dueOn: "2026-11-30", daysLate: -16, document: null, description: "polos", remindersSent: 0,
};
const PENDING_ID = "3f1c2a4e-1111-4a2b-9c3d-000000000009";

function memoryState(): RoleStateRepository {
  const store = new Map<string, string>();
  const key = (t: string, c: number, r: string) => `${t}:${c}:${r}`;
  return {
    async get(t, c, r) { return store.get(key(t, c, r)) ?? null; },
    async set(t, c, r, json) { store.set(key(t, c, r), json); return true; },
    async clear(t, c, r) { return store.delete(key(t, c, r)); },
  };
}

const OVERVIEW: CollectionsOverview = {
  owner: true, sync: { added: 1, creditNotes: 0, available: true }, settings: SETTINGS, totalCents: 20000,
  buckets: { current: 20000, d1_30: 0, d31_60: 0, d61: 0 }, openCount: 1, toRemind: [DEBT], escalated: [], pending: [], customers: ["Juan Pérez"],
};
const REMINDER: Reminder = {
  companyName: "CREACIONES J&D", debt: DEBT, customerBalanceCents: 20000, openDebts: 1, tone: "friendly", lastReminder: false, outsideWindow: false,
  payment: { yapePhone: "987654321", plinPhone: null, bankText: null, paymentLink: null },
};

function fakeClient(overrides: Partial<CollectionsClient> = {}): CollectionsClient & Record<string, ReturnType<typeof vi.fn>> {
  return {
    companies: vi.fn(async () => ({ ok: true as const, data: [{ id: "org_jd", name: "CREACIONES J&D" }] })),
    overview: vi.fn(async () => ({ ok: true as const, data: OVERVIEW })),
    addDebt: vi.fn(async () => ({ ok: true as const, data: { debt: DEBT, customerBalanceCents: 20000 } })),
    recordPayment: vi.fn(async (_c: string, payment: { fromCapture: boolean }) => (payment.fromCapture
      ? { ok: true as const, data: { pending: { id: PENDING_ID, customer: "Juan Pérez", amountCents: 10000, method: "yape" as const, operationNumber: "123", paidOn: "2026-11-14" }, customerBalanceCents: 20000 } }
      : { ok: true as const, data: { customer: "Juan Pérez", applied: [{ debtId: DEBT.id, amountCents: 10000, balanceCents: 10000 }], leftoverCents: 0, customerBalanceCents: 10000 } })),
    decidePayment: vi.fn(async () => ({ ok: true as const, data: { approved: true as const, customer: "Juan Pérez", applied: [{ debtId: DEBT.id, amountCents: 10000, balanceCents: 10000 }], leftoverCents: 0, customerBalanceCents: 10000 } })),
    remind: vi.fn(async () => ({ ok: true as const, data: REMINDER })),
    setCustomer: vi.fn(async () => ({ ok: true as const, data: { customer: { name: "Juan Pérez", phone: "51911222333", doNotContact: false } } })),
    settings: vi.fn(async () => ({ ok: true as const, data: { settings: SETTINGS } })),
    query: vi.fn(async () => ({ ok: true as const, data: { totalCents: 20000, buckets: OVERVIEW.buckets, customers: 1, lateCount: 0 } })),
    ...overrides,
  } as CollectionsClient & Record<string, ReturnType<typeof vi.fn>>;
}

function scriptedAi(...answers: Array<Record<string, unknown>>): AiProvider {
  const settings = { yapePhone: "", plinPhone: "", bankText: "", paymentLink: "", defaultDueDays: -1, maxReminders: -1, remindEveryDays: -1,
    remindBeforeDays: -1, windowStartHour: -1, windowEndHour: -1, skipSundays: "none" };
  const base = { intent: "other", customer: "", amount: -1, description: "", dueOn: "", phone: "", docNumber: "", method: "none",
    operationNumber: "", paidOn: "", queryType: "none", period: "none", settings, reply: "" };
  return { complete: vi.fn(async () => {
    const next = answers.shift() ?? {};
    return JSON.stringify({ ...base, ...next, settings: { ...settings, ...(next.settings as object | undefined) } });
  }) } as unknown as AiProvider;
}

function run(options: { text?: string; interactionId?: string | null; image?: boolean; client: CollectionsClient; ai?: AiProvider | null; state: RoleStateRepository }) {
  const calls = {
    reply: vi.fn(async (_text: string) => undefined),
    sendButtons: vi.fn(async (_body: string, _buttons: Array<{ id: string; title: string }>) => ({ status: "sent" as const, metaMessageId: "b" })),
    sendList: vi.fn(async (_body: string, _button: string, _sections: unknown) => ({ status: "sent" as const, metaMessageId: "l" })),
    sendCtaUrl: vi.fn(async (_body: string, _label: string, _url: string) => ({ status: "sent" as const, metaMessageId: "u" })),
    sendDocument: vi.fn(async () => ({ status: "sent" as const, metaMessageId: "d" })),
  };
  const context = {
    message: { id: "wamid.1", interactionId: options.interactionId ?? null, phoneNumberId: "pn", to: "51911111111",
      inputType: options.image ? "image" : "text", hasVisualContext: options.image ?? false, text: options.text ?? options.interactionId ?? "" },
    tenant,
    persisted: { duplicate: false, conversationId: "c", contactId: 1 },
    env: {} as unknown as Env,
    ai: options.ai ?? null,
    roleState: options.state,
    history: [],
    ...calls,
    generateAiReply: async () => null,
    generateAiReplyWithHistory: async () => null,
    fallbackReply: "",
    log: vi.fn(),
  } as unknown as RoleHandlerContext;
  return { promise: new CollectionsRoleHandler(() => options.client).handle(context), calls };
}

describe("Collections Cat rules", () => {
  it("reminds before, on and after the due date, up to the maximum", () => {
    expect(nextReminderOn({ dueOn: "2026-11-30", remindersSent: 0, lastReminderOn: null }, RULES)).toBe("2026-11-28");
    expect(nextReminderOn({ dueOn: "2026-11-30", remindersSent: 1, lastReminderOn: "2026-11-28" }, RULES)).toBe("2026-11-30");
    expect(nextReminderOn({ dueOn: "2026-11-30", remindersSent: 2, lastReminderOn: "2026-11-30" }, RULES)).toBe("2026-12-07");
    expect(nextReminderOn({ dueOn: "2026-11-30", remindersSent: 3, lastReminderOn: "2026-12-07" }, RULES)).toBeNull();
    expect(dueForReminder({ dueOn: "2026-11-30", remindersSent: 0, lastReminderOn: null }, RULES, "2026-11-28", false)).toBe(true);
    expect(dueForReminder({ dueOn: "2026-11-30", remindersSent: 0, lastReminderOn: null }, RULES, "2026-11-28", true)).toBe(false);
  });

  it("gets firmer with time and hands the case to the owner when it cannot do more", () => {
    expect(toneFor(-3, 0, 3)).toBe("friendly");
    expect(toneFor(5, 1, 3)).toBe("firm");
    expect(toneFor(5, 2, 3)).toBe("final");
    expect(toneFor(40, 0, 3)).toBe("final");
    const spent = { dueOn: "2026-11-01", remindersSent: 3, lastReminderOn: "2026-11-10", lastPaymentOn: null };
    expect(needsOwner(spent, RULES, "2026-11-16", false)).toBe(false);
    expect(needsOwner(spent, RULES, "2026-11-17", false)).toBe(true);
    expect(needsOwner({ ...spent, lastPaymentOn: "2026-11-12" }, RULES, "2026-11-20", false)).toBe(false);
    expect(needsOwner({ ...spent, remindersSent: 0, lastReminderOn: null }, RULES, "2026-11-20", true)).toBe(true);
    expect(needsOwner({ ...spent, dueOn: "2026-12-01" }, RULES, "2026-11-20", true)).toBe(false);
  });

  it("respects the company's hours and Sundays (Lima time)", () => {
    const rules = { windowStartHour: 9, windowEndHour: 19, skipSundays: true };
    expect(insideWindow(new Date("2026-11-13T15:00:00Z"), rules)).toBe(true); // Friday 10:00
    expect(insideWindow(new Date("2026-11-14T01:00:00Z"), rules)).toBe(false); // Friday 20:00
    expect(insideWindow(new Date("2026-11-15T15:00:00Z"), rules)).toBe(false); // Sunday
    expect(insideWindow(new Date("2026-11-15T15:00:00Z"), { ...rules, skipSundays: false })).toBe(true);
  });

  it("validates bridge requests and settings", () => {
    const base = { channel_tenant_id: "manolo", contact_id: 1, company_id: "org_jd" };
    expect(isCollectionsBridgeRequest({ ...base, operation: "add_debt", payload: { customer: "Juan", amountCents: 20000 } })).toBe(true);
    expect(isCollectionsBridgeRequest({ ...base, operation: "add_debt", payload: { customer: "Juan", amountCents: 0 } })).toBe(false);
    expect(isCollectionsBridgeRequest({ ...base, operation: "record_payment", payload: { customer: "Juan", amountCents: 100, method: "yape", fromCapture: true } })).toBe(true);
    expect(isCollectionsBridgeRequest({ ...base, operation: "record_payment", payload: { customer: "Juan", amountCents: 100, method: "bitcoin", fromCapture: false } })).toBe(false);
    expect(isCollectionsBridgeRequest({ ...base, operation: "decide_payment", payload: { paymentId: "x", approve: true } })).toBe(false);
    expect(isCollectionsBridgeRequest({ ...base, operation: "query", payload: { type: "paid", period: "week" } })).toBe(true);
    expect(isCollectionsBridgeRequest({ channel_tenant_id: "manolo", contact_id: 1, operation: "overview" })).toBe(false);
    expect(isSettingsChange({ yapePhone: "987654321", maxReminders: 4 })).toBe(true);
    expect(isSettingsChange({ paymentLink: "http://inseguro.pe" })).toBe(false);
    expect(isSettingsChange({ windowStartHour: 20, windowEndHour: 9 })).toBe(false);
    expect(isSettingsChange({ interest: 5 })).toBe(false);
  });

  it("writes the customer's reminder with the payment options, firmer when late", () => {
    const friendly = reminderText(REMINDER);
    expect(friendly).toContain("Hola Juan, te saluda CREACIONES J&D");
    expect(friendly).toContain("S/ 200.00");
    expect(friendly).toContain("vence el 30 nov");
    expect(friendly).toContain("• Yape: 987 654 321");
    const final = reminderText({ ...REMINDER, tone: "final", debt: { ...DEBT, daysLate: 40, dueOn: "2026-10-05" } });
    expect(final).toContain("vencido desde el 5 oct");
    expect(final).not.toMatch(/inter[eé]s|mora/i);
    expect(whatsappLink("51911222333", "Hola Juan")).toBe("https://wa.me/51911222333?text=Hola%20Juan");
    expect(formatAnswer({ totalCents: 0, buckets: OVERVIEW.buckets, customers: 0, lateCount: 0 })).toBe("Nadie te debe nada. 👍");
  });

  it("recognises its commands and expires sessions", () => {
    expect(isCollectionsCommand("/collections")).toBe(true);
    expect(isCollectionsCommand("/Cobranza")).toBe(true);
    expect(isCollectionsCommand("collections")).toBe(false);
    expect(parseCollectionsState(JSON.stringify({ v: 1, expiresAt: 10 }), 20)).toBeNull();
  });
});

describe("Collections Cat in the chat", () => {
  it("opens with what is owed and who to remind today", async () => {
    const { promise, calls } = run({ text: "/collections", client: fakeClient(), state: memoryState() });
    await promise;
    expect(calls.reply.mock.calls[0][0]).toContain("Te deben S/ 200.00");
    expect(calls.reply.mock.calls[0][0]).toContain("Anoté 1 deuda nueva");
    expect(calls.sendList).toHaveBeenCalled();
    expect(JSON.stringify(calls.sendList.mock.calls[0][2])).toContain(`collections:remind:${DEBT.id}`);
  });

  it("records a debt only after confirming", async () => {
    const state = memoryState();
    const client = fakeClient();
    await run({ text: "Juan me debe 200 de los polos", client, state,
      ai: scriptedAi({ intent: "add_debt", customer: "Juan Pérez", amount: 200, description: "polos" }) }).promise;
    expect(client.addDebt).not.toHaveBeenCalled();
    const confirm = run({ interactionId: "collections:confirm", client, state });
    await confirm.promise;
    expect(client.addDebt).toHaveBeenCalledWith("org_jd", expect.objectContaining({ customer: "Juan Pérez", amountCents: 20000, description: "polos" }));
    expect(confirm.calls.reply.mock.calls[0][0]).toContain("Juan Pérez te debe S/ 200.00");
  });

  it("prepares a reminder that opens WhatsApp with the customer", async () => {
    const client = fakeClient();
    const { promise, calls } = run({ interactionId: `collections:remind:${DEBT.id}`, client, state: memoryState() });
    await promise;
    expect(client.remind).toHaveBeenCalledWith("org_jd", { debtId: DEBT.id });
    const [, label, url] = calls.sendCtaUrl.mock.calls[0];
    expect(label).toBe("Enviar por WhatsApp");
    expect(url).toMatch(/^https:\/\/wa\.me\/51911222333\?text=Hola%20Juan/);
  });

  it("asks for the phone when missing and reminds once it arrives", async () => {
    const state = memoryState();
    const remind = vi.fn()
      .mockResolvedValueOnce({ ok: false, code: "no_phone", details: { customer: "Juan Pérez" } })
      .mockResolvedValueOnce({ ok: true, data: REMINDER });
    const client = fakeClient({ remind });
    const first = run({ text: "recuérdale a Juan", client, state, ai: scriptedAi({ intent: "remind", customer: "Juan Pérez" }) });
    await first.promise;
    expect(first.calls.reply.mock.calls.at(-1)?.[0]).toContain("No tengo el WhatsApp de Juan Pérez");
    const second = run({ text: "es 911222333", client, state, ai: scriptedAi({ intent: "set_phone", phone: "51911222333" }) });
    await second.promise;
    expect(client.setCustomer).toHaveBeenCalledWith("org_jd", "Juan Pérez", { phone: "51911222333" });
    expect(second.calls.sendCtaUrl).toHaveBeenCalled();
  });

  it("never applies a forwarded capture by itself: someone validates it", async () => {
    const state = memoryState();
    const client = fakeClient();
    const capture = run({ text: "Yapeo de S/ 100 a CREACIONES J&D, operación 123, Juan Pérez", image: true, client, state,
      ai: scriptedAi({ intent: "other", customer: "Juan Pérez", amount: 100, method: "yape", operationNumber: "123" }) });
    await capture.promise;
    expect(client.recordPayment).toHaveBeenCalledWith("org_jd", expect.objectContaining({ fromCapture: true, amountCents: 10000, customer: "Juan Pérez" }));
    expect(capture.calls.sendButtons.mock.calls[0][0]).toContain("Me mandaron esta captura de *Juan Pérez*");
    const approve = run({ interactionId: `collections:approve:${PENDING_ID}`, client, state });
    await approve.promise;
    expect(client.decidePayment).toHaveBeenCalledWith("org_jd", PENDING_ID, true);
    expect(approve.calls.reply.mock.calls[0][0]).toBe("✅ Registré S/ 100.00 de Juan Pérez. Aún debe S/ 100.00.");
  });

  it("asks whose capture it is when the image does not say", async () => {
    const state = memoryState();
    const client = fakeClient();
    const capture = run({ text: "Yape S/ 100", image: true, client, state, ai: scriptedAi({ intent: "capture", amount: 100, method: "yape" }) });
    await capture.promise;
    expect(capture.calls.reply.mock.calls[0][0]).toContain("¿De qué cliente es?");
    await run({ text: "de Juan", client, state, ai: scriptedAi({ intent: "other", customer: "Juan Pérez" }) }).promise;
    expect(client.recordPayment).toHaveBeenCalledWith("org_jd", expect.objectContaining({ fromCapture: true, customer: "Juan Pérez" }));
  });

  it("changes rules and payment options, and answers questions", async () => {
    const client = fakeClient();
    const state = memoryState();
    await run({ text: "mi yape es 987654321 y dales 15 días", client, state,
      ai: scriptedAi({ intent: "settings", settings: { yapePhone: "987654321", defaultDueDays: 15 } }) }).promise;
    expect(client.settings).toHaveBeenCalledWith("org_jd", { yapePhone: "987654321", defaultDueDays: 15 });
    await run({ text: "¿qué me pagaron hoy?", client, state, ai: scriptedAi({ intent: "query", queryType: "paid", period: "today" }) }).promise;
    expect(client.query).toHaveBeenCalledWith("org_jd", "paid", "today");
    const refused = fakeClient({ settings: vi.fn(async () => ({ ok: false as const, code: "owner_only" })) });
    const { promise, calls } = run({ text: "máximo 5", client: refused, state, ai: scriptedAi({ intent: "settings", settings: { maxReminders: 5 } }) });
    await promise;
    expect(calls.reply.mock.calls.at(-1)?.[0]).toBe("Eso solo lo puede cambiar la titular de la empresa.");
  });
});
