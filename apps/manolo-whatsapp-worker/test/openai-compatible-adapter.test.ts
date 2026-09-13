import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiCompatibleAdapter } from "../src/adapters/ai/openai-compatible-adapter";

describe("OpenAiCompatibleAdapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the exact enterprise model through Chat Completions", async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.openai.com/v1/chat/completions");

      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.model).toBe("gpt-5.6-luna");
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
      model: "gpt-5.6-luna",
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
});
