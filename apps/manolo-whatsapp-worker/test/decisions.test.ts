import { describe, expect, it, vi } from "vitest";
import { isElaborateRequestFallback, isElaborateUserRequest } from "../src/ai/decisions";
import type { AiDecisionsRequest, AiDecisionsResult, AiProvider } from "../src/ai/contracts";

describe("isElaborateUserRequest with OpenAI Decisions API", () => {
  it("uses Decisions API with gpt-6-luna to classify elaborate query as true", async () => {
    const decideMock = vi.fn(async (request: AiDecisionsRequest): Promise<AiDecisionsResult> => {
      expect(request.model).toBe("gpt-6-luna");
      expect(request.input).toBe("Me puedes mostrar las facturas que hice esta ultima semana");
      expect(request.questions[0].name).toBe("request_nature");

      return {
        id: "dec_test1",
        answers: [
          {
            type: "choice",
            name: "request_nature",
            choice: "elaborate_request",
            confidence: 0.96,
          },
        ],
      };
    });

    const ai: AiProvider = {
      key: "openai",
      complete: vi.fn(),
      decide: decideMock,
    };

    const log = vi.fn();
    const result = await isElaborateUserRequest(
      ai,
      "gpt-6-luna",
      "Me puedes mostrar las facturas que hice esta ultima semana",
      log,
    );

    expect(result).toBe(true);
    expect(decideMock).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("whatsapp_decisions_evaluated", {
      choice: "elaborate_request",
      confidence: 0.96,
    });
  });

  it("uses Decisions API to classify greeting / ambiguous start as false", async () => {
    const decideMock = vi.fn(async (request: AiDecisionsRequest): Promise<AiDecisionsResult> => {
      expect(request.model).toBe("gpt-6-luna");
      expect(request.input).toBe("Hola Manolo buenas tardes");

      return {
        id: "dec_test2",
        answers: [
          {
            type: "choice",
            name: "request_nature",
            choice: "greeting_or_ambiguous",
            confidence: 0.99,
          },
        ],
      };
    });

    const ai: AiProvider = {
      key: "openai",
      complete: vi.fn(),
      decide: decideMock,
    };

    const result = await isElaborateUserRequest(
      ai,
      "gpt-6-luna",
      "Hola Manolo buenas tardes",
      vi.fn(),
    );

    expect(result).toBe(false);
  });

  it("supports predicate answer probability from Decisions API", async () => {
    const ai: AiProvider = {
      key: "openai",
      complete: vi.fn(),
      decide: vi.fn(async (): Promise<AiDecisionsResult> => ({
        answers: [
          {
            type: "predicate",
            name: "is_elaborate_request",
            probability: 0.12,
          },
        ],
      })),
    };

    const result = await isElaborateUserRequest(ai, "gpt-6-luna", "hola", vi.fn());
    expect(result).toBe(false);
  });

  it("gracefully falls back to heuristic when Decisions API is unavailable or returns null", async () => {
    const ai: AiProvider = {
      key: "openai",
      complete: vi.fn(),
      decide: vi.fn(async () => null),
    };

    expect(await isElaborateUserRequest(ai, "gpt-6-luna", "hola", vi.fn())).toBe(false);
    expect(await isElaborateUserRequest(ai, "gpt-6-luna", "buenas tardes", vi.fn())).toBe(false);
    expect(await isElaborateUserRequest(ai, "gpt-6-luna", "ayuda", vi.fn())).toBe(false);
    expect(await isElaborateUserRequest(ai, "gpt-6-luna", "Me puedes mostrar las facturas que hice esta ultima semana", vi.fn())).toBe(true);
    expect(await isElaborateUserRequest(undefined, "gpt-6-luna", "hola", vi.fn())).toBe(false);
  });

  it("evaluates heuristic fallback correctly for greetings vs elaborate prompts", () => {
    expect(isElaborateRequestFallback("")).toBe(false);
    expect(isElaborateRequestFallback("hola")).toBe(false);
    expect(isElaborateRequestFallback("Hola Manolo")).toBe(false);
    expect(isElaborateRequestFallback("buenas tardes")).toBe(false);
    expect(isElaborateRequestFallback("ola")).toBe(false);
    expect(isElaborateRequestFallback("empezar")).toBe(false);
    expect(isElaborateRequestFallback("menu")).toBe(false);
    expect(isElaborateRequestFallback("Me puedes mostrar las facturas que hice esta ultima semana")).toBe(true);
    expect(isElaborateRequestFallback("Quiero ver las boletas del mes")).toBe(true);
  });
});
