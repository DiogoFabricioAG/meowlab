import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiCompatibleAdapter } from "../src/adapters/ai/openai-compatible-adapter";

describe("OpenAiCompatibleAdapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("omits unsupported temperature when a reasoning model uses its default effort", async () => {
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).not.toHaveProperty("temperature");
      expect(body.model).toBe("gpt-6-luna");
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"patch":{}}' } }] }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new OpenAiCompatibleAdapter({ apiKey: "test-key", baseUrl: "https://api.openai.com/v1" });
    expect(await adapter.complete({ model: "gpt-6-luna", temperature: 0, maxTokens: 6000,
      messages: [{ role: "user", content: "Peso 160 kilos" }], responseFormat: { type: "json_object" } }, vi.fn())).toBe('{"patch":{}}');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each(["gpt-5.6-luna", "gpt-6-luna"])("sends the exact reasoning model %s through Chat Completions", async (model) => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.openai.com/v1/chat/completions");

      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.model).toBe(model);
      expect(body.reasoning_effort).toBe("high");
      expect(body.response_format).toEqual({ type: "json_object" });
      expect(body.max_completion_tokens).toBe(400);
      expect(body).not.toHaveProperty("max_tokens");
      expect(body).not.toHaveProperty("temperature");

      return new Response(JSON.stringify({
        choices: [{ message: { content: "respuesta empresarial" } }],
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new OpenAiCompatibleAdapter({
      apiKey: "enterprise-key",
      baseUrl: "https://api.openai.com/v1",
    });

    await expect(adapter.complete({
      model,
      messages: [
        { role: "system", content: "Eres un asesor empresarial." },
        { role: "user", content: "Resume las ventas." },
      ],
      temperature: 0.2,
      maxTokens: 400,
      reasoningEffort: "high",
      responseFormat: { type: "json_object" },
    }, vi.fn())).resolves.toBe("respuesta empresarial");
  });

  it("keeps legacy token and temperature fields for non-OpenAI compatible APIs", async () => {
    const fetchMock = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.max_tokens).toBe(300);
      expect(body.temperature).toBe(0.3);
      expect(body).not.toHaveProperty("max_completion_tokens");
      return new Response(JSON.stringify({
        choices: [{ message: { content: "compatible" } }],
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new OpenAiCompatibleAdapter({
      apiKey: "compatible-key",
      baseUrl: "https://models.example.com/v1",
    });

    await expect(adapter.complete({
      model: "custom-model",
      messages: [{ role: "user", content: "hola" }],
      temperature: 0.3,
      maxTokens: 300,
    }, vi.fn())).resolves.toBe("compatible");
  });

  it("logs sanitized OpenAI error metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: {
        message: "Sensitive provider detail",
        type: "invalid_request_error",
        code: "unsupported_value",
        param: "temperature",
      },
    }), {
      status: 400,
      headers: { "x-request-id": "req_test" },
    })));
    const log = vi.fn();
    const adapter = new OpenAiCompatibleAdapter({
      apiKey: "enterprise-key",
      baseUrl: "https://api.openai.com/v1",
    });

    await expect(adapter.complete({
      model: "gpt-5.6-luna",
      messages: [{ role: "user", content: "hola" }],
      temperature: 0.2,
      maxTokens: 300,
      reasoningEffort: "high",
    }, log)).resolves.toBeNull();

    expect(log).toHaveBeenCalledWith("whatsapp_ai_provider_failed", expect.objectContaining({
      status: 400,
      requestId: "req_test",
      errorType: "invalid_request_error",
      errorCode: "unsupported_value",
      errorParam: "temperature",
    }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("Sensitive provider detail");
  });

  it("calls /v1/decisions with gpt-6-luna and parses structured answers", async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.openai.com/v1/decisions");
      expect(init?.method).toBe("POST");

      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.model).toBe("gpt-6-luna");
      expect(body.input).toBe("Me puedes mostrar las facturas que hice esta ultima semana");
      expect(Array.isArray(body.questions)).toBe(true);
      expect((body.questions as { choices: unknown[] }[])[0].choices).toEqual([
        { value: "greeting_or_ambiguous" }, { value: "elaborate_request" },
      ]);

      return new Response(JSON.stringify({
        id: "dec_12345",
        model: "gpt-6-luna",
        answers: [
          {
            type: "choice",
            name: "request_nature",
            choice: "elaborate_request",
            confidence: 0.98,
            probabilities: [{ value: "greeting_or_ambiguous", probability: 0.02 }, { value: "elaborate_request", probability: 0.98 }],
          },
          {
            type: "predicate",
            name: "is_elaborate_request",
            probability: 0.95,
          },
        ],
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new OpenAiCompatibleAdapter({
      apiKey: "enterprise-key",
      baseUrl: "https://api.openai.com/v1",
    });

    const result = await adapter.decide({
      model: "gpt-6-luna",
      input: "Me puedes mostrar las facturas que hice esta ultima semana",
      questions: [
        {
          type: "choice",
          name: "request_nature",
          instructions: "Clasifica el mensaje.",
          choices: ["greeting_or_ambiguous", "elaborate_request"],
        },
        {
          type: "predicate",
          name: "is_elaborate_request",
          instructions: "Determina si es elaborado.",
        },
      ],
    }, vi.fn());

    expect(result).not.toBeNull();
    expect(result?.answers).toHaveLength(2);
    expect(result?.answers[0]).toEqual({
      type: "choice",
      name: "request_nature",
      choice: "elaborate_request",
      confidence: 0.98,
      probabilities: { greeting_or_ambiguous: 0.02, elaborate_request: 0.98 },
    });
    expect(result?.answers[1]).toEqual({
      type: "predicate",
      name: "is_elaborate_request",
      probability: 0.95,
    });
  });

  it("handles Decisions API failure gracefully and logs sanitized error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: {
        message: "Decisions endpoint unavailable",
        type: "invalid_request_error",
        code: "model_not_found",
      },
    }), {
      status: 404,
      headers: { "x-request-id": "req_dec_fail" },
    })));
    const log = vi.fn();
    const adapter = new OpenAiCompatibleAdapter({
      apiKey: "enterprise-key",
      baseUrl: "https://api.openai.com/v1",
    });

    const result = await adapter.decide({
      input: "hola",
      questions: [{ type: "predicate", name: "is_elaborate", instructions: "test" }],
    }, log);

    expect(result).toBeNull();
    expect(log).toHaveBeenCalledWith("whatsapp_ai_provider_failed", expect.objectContaining({
      operation: "decisions",
      status: 404,
      requestId: "req_dec_fail",
    }));
  });
});
