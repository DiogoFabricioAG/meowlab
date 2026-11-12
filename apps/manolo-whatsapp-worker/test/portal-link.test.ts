import { describe, expect, it, vi } from "vitest";
import {
  AUTH_CODE_WORKER_PATH,
  PORTAL_LINK_BRIDGE_PATH,
  isPortalLinkRequest,
  maskWhatsAppPhone,
  normalizeWhatsAppPhone,
} from "../src/bridge/portal-link-contracts";
import { signBridgePayload } from "../src/bridge/signature";
import { createBridgeHttpHandler } from "../src/node/bridge/http-handler";
import {
  PortalLinkService,
  type PortalLinkStore,
  type VerifyChallengeResult,
} from "../src/node/portal/link-service";
import { authCodeResponse, authTemplatePayload } from "../src/portal/auth-code-route";
import type { PrintAdvisorBridgeService } from "../src/node/bridge/print-advisor-service";
import type { ContactRoleResolver } from "../src/node/control/contact-role-resolver";

const PORTAL_SECRET = "portal-secret-portal-secret-portal-secret";
const SHARED_SECRET = "shared-secret-shared-secret-shared-secret";
const AUTH_SECRET = "authcode-secret-authcode-secret-authcode";

describe("portal link contracts", () => {
  it("normalises Peruvian and international numbers and masks them", () => {
    expect(normalizeWhatsAppPhone("987 654 321")).toBe("51987654321");
    expect(normalizeWhatsAppPhone("+51 987-654-321")).toBe("51987654321");
    expect(normalizeWhatsAppPhone("0051987654321")).toBe("51987654321");
    expect(normalizeWhatsAppPhone("12")).toBeNull();
    expect(normalizeWhatsAppPhone("98765abc1")).toBeNull();
    expect(maskWhatsAppPhone("51987654321")).toBe("+51 9•• ••• 321");
  });

  it("accepts only well-formed requests", () => {
    const base = { version: 1, requestId: "r1", portalUserId: "user-1" };
    expect(isPortalLinkRequest({ ...base, action: "start", phone: "987654321" })).toBe(true);
    expect(isPortalLinkRequest({ ...base, action: "verify", challengeId: crypto.randomUUID(), code: "123456" })).toBe(true);
    expect(isPortalLinkRequest({ ...base, action: "verify", challengeId: "not-a-uuid", code: "123456" })).toBe(false);
    expect(isPortalLinkRequest({ ...base, action: "verify", challengeId: crypto.randomUUID(), code: "12345" })).toBe(false);
    expect(isPortalLinkRequest({ ...base, action: "delete-everything" })).toBe(false);
  });
});

class MemoryStore implements PortalLinkStore {
  knownPhones = new Set<string>(["51987654321"]);
  challenges = new Map<string, { userId: string; phone: string; hash: string; delivery: string; attempts: number; consumed: boolean }>();
  links = new Map<string, { phone: string; linkedAt: Date }>();
  limited = false;

  async startChallenge(input: Parameters<PortalLinkStore["startChallenge"]>[0]) {
    if (this.limited) return { ok: false as const, retryAfterSeconds: 42 };
    const known = this.knownPhones.has(input.phone);
    this.challenges.set(input.challengeId, { userId: input.portalUserId, phone: input.phone, hash: input.codeHash,
      delivery: known ? "pending" : "skipped", attempts: 0, consumed: false });
    return { ok: true as const, knownContact: known, expiresAt: new Date(input.now.getTime() + 600_000) };
  }
  async markDelivery(id: string, delivery: "sent" | "failed") { this.challenges.get(id)!.delivery = delivery; }
  async verifyChallenge(input: Parameters<PortalLinkStore["verifyChallenge"]>[0]): Promise<VerifyChallengeResult> {
    const challenge = this.challenges.get(input.challengeId);
    if (!challenge || challenge.userId !== input.portalUserId || challenge.consumed || challenge.delivery !== "sent"
      || challenge.attempts >= input.maxAttempts) return { status: "expired" };
    if (!input.matches(challenge.hash)) {
      challenge.attempts++;
      return { status: "invalid_code", attemptsLeft: input.maxAttempts - challenge.attempts };
    }
    challenge.consumed = true;
    this.links.set(input.portalUserId, { phone: challenge.phone, linkedAt: input.now });
    return { status: "linked", phone: challenge.phone, linkedAt: input.now };
  }
  async linkFor(userId: string) { return this.links.get(userId) ?? null; }
  async unlink(userId: string) { this.links.delete(userId); }
}

