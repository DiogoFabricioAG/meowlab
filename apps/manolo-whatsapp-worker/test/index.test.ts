import { env } from "cloudflare:workers";
import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";

const webhookUrl = "https://example.com/webhooks/whatsapp";

function makeRequest(
  input: string | URL,
  init?: RequestInit,
): Request<unknown, IncomingRequestCfProperties> {
  return new Request(input, init) as Request<unknown, IncomingRequestCfProperties>;
}

function isGraphReplyCall(call: readonly unknown[]): boolean {
  if (!String(call[0]).includes("graph.facebook.com")) return false;
  try {
    const request = call[1] as RequestInit | undefined;
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    return body.typing_indicator === undefined;
  } catch {
    return false;
  }
}

async function dispatch(
  request: Request<unknown, IncomingRequestCfProperties>,
): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

async function signBody(body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.META_APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function whatsappPayload(
  messageText = "hello from test",
  options: { messageId?: string; from?: string; phoneNumberId?: string } = {},
) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "business-account-test-id",
        changes: [
          {
            field: "messages",
            value: {
              metadata: {
                phone_number_id:
                  options.phoneNumberId ?? env.WHATSAPP_PHONE_NUMBER_ID,
              },
              messages: [
                {
                  id: options.messageId ?? `wamid.text.${crypto.randomUUID()}`,
                  from: options.from ?? "573001234567",
                  type: "text",
                  text: { body: messageText },
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

function whatsappStatusPayload() {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "business-account-test-id",
        changes: [
          {
            field: "messages",
            value: {
              statuses: [{ id: "message-id", status: "delivered" }],
            },
          },
        ],
      },
    ],
  });
}

function whatsappAudioPayload(
  options: {
    messageId?: string;
    from?: string;
    phoneNumberId?: string;
    mediaId?: string;
  } = {},
) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "business-account-test-id",
        changes: [
          {
            field: "messages",
            value: {
              metadata: {
                phone_number_id:
                  options.phoneNumberId ?? env.WHATSAPP_PHONE_NUMBER_ID,
              },
              messages: [
                {
                  id: options.messageId,
                  from: options.from ?? "573001234567",
                  type: "audio",
                  audio: {
                    id: options.mediaId ?? "audio-media-test-id",
                    mime_type: "audio/ogg",
                    voice: true,
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

function whatsappImagePayload(
  options: {
    messageId?: string;
    from?: string;
    phoneNumberId?: string;
    mediaId?: string;
    mimeType?: string;
    caption?: string;
  } = {},
) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "business-account-test-id",
        changes: [
          {
            field: "messages",
            value: {
              metadata: {
                phone_number_id:
                  options.phoneNumberId ?? env.WHATSAPP_PHONE_NUMBER_ID,
              },
              messages: [
                {
                  id: options.messageId,
                  from: options.from ?? "573001234567",
                  type: "image",
                  image: {
                    id: options.mediaId ?? "image-media-test-id",
                    mime_type: options.mimeType ?? "image/png",
                    ...(options.caption ? { caption: options.caption } : {}),
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

function stubExternalApis({
  groqStatus = 200,
  graphStatus = 200,
  groqReply = "Miau, hola humano 🐾",
  audioTranscript = "Hola, soy una nota de voz de prueba.",
  visionReply = "La imagen muestra un producto con texto visible.",
}: {
  groqStatus?: number;
  graphStatus?: number;
  groqReply?: string;
  audioTranscript?: string;
  visionReply?: string;
} = {}) {
  let graphMessageCounter = 0;
  const externalFetch = vi.fn(
    async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const endpoint = String(input);
      if (endpoint.includes("api.groq.com")) {
        if (endpoint.includes("/audio/transcriptions")) {
          return new Response(JSON.stringify({ text: audioTranscript }), {
            status: groqStatus,
            headers: { "Content-Type": "application/json" },
          });
        }
        let isVisionRequest = false;
        try {
          const body = JSON.parse(String(init?.body ?? "{}")) as {
            messages?: Array<{ content?: unknown }>;
          };
          isVisionRequest = body.messages?.some((message) =>
            Array.isArray(message.content),
          ) ?? false;
        } catch {
          // The test stub only needs to distinguish valid JSON requests.
        }
        return new Response(
          JSON.stringify(
            groqStatus === 200
              ? {
                  choices: [{
                    message: {
                      content: isVisionRequest ? visionReply : groqReply,
                    },
                  }],
                }
              : { error: { message: "test Groq error" } },
          ),
          {
            status: groqStatus,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (endpoint.includes("audio-media-test-id")) {
        return new Response(
          JSON.stringify({
            url: "https://media.test/voice.ogg",
            mime_type: "audio/ogg",
            file_size: 3,
          }),
          {
            status: graphStatus,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (endpoint.includes("image-media-test-id")) {
        return new Response(
          JSON.stringify({
            url: "https://media.test/design.png",
            mime_type: "image/png",
            file_size: 3,
          }),
          {
            status: graphStatus,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (endpoint.startsWith("https://media.test/")) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: {
            "Content-Type": endpoint.endsWith("design.png")
              ? "image/png"
              : "audio/ogg",
          },
        });
      }

      graphMessageCounter += 1;
      return new Response(
        JSON.stringify({ messages: [{ id: `wamid.test.${graphMessageCounter}` }] }),
        {
        status: graphStatus,
        headers: { "Content-Type": "application/json" },
        },
      );
    },
  );
  vi.stubGlobal("fetch", externalFetch);
  return externalFetch;
}

async function signedPost(body: string): Promise<Response> {
  const signature = await signBody(body);
  return dispatch(
    makeRequest(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hub-Signature-256": `sha256=${signature}`,
      },
      body,
    }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("GET /health", () => {
  it("responds with a safe health payload", async () => {
    const response = await dispatch(
      makeRequest("https://example.com/health"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      service: "whatsapp-webhook",
    });
  });
});

describe("GET /webhooks/whatsapp", () => {
  it("returns exactly the challenge for valid verification", async () => {
    const challenge = "challenge with spaces & symbols";
    const url = new URL(webhookUrl);
    url.searchParams.set("hub.mode", "subscribe");
    url.searchParams.set("hub.verify_token", env.WHATSAPP_VERIFY_TOKEN);
    url.searchParams.set("hub.challenge", challenge);

    const response = await dispatch(makeRequest(url));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(challenge);
  });

  it("rejects an incorrect verification token", async () => {
    const url = new URL(webhookUrl);
    url.searchParams.set("hub.mode", "subscribe");
    url.searchParams.set("hub.verify_token", "wrong-token");
    url.searchParams.set("hub.challenge", "challenge");

    const response = await dispatch(makeRequest(url));

    expect(response.status).toBe(403);
  });

  it("rejects incomplete verification parameters", async () => {
    const url = new URL(webhookUrl);
    url.searchParams.set("hub.mode", "subscribe");
    url.searchParams.set("hub.verify_token", env.WHATSAPP_VERIFY_TOKEN);

    const response = await dispatch(makeRequest(url));

    expect(response.status).toBe(400);
  });
});

describe("POST /webhooks/whatsapp", () => {
  it("accepts a payload with a valid HMAC signature", async () => {
    const externalFetch = stubExternalApis();
    const response = await signedPost(whatsappPayload());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(externalFetch).toHaveBeenCalledTimes(3);
    expect(externalFetch).toHaveBeenCalledWith(
      "https://api.groq.com/openai/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-groq-api-key",
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(externalFetch).toHaveBeenCalledWith(
      "https://graph.facebook.com/v-test/123456789012345/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-meta-access-token",
          "Content-Type": "application/json",
        }),
      }),
    );

    const groqCall = externalFetch.mock.calls.find((call) =>
      String(call[0]).includes("api.groq.com"),
    );
    const groqInit = groqCall?.[1] as unknown as RequestInit;
    const groqBody = JSON.parse(String(groqInit.body));
    expect(groqBody).toMatchObject({
      model: "llama-3.1-8b-instant",
      temperature: 0.8,
      max_tokens: 180,
    });
    expect(groqBody.messages[0]).toMatchObject({ role: "system" });
    expect(groqBody.messages[0].content).toContain("gato");
    expect(groqBody.messages[0].content).toContain("Manolo");
    expect(groqBody.messages[1]).toEqual({
      role: "user",
      content: "hello from test",
    });

    const graphCall = externalFetch.mock.calls.find((call) =>
      isGraphReplyCall(call),
    );
    const graphInit = graphCall?.[1] as unknown as RequestInit;
    expect(JSON.parse(String(graphInit.body))).toEqual({
      messaging_product: "whatsapp",
      to: "573001234567",
      type: "text",
      text: {
        preview_url: false,
        body: "Miau, hola humano 🐾",
      },
    });
  });

  it("does not send a reply for a status-only event", async () => {
    const externalFetch = stubExternalApis();
    const response = await signedPost(whatsappStatusPayload());

    expect(response.status).toBe(200);
    expect(externalFetch).not.toHaveBeenCalled();
  });

  it("transcribes audio before sending it to the active role", async () => {
    const audioTranscript =
      "Cliente: Ana Pérez\nDNI: 12345678\nProducto de cortina 2 ud c/u: 350 soles";
    const quoteReply = JSON.stringify({
      customer: {
        name: "Ana Pérez",
        taxId: "12345678",
        phone: "",
      },
      items: [
        {
          description: "cortina",
          quantity: 2,
          unitPrice: 350,
        },
      ],
      assistantMessage: "He actualizado el borrador.",
      readyToConfirm: true,
    });
    const externalFetch = stubExternalApis({
      groqReply: quoteReply,
      audioTranscript,
    });
    const messageId = `wamid.audio.${crypto.randomUUID()}`;
    const sender = `57300${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
    const response = await signedPost(
      whatsappAudioPayload({
        messageId,
        from: sender,
        phoneNumberId: "888888888888888",
      }),
    );

    expect(response.status).toBe(200);
    expect(externalFetch).toHaveBeenCalledTimes(6);

    const transcriptionCall = externalFetch.mock.calls.find((call) =>
      String(call[0]).includes("/audio/transcriptions"),
    );
    const transcriptionInit = transcriptionCall?.[1] as unknown as RequestInit;
    const transcriptionForm = transcriptionInit.body as FormData;
    expect(transcriptionForm.get("model")).toBe("whisper-large-v3-turbo");
    expect(transcriptionForm.get("language")).toBe("es");

    const chatCall = externalFetch.mock.calls.find((call) =>
      String(call[0]).includes("/chat/completions"),
    );
    const chatInit = chatCall?.[1] as unknown as RequestInit;
    const chatBody = JSON.parse(String(chatInit.body));
    expect(JSON.parse(chatBody.messages[1].content).message).toBe(audioTranscript);

    const graphMessageCall = externalFetch.mock.calls.find((call) =>
      isGraphReplyCall(call),
    );
    const graphMessageInit = graphMessageCall?.[1] as unknown as RequestInit;
    expect(JSON.parse(String(graphMessageInit.body))).toMatchObject({
      text: { body: expect.stringContaining("Ana Pérez") },
    });

    const storedMessage = await env.DB.prepare(
      `SELECT message_type, content
       FROM messages
       WHERE meta_message_id = ?1
       LIMIT 1`,
    )
      .bind(messageId)
      .first<{ message_type: string; content: string }>();
    expect(storedMessage).toEqual({
      message_type: "audio",
      content: audioTranscript,
    });
  });

  it("analyzes an image before sending it to the active role", async () => {
    const visualDescription =
      "La imagen contiene una tela azul y el precio visible es S/ 40.";
    const externalFetch = stubExternalApis({
      visionReply: visualDescription,
    });
    const messageId = `wamid.image.${crypto.randomUUID()}`;
    const sender = `57300${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
    const response = await signedPost(
      whatsappImagePayload({
        messageId,
        from: sender,
        phoneNumberId: "888888888888888",
        caption: "¿Qué producto aparece aquí?",
      }),
    );

    expect(response.status).toBe(200);
    expect(externalFetch).toHaveBeenCalledTimes(6);

    const visionCall = externalFetch.mock.calls.find((call) => {
      if (!String(call[0]).includes("/chat/completions")) return false;
      const request = call[1] as unknown as RequestInit;
      const body = JSON.parse(String(request.body)) as {
        messages?: Array<{ content?: unknown }>;
      };
      return body.messages?.some((message) => Array.isArray(message.content)) ?? false;
    });
    const visionInit = visionCall?.[1] as unknown as RequestInit;
    const visionBody = JSON.parse(String(visionInit.body));
    expect(visionBody.model).toBe("qwen/qwen3.6-27b");
    expect(visionBody.messages[1].content[1].image_url.url).toBe(
      "data:image/png;base64,AQID",
    );

    const chatCalls = externalFetch.mock.calls.filter((call) =>
      String(call[0]).includes("/chat/completions"),
    );
    const roleBody = JSON.parse(String((chatCalls.at(-1)?.[1] as RequestInit).body));
    expect(roleBody.messages.at(-1).content).toContain(visualDescription);
    expect(roleBody.messages[0].content).toContain("INFORMACIÓN VISUAL");

    const storedMessage = await env.DB.prepare(
      `SELECT message_type, content
       FROM messages
       WHERE meta_message_id = ?1
       LIMIT 1`,
    )
      .bind(messageId)
      .first<{ message_type: string; content: string }>();
    expect(storedMessage).toEqual({
      message_type: "image",
      content: expect.stringContaining(visualDescription),
    });
  });

  it("keeps the webhook successful when the Graph API rejects the reply", async () => {
    const externalFetch = stubExternalApis({ graphStatus: 500 });
    const response = await signedPost(whatsappPayload());

    expect(response.status).toBe(200);
    expect(externalFetch).toHaveBeenCalledTimes(3);
  });

  it("uses a safe cat fallback when Groq rejects the request", async () => {
    const externalFetch = stubExternalApis({ groqStatus: 500 });
    const response = await signedPost(whatsappPayload());

    expect(response.status).toBe(200);
    expect(externalFetch).toHaveBeenCalledTimes(3);

    const graphCall = externalFetch.mock.calls.find((call) =>
      isGraphReplyCall(call),
    );
    const graphInit = graphCall?.[1] as unknown as RequestInit;
    expect(JSON.parse(String(graphInit.body))).toMatchObject({
      text: {
        body: expect.stringContaining("Miau"),
      },
    });
  });

  it("routes quote messages and stores a draft with items in D1", async () => {
    const quoteReply = JSON.stringify({
      customer: {
        name: "Juan Pérez",
        taxId: "12345678",
        phone: "999888777",
      },
      items: [
        {
          description: "Cortina roller blackout",
          quantity: 2,
          unitPrice: 350,
        },
      ],
      assistantMessage: "Perfecto, preparé el borrador de la cotización.",
      readyToConfirm: true,
    });
    const externalFetch = stubExternalApis({ groqReply: quoteReply });
    const messageId = `wamid.quote.${crypto.randomUUID()}`;
    const sender = `57300${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
    const response = await signedPost(
      whatsappPayload("Necesito cotizar 2 cortinas roller blackout a 350 soles para Juan", {
        messageId,
        from: sender,
        phoneNumberId: "888888888888888",
      }),
    );

    expect(response.status).toBe(200);
    expect(externalFetch).toHaveBeenCalledTimes(3);
    const groqCall = externalFetch.mock.calls.find((call) =>
      String(call[0]).includes("api.groq.com"),
    );
    const groqInit = groqCall?.[1] as unknown as RequestInit;
    const groqBody = JSON.parse(String(groqInit.body));
    expect(groqBody).toMatchObject({
      model: "openai/gpt-oss-20b",
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "quote_extraction",
          strict: true,
        },
      },
    });
    const graphCall = externalFetch.mock.calls.find((call) =>
      isGraphReplyCall(call),
    );
    const graphInit = graphCall?.[1] as unknown as RequestInit;
    expect(JSON.parse(String(graphInit.body))).toMatchObject({
      text: { body: expect.stringContaining("Juan Pérez") },
    });

    const draft = await env.DB.prepare(
      `SELECT qd.status, qd.customer_name, qi.description, qi.quantity, qi.unit_price
       FROM quote_drafts qd
       INNER JOIN contacts c ON c.id = qd.contact_id
       INNER JOIN quote_items qi ON qi.draft_id = qd.id
       WHERE c.whatsapp_user_id = ?1
       ORDER BY qd.created_at DESC, qi.position ASC
       LIMIT 1`,
    )
      .bind(sender)
      .first<{
        status: string;
        customer_name: string;
        description: string;
        quantity: number;
        unit_price: number;
      }>();

    expect(draft).toEqual({
      status: "ready",
      customer_name: "Juan Pérez",
      description: "Cortina roller blackout",
      quantity: 2,
      unit_price: 350,
    });
  });

  it("recovers quote data from a structured Spanish message when Groq omits fields", async () => {
    const quoteReply = JSON.stringify({
      assistantMessage: "He actualizado el borrador.",
      items: [],
      readyToConfirm: false,
    });
    const externalFetch = stubExternalApis({ groqReply: quoteReply });
    const messageId = `wamid.quote-fallback.${crypto.randomUUID()}`;
    const sender = `57300${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
    const response = await signedPost(
      whatsappPayload(
        "Cliente: Diogo Abreug\nDni: 71434912\nteelefono: 923790280\ny el producto de tela 15m 2 ud c/u : 10 soles",
        {
          messageId,
          from: sender,
          phoneNumberId: "888888888888888",
        },
      ),
    );

    expect(response.status).toBe(200);
    const graphCall = externalFetch.mock.calls.find((call) =>
      isGraphReplyCall(call),
    );
    const graphInit = graphCall?.[1] as unknown as RequestInit;
    expect(JSON.parse(String(graphInit.body))).toMatchObject({
      text: {
        body: expect.stringContaining("Diogo Abreug"),
      },
    });

    const draft = await env.DB.prepare(
      `SELECT qd.status, qd.customer_name, qd.customer_tax_id, qd.customer_phone,
              qi.description, qi.quantity, qi.unit_price
       FROM quote_drafts qd
       INNER JOIN contacts c ON c.id = qd.contact_id
       INNER JOIN quote_items qi ON qi.draft_id = qd.id
       WHERE c.whatsapp_user_id = ?1
       ORDER BY qd.created_at DESC, qi.position ASC
       LIMIT 1`,
    )
      .bind(sender)
      .first<{
        status: string;
        customer_name: string;
        customer_tax_id: string;
        customer_phone: string;
        description: string;
        quantity: number;
        unit_price: number;
      }>();

    expect(draft).toEqual({
      status: "ready",
      customer_name: "Diogo Abreug",
      customer_tax_id: "71434912",
      customer_phone: "923790280",
      description: "tela 15m",
      quantity: 2,
      unit_price: 10,
    });
  });

  it("calculates unit price when the user gives a total purchase amount", async () => {
    const quoteReply = JSON.stringify({
      customer: {
        name: "Diogo Abreug",
        taxId: "71434912",
        phone: "923790280",
      },
      items: [
        { description: "florero", quantity: 1, unitPrice: 0 },
      ],
      assistantMessage: "He actualizado el borrador.",
      readyToConfirm: true,
    });
    const externalFetch = stubExternalApis({ groqReply: quoteReply });
    const messageId = `wamid.quote-total.${crypto.randomUUID()}`;
    const sender = `57300${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
    const response = await signedPost(
      whatsappPayload(
        "Cliente: Diogo Abreug\nDni: 71434912\nteelefono: 923790280\nMe gaste 40 soles y compre 2 floreros",
        {
          messageId,
          from: sender,
          phoneNumberId: "888888888888888",
        },
      ),
    );

    expect(response.status).toBe(200);
    const graphCall = externalFetch.mock.calls.find((call) =>
      isGraphReplyCall(call),
    );
    const graphInit = graphCall?.[1] as unknown as RequestInit;
    expect(JSON.parse(String(graphInit.body))).toMatchObject({
      text: {
        body: expect.stringContaining("2 × floreros — S/ 20.00"),
      },
    });

    const draft = await env.DB.prepare(
      `SELECT qd.status, qi.description, qi.quantity, qi.unit_price
       FROM quote_drafts qd
       INNER JOIN contacts c ON c.id = qd.contact_id
       INNER JOIN quote_items qi ON qi.draft_id = qd.id
       WHERE c.whatsapp_user_id = ?1
       ORDER BY qd.created_at DESC, qi.position ASC
       LIMIT 1`,
    )
      .bind(sender)
      .first<{
        status: string;
        description: string;
        quantity: number;
        unit_price: number;
      }>();

    expect(draft).toEqual({
      status: "ready",
      description: "floreros",
      quantity: 2,
      unit_price: 20,
    });
  });

  it("rejects a request without a signature", async () => {
    const response = await dispatch(
      makeRequest(webhookUrl, {
        method: "POST",
        body: whatsappPayload(),
      }),
    );

    expect(response.status).toBe(401);
  });

  it("rejects an incorrect signature", async () => {
    const response = await dispatch(
      makeRequest(webhookUrl, {
        method: "POST",
        headers: { "X-Hub-Signature-256": `sha256=${"00".repeat(32)}` },
        body: whatsappPayload(),
      }),
    );

    expect(response.status).toBe(401);
  });

  it("rejects a signature calculated over different bytes", async () => {
    const originalBody = whatsappPayload("original");
    const changedBody = whatsappPayload("changed");
    const originalSignature = await signBody(originalBody);
    const response = await dispatch(
      makeRequest(webhookUrl, {
        method: "POST",
        headers: { "X-Hub-Signature-256": `sha256=${originalSignature}` },
        body: changedBody,
      }),
    );

    expect(response.status).toBe(401);
  });

  it("controls invalid JSON even when its signature is valid", async () => {
    const response = await signedPost('{"object":');

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_json" });
  });

  it("accepts unknown WhatsApp fields without throwing", async () => {
    const response = await signedPost(
      JSON.stringify({
        object: "whatsapp_business_account",
        entry: [{ unknown: true }],
      }),
    );

    expect(response.status).toBe(200);
  });

  it("does not log message content or secrets", async () => {
    stubExternalApis({ groqReply: "private AI reply" });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const secret = env.META_APP_SECRET;
    const accessToken = env.META_ACCESS_TOKEN;
    const groqApiKey = env.GROQ_API_KEY;
    const message = "private message content that must not be logged";

    const response = await signedPost(whatsappPayload(message));

    expect(response.status).toBe(200);
    const output = logSpy.mock.calls.flat().join(" ");
    expect(output).not.toContain(message);
    expect(output).not.toContain(secret);
    expect(output).not.toContain(accessToken);
    expect(output).not.toContain(groqApiKey);
    expect(output).not.toContain("private AI reply");
    expect(output).not.toContain("business-account-test-id");
    expect(output).toContain("whatsapp_webhook_received");
  });
});

describe("routing", () => {
  it("returns 404 for an unknown route", async () => {
    const response = await dispatch(makeRequest("https://example.com/nope"));

    expect(response.status).toBe(404);
  });

  it("returns 405 and Allow for a wrong method on a known route", async () => {
    const response = await dispatch(
      makeRequest("https://example.com/health", { method: "POST" }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET");
  });

  it("returns 405 and Allow for unsupported webhook methods", async () => {
    const response = await dispatch(
      makeRequest(webhookUrl, { method: "PUT" }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, POST");
  });
});
