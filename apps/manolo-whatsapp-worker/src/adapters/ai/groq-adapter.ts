import type {
  AiCompletionRequest,
  AiCompletionResult,
  AiLogger,
  AiProvider,
  AiTool,
  AiToolCall,
  AiToolCompletionRequest,
  AudioTranscriptionRequest,
  AudioTranscriber,
} from "../../ai/contracts";
import { toOpenAiMessages } from "./openai-wire";

const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_TRANSCRIPTION_URL =
  "https://api.groq.com/openai/v1/audio/transcriptions";

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractChatMessage(value: unknown): JsonObject | null {
  if (!isRecord(value) || !Array.isArray(value.choices)) {
    return null;
  }

  const firstChoice = value.choices[0];
  const message = isRecord(firstChoice) ? firstChoice.message : null;
  return isRecord(message) ? message : null;
}

function extractContent(message: JsonObject): string | null {
  return typeof message.content === "string" && message.content.trim().length > 0
    ? message.content.trim()
    : null;
}

function extractToolCalls(message: JsonObject): AiToolCall[] {
  if (!Array.isArray(message.tool_calls)) {
    return [];
  }

  return message.tool_calls.flatMap((rawCall): AiToolCall[] => {
    if (!isRecord(rawCall) || typeof rawCall.id !== "string") {
      return [];
    }
    const functionData = isRecord(rawCall.function) ? rawCall.function : null;
    if (
      !functionData ||
      typeof functionData.name !== "string" ||
      typeof functionData.arguments !== "string"
    ) {
      return [];
    }

    return [{
      id: rawCall.id,
      name: functionData.name,
      arguments: functionData.arguments,
    }];
  });
}

function logProviderFailure(
  log: AiLogger,
  operation: "completion" | "transcription",
  reason: string,
  status?: number,
  additional: JsonObject = {},
): void {
  log("whatsapp_ai_provider_failed", {
    provider: "groq",
    operation,
    reason,
    ...(status === undefined ? {} : { status }),
    ...additional,
  });
}

export class GroqAdapter implements AiProvider, AudioTranscriber {
  readonly key = "groq";

  constructor(private readonly apiKey: string | undefined) {}

  async complete(
    request: AiCompletionRequest,
    log: AiLogger,
  ): Promise<string | null> {
    const result = await this.requestCompletion(request, [], "auto", log);
    return result?.content ?? null;
  }

  async completeWithTools(
    request: AiToolCompletionRequest,
    log: AiLogger,
  ): Promise<AiCompletionResult | null> {
    return this.requestCompletion(
      request,
      request.tools,
      request.toolChoice ?? "auto",
      log,
    );
  }

  private async requestCompletion(
    request: AiCompletionRequest,
    tools: readonly AiTool[],
    toolChoice: "auto" | "none",
    log: AiLogger,
  ): Promise<AiCompletionResult | null> {
    if (!this.apiKey?.trim() || !request.model.trim()) {
      logProviderFailure(log, "completion", "missing_configuration");
      return null;
    }

    const body: JsonObject = {
      model: request.model.trim(),
      messages: toOpenAiMessages(request.messages),
      temperature: request.temperature,
      max_tokens: request.maxTokens,
    };
    if (request.reasoningEffort) {
      body.reasoning_effort = request.reasoningEffort;
    }
    if (tools.length > 0) {
      body.tools = tools;
      body.tool_choice = toolChoice;
      body.parallel_tool_calls = false;
    }
    if (request.responseFormat) {
      body.response_format = request.responseFormat;
    }

    try {
      const response = await fetch(GROQ_CHAT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        let errorType: string | undefined;
        let errorCode: string | undefined;
        let failedGeneration = false;
        try {
          const payload: unknown = await response.json();
          const error = isRecord(payload) && isRecord(payload.error)
            ? payload.error
            : null;
          errorType = error && typeof error.type === "string"
            ? error.type
            : undefined;
          errorCode = error && typeof error.code === "string"
            ? error.code
            : undefined;
          failedGeneration = Boolean(error && error.failed_generation);
        } catch {
          // The provider can return a non-JSON error body; status is enough.
        }
        logProviderFailure(log, "completion", "api_error", response.status, {
          ...(errorType ? { errorType } : {}),
          ...(errorCode ? { errorCode } : {}),
          ...(failedGeneration ? { failedGeneration: true } : {}),
        });
        return null;
      }

      const message = extractChatMessage(await response.json());
      if (!message) {
        logProviderFailure(log, "completion", "invalid_api_response");
        return null;
      }

      const content = extractContent(message);
      const toolCalls = extractToolCalls(message);
      if (!content && toolCalls.length === 0) {
        logProviderFailure(log, "completion", "empty_response");
        return null;
      }

      return { content, toolCalls };
    } catch {
      logProviderFailure(log, "completion", "request_error");
      return null;
    }
  }

  async transcribe(
    request: AudioTranscriptionRequest,
    log: AiLogger,
  ): Promise<string | null> {
    if (!this.apiKey?.trim() || !request.model.trim()) {
      logProviderFailure(log, "transcription", "missing_configuration");
      return null;
    }

    const form = new FormData();
    form.append("file", request.audio, request.fileName);
    form.append("model", request.model.trim());
    form.append("language", request.language);
    form.append("response_format", "json");
    form.append("temperature", "0");
    form.append("prompt", request.prompt);

    try {
      const response = await fetch(GROQ_TRANSCRIPTION_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
      });
      if (!response.ok) {
        logProviderFailure(log, "transcription", "api_error", response.status);
        return null;
      }

      const data: unknown = await response.json();
      const text = isRecord(data) && typeof data.text === "string"
        ? data.text.trim()
        : "";
      if (!text) {
        logProviderFailure(log, "transcription", "empty_response");
        return null;
      }
      return text;
    } catch {
      logProviderFailure(log, "transcription", "request_error");
      return null;
    }
  }
}