function service(store = new MemoryStore(), delivered = true) {
  const sender = { send: vi.fn(async () => delivered) };
  const log = vi.fn();
  const linkService = new PortalLinkService(store, sender, PORTAL_SECRET, log,
    () => new Date("2026-11-11T12:00:00Z"), () => "482913");
  return { linkService, sender, store, log };
}

describe("portal link service", () => {
  it("sends the code to a known number and links it once verified", async () => {
    const { linkService, sender } = service();
    const started = await linkService.handle({ version: 1, requestId: "r1", portalUserId: "u1", action: "start", phone: "987654321" });
    expect(started).toMatchObject({ status: "code_sent", maskedPhone: "+51 9•• ••• 321", resendAfterSeconds: 60 });
    expect(sender.send).toHaveBeenCalledWith("51987654321", "482913", "r1");
    const challengeId = (started as { challengeId: string }).challengeId;

    const wrong = await linkService.handle({ version: 1, requestId: "r2", portalUserId: "u1", action: "verify", challengeId, code: "000000" });
    expect(wrong).toEqual({ status: "invalid_code", attemptsLeft: 4 });
    const other = await linkService.handle({ version: 1, requestId: "r3", portalUserId: "u2", action: "verify", challengeId, code: "482913" });
    expect(other).toEqual({ status: "expired" });
    const linked = await linkService.handle({ version: 1, requestId: "r4", portalUserId: "u1", action: "verify", challengeId, code: "482913" });
    expect(linked).toMatchObject({ status: "linked", maskedPhone: "+51 9•• ••• 321" });
    expect(await linkService.handle({ version: 1, requestId: "r5", portalUserId: "u1", action: "status" }))
      .toMatchObject({ status: "linked" });
    expect(await linkService.handle({ version: 1, requestId: "r6", portalUserId: "u1", action: "unlink" })).toEqual({ status: "unlinked" });
    expect(await linkService.handle({ version: 1, requestId: "r7", portalUserId: "u1", action: "status" })).toEqual({ status: "not_linked" });
  });

  it("answers the same for an unknown number but sends nothing and can never link", async () => {
    const { linkService, sender } = service();
    const started = await linkService.handle({ version: 1, requestId: "r1", portalUserId: "u1", action: "start", phone: "+1 415 555 0100" });
    expect(started).toMatchObject({ status: "code_sent" });
    expect(sender.send).not.toHaveBeenCalled();
    const challengeId = (started as { challengeId: string }).challengeId;
    expect(await linkService.handle({ version: 1, requestId: "r2", portalUserId: "u1", action: "verify", challengeId, code: "482913" }))
      .toEqual({ status: "expired" });
  });

  it("reports invalid numbers, rate limits and delivery failures", async () => {
    expect(await service().linkService.handle({ version: 1, requestId: "r", portalUserId: "u", action: "start", phone: "123" }))
      .toEqual({ status: "invalid_phone" });
    const limited = new MemoryStore();
    limited.limited = true;
    expect(await service(limited).linkService.handle({ version: 1, requestId: "r", portalUserId: "u", action: "start", phone: "987654321" }))
      .toEqual({ status: "rate_limited", retryAfterSeconds: 42 });
    const failing = service(new MemoryStore(), false);
    expect(await failing.linkService.handle({ version: 1, requestId: "r", portalUserId: "u", action: "start", phone: "987654321" }))
      .toEqual({ status: "delivery_failed" });
    expect([...failing.store.challenges.values()][0].delivery).toBe("failed");
  });

  it("stores only a keyed hash of the code", async () => {
    const { linkService, store } = service();
    await linkService.handle({ version: 1, requestId: "r1", portalUserId: "u1", action: "start", phone: "987654321" });
    const [challenge] = [...store.challenges.values()];
    expect(challenge.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(challenge.hash).not.toContain("482913");
  });
});

describe("bridge portal route", () => {
  function handler(linkService = { handle: vi.fn(async () => ({ status: "not_linked" as const })) }) {
    return {
      linkService,
      handle: createBridgeHttpHandler({
        sharedSecret: SHARED_SECRET,
        portalSecret: PORTAL_SECRET,
        portalLinkService: linkService,
        service: {} as PrintAdvisorBridgeService,
        contactRoleResolver: {} as ContactRoleResolver,
        healthCheck: async () => true,
        log: vi.fn(),
      }),
    };
  }
  async function signed(path: string, secret: string, payload: Record<string, unknown>) {
    const body = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1_000));
    return {
      method: "POST", path, body,
      headers: {
        "x-manolo-timestamp": timestamp,
        "x-manolo-signature": await signBridgePayload(secret, timestamp, body),
        "x-manolo-request-id": String(payload.requestId),
      },
    };
  }
  const statusRequest = { version: 1, requestId: "req-1", portalUserId: "u1", action: "status" };

  it("accepts the portal secret on the portal route", async () => {
    const { handle, linkService } = handler();
    const response = await handle(await signed(PORTAL_LINK_BRIDGE_PATH, PORTAL_SECRET, statusRequest));
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: "not_linked" });
    expect(linkService.handle).toHaveBeenCalledOnce();
  });

  it("keeps the two secrets apart", async () => {
    const { handle, linkService } = handler();
    expect((await handle(await signed(PORTAL_LINK_BRIDGE_PATH, SHARED_SECRET, statusRequest))).status).toBe(401);
    const contactRole = await handle(await signed("/v1/control/contacts/resolve-role", PORTAL_SECRET, { requestId: "req-2" }));
    expect(contactRole.status).toBe(401);
    expect(linkService.handle).not.toHaveBeenCalled();
  });

  it("rejects malformed portal requests", async () => {
    const { handle } = handler();
    const response = await handle(await signed(PORTAL_LINK_BRIDGE_PATH, PORTAL_SECRET, { ...statusRequest, action: "drop" }));
    expect(response.status).toBe(400);
  });
});

