import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KAPSO_API_BASE_URL, MetaWhatsAppClient } from "../src/adapters/whatsapp/meta-client";
import { kapsoPhoneNumberIds } from "../src/adapters/whatsapp/factory";
import worker, { KAPSO_WEBHOOK_PATH } from "../src/index";

const KAPSO_NUMBER = "987654321012345";
const META_NUMBER = "1266091906580349";

function client() {
  return new MetaWhatsAppClient(
    { accessToken: "meta-token", graphApiVersion: "v25.0", kapso: { apiKey: "kapso-key", phoneNumberIds: new Set([KAPSO_NUMBER]) } },
    () => undefined,
  );
}

const sent = () => new Response(JSON.stringify({ messages: [{ id: "wamid.kapso-1" }] }), { status: 200 });

describe("WhatsApp client with Kapso numbers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends Kapso numbers through Kapso with its key and never Meta's token", async () => {
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => sent());
    vi.stubGlobal("fetch", fetchMock);
    expect(await client().sendText("51999999999", "Hola", KAPSO_NUMBER)).toEqual({ status: "sent", metaMessageId: "wamid.kapso-1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${KAPSO_API_BASE_URL}/${KAPSO_NUMBER}/messages`);
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-API-Key"]).toBe("kapso-key");
    expect(headers.Authorization).toBeUndefined();
    expect(JSON.parse(String(init?.body))).toMatchObject({ messaging_product: "whatsapp", to: "51999999999", type: "text" });
  });

  it("keeps Meta numbers on the Graph API with Meta's token", async () => {
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => sent());
    vi.stubGlobal("fetch", fetchMock);
    await client().sendText("51999999999", "Hola", META_NUMBER);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://graph.facebook.com/v25.0/${META_NUMBER}/messages`);
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer meta-token");
  });

  it("skips a Kapso number when its key is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const noKey = new MetaWhatsAppClient(
      { accessToken: "meta-token", graphApiVersion: "v25.0", kapso: { phoneNumberIds: new Set([KAPSO_NUMBER]) } },
      () => undefined,
    );
    expect(await noKey.sendText("51999999999", "Hola", KAPSO_NUMBER)).toEqual({ status: "skipped", metaMessageId: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("downloads Kapso media through its signed download_url without any token", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      if (url.startsWith(`${KAPSO_API_BASE_URL}/media-1`)) {
        return new Response(JSON.stringify({
          url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1",
          download_url: "https://api.kapso.ai/meta/whatsapp/media_download?token=abc",
          mime_type: "audio/ogg",
          file_size: "1200",
        }), { status: 200 });
      }
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": "audio/ogg" } });
    }));
    const c = client();
    const metadata = await c.getMediaMetadata("media-1", KAPSO_NUMBER);
    expect(metadata?.url).toBe("https://api.kapso.ai/meta/whatsapp/media_download?token=abc");
    expect(calls[0].url).toBe(`${KAPSO_API_BASE_URL}/media-1?phone_number_id=${KAPSO_NUMBER}`);
    expect(calls[0].headers["X-API-Key"]).toBe("kapso-key");
    const media = await c.downloadMedia(metadata!);
    expect(media?.bytes.byteLength).toBe(3);
    expect(calls[1].headers).toEqual({});
  });

  it("parses the configured Kapso number list strictly", () => {
    expect([...kapsoPhoneNumberIds(" 123456, abc, 987654321012345 ,")]).toEqual(["123456", "987654321012345"]);
    expect(kapsoPhoneNumberIds(undefined).size).toBe(0);
  });
});

async function hmacHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

function statusPayload(phoneNumberId: string) {
  // A delivery receipt: exercises signature and routing without starting a conversation turn.
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "waba-1", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp",
      metadata: { display_phone_number: "12084415504", phone_number_id: phoneNumberId },
      statuses: [{ id: "wamid.out-1", status: "delivered", timestamp: "1794450000", recipient_id: "51999999999" }],
    } }] }],
  });
}

const kapsoEnv = { KAPSO_WEBHOOK_SECRET: "kapso-webhook-secret", KAPSO_PHONE_NUMBER_IDS: KAPSO_NUMBER, KAPSO_API_KEY: "kapso-key" };

async function deliver(body: string, headers: Record<string, string>, overrides: Record<string, unknown> = kapsoEnv) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`https://manolo.example${KAPSO_WEBHOOK_PATH}`, { method: "POST", body, headers: { "Content-Type": "application/json", ...headers } }) as Request<unknown, IncomingRequestCfProperties>,
    { ...env, ...overrides } as Env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

describe("Kapso webhook route", () => {
  it("accepts Meta's payload forwarded by Kapso with a valid signature", async () => {
    const body = statusPayload(KAPSO_NUMBER);
    const response = await deliver(body, { "X-Webhook-Signature": await hmacHex("kapso-webhook-secret", body), "X-Idempotency-Key": "k1" });
    expect(response.status).toBe(200);
  });

  it("rejects a missing or wrong signature", async () => {
    const body = statusPayload(KAPSO_NUMBER);
    expect((await deliver(body, {})).status).toBe(401);
    expect((await deliver(body, { "X-Webhook-Signature": await hmacHex("otro-secreto", body) })).status).toBe(401);
  });

  it("refuses a Kapso delivery for a number that is not on Kapso", async () => {
    const body = statusPayload(META_NUMBER);
    const response = await deliver(body, { "X-Webhook-Signature": await hmacHex("kapso-webhook-secret", body) });
    expect(response.status).toBe(403);
  });

  it("refuses a Meta delivery for a Kapso number", async () => {
    const body = statusPayload(KAPSO_NUMBER);
    const ctx = createExecutionContext();
    const secret = (env as unknown as { META_APP_SECRET?: string }).META_APP_SECRET ?? "";
    const response = await worker.fetch(
      new Request("https://manolo.example/webhooks/whatsapp", { method: "POST", body, headers: { "X-Hub-Signature-256": `sha256=${await hmacHex(secret, body)}` } }) as Request<unknown, IncomingRequestCfProperties>,
      { ...env, ...kapsoEnv } as Env,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(403);
  });

  it("stays closed until its secret is configured", async () => {
    const body = statusPayload(KAPSO_NUMBER);
    expect((await deliver(body, { "X-Webhook-Signature": "00".repeat(32) }, { KAPSO_PHONE_NUMBER_IDS: KAPSO_NUMBER })).status).toBe(503);
  });
});