describe("worker auth-code route", () => {
  const env = {
    AUTH_CODE_HMAC_SECRET: AUTH_SECRET,
    WHATSAPP_AUTH_TEMPLATE: "meowlab_codigo_acceso",
    WHATSAPP_AUTH_TEMPLATE_LANGUAGE: "es",
    WHATSAPP_PHONE_NUMBER_ID: "1266091906580349",
    META_ACCESS_TOKEN: "fake-token",
    META_GRAPH_API_VERSION: "v25.0",
  } as unknown as Env;
  const now = 1_794_400_000;

  async function request(secret = AUTH_SECRET, payload: Record<string, unknown> = { version: 1, requestId: "q1", to: "51987654321", code: "482913" }, timestamp = String(now)) {
    const body = JSON.stringify(payload);
    return new Request(`https://manolo.example${AUTH_CODE_WORKER_PATH}`, {
      method: "POST",
      body,
      headers: {
        "X-Manolo-Timestamp": timestamp,
        "X-Manolo-Signature": await signBridgePayload(secret, timestamp, body),
        "X-Manolo-Request-Id": String(payload.requestId),
      },
    });
  }

  it("sends the authentication template with the code in the body and the copy button", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 }));
    const response = await authCodeResponse(await request(), env, vi.fn(), fetchImpl as unknown as typeof fetch, now);
    expect(response.status).toBe(200);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v25.0/1266091906580349/messages");
    expect(JSON.parse(String(init.body))).toEqual(authTemplatePayload("51987654321", "482913", "meowlab_codigo_acceso", "es"));
  });

  it("rejects wrong signatures, stale timestamps and does nothing until configured", async () => {
    const fetchImpl = vi.fn();
    expect((await authCodeResponse(await request("wrong-secret-wrong-secret-wrong-secret"), env, vi.fn(), fetchImpl as unknown as typeof fetch, now)).status).toBe(401);
    expect((await authCodeResponse(await request(AUTH_SECRET, undefined, String(now - 600)), env, vi.fn(), fetchImpl as unknown as typeof fetch, now)).status).toBe(401);
    const unconfigured = { ...env, WHATSAPP_AUTH_TEMPLATE: "" } as unknown as Env;
    expect((await authCodeResponse(await request(), unconfigured, vi.fn(), fetchImpl as unknown as typeof fetch, now)).status).toBe(503);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports a Meta failure as 502", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 400 }));
    expect((await authCodeResponse(await request(), env, vi.fn(), fetchImpl as unknown as typeof fetch, now)).status).toBe(502);
  });
});
