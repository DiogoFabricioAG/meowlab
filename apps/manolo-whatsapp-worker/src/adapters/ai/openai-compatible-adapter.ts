import type {
  AiCompletionRequest,
  AiCompletionResult,
  AiLogger,
  AiProvider,
  AiTool,
  AiToolCall,
  AiToolCompletionRequest,
} from "../../ai/contracts";
import { toOpenAiMessages } from "./openai-wire";

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOfficialOpenAiApi(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLocaleLowerCase("en") === "api.openai.com";
  } catch {
    return false;
  }
}

function isOpenAiReasoningModel(model: string): boolean {
  return /^(?:gpt-5(?:[.-]|$)|o\d(?:[.-]|$))/iu.test(model.trim());
}

function buildCompletionBody(
  request: AiCompletionRequest,
  tools: readonly AiTool[],
  toolChoice: "auto" | "none",
  officialOpenAiApi: boolean,
): JsonObject {
  const model = request.model.trim();
  const body: JsonObject = {
    model,
    messages: toOpenAiMessages(request.messages),
  };

  if (officialOpenAiApi) {
    body.max_completion_tokens = request.maxTokens;
    if (!request.reasoningEffort || !isOpenAiReasoningModel(model)) {
      body.temperature = request.temperature;
    }
  } else {
    body.max_tokens = request.maxTokens;
    body.temperature = request.temperature;
  }

  if (request.reasoningEffort) body.reasoning_effort = request.reasoningEffort;
  if (request.responseFormat) body.response_format = request.responseFormat;
  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = toolChoice;
    body.parallel_tool_calls = false;
  }
  return body;
}

async function apiErrorDetails(response: Response): Promise<Record<string, unknown>> {
  const details: Record<string, unknown> = { status: response.status };
  const requestId = response.headers.get("x-request-id");
  if (requestId) details.requestId = requestId;

  try {
    const payload: unknown = await response.json();
    const error = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
    if (!error) return details;
    if (typeof error.type === "string") details.errorType = error.type;
    if (typeof error.code === "string") details.errorCode = error.code;
    if (typeof error.param === "string") details.errorParam = error.param;
  } catch {
    // The status and request id are still enough to correlate the provider failure.
  }
  return details;
}

function extractResult(value: unknown): AiCompletionResult | null {
  if (!isRecord(value) || !Array.isArray(value.choices)) return null;
  const choice = value.choices[0];
  const message = isRecord(choice) && isRecord(choice.message) ? choice.message : null;
  if (!message) return null;

  const content = typeof message.content === "string" && message.content.trim()
    ? message.content.trim()
    : null;
  const toolCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls.flatMap((rawCall): AiToolCall[] => {
        if (!isRecord(rawCall) || typeof rawCall.id !== "string" || !isRecord(rawCall.function)) {
          return [];
        }
        const fn = rawCall.function;
        return typeof fn.name === "string" && typeof fn.arguments === "string"
          ? [{ id: rawCall.id, name: fn.name, arguments: fn.arguments }]
          : [];
      })
    : [];

  return content || toolCalls.length > 0 ? { content, toolCalls } : null;
}

export type OpenAiCompatibleConfig = {
  apiKey?: string;
  baseUrl?: string;
};

export class OpenAiCompatibleAdapter implements AiProvider {
  readonly key = "openai";

  constructor(private readonly config: OpenAiCompatibleConfig) {}

  async complete(request: AiCompletionRequest, log: AiLogger): Promise<string | null> {
    return (await this.requestCompletion(request, [], "auto", log))?.content ?? null;
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
    const apiKey = this.config.apiKey?.trim();
    const baseUrl = this.config.baseUrl?.trim().replace(/\/$/, "");
    if (!apiKey || !baseUrl || !request.model.trim()) {
      log("whatsapp_ai_provider_failed", {
        provider: this.key,
        operation: "completion",
        reason: "missing_configuration",
      });
      return null;
    }

    const body = buildCompletionBody(
      request,
      tools,
      toolChoice,
      isOfficialOpenAiApi(baseUrl),
    );

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        log("whatsapp_ai_provider_failed", {
          provider: this.key,
          operation: "completion",
          reason: "api_error",
          ...(await apiErrorDetails(response)),
        });
        return null;
      }

      const result = extractResult(await response.json());
      if (!result) {
        log("whatsapp_ai_provider_failed", {
          provider: this.key,
          operation: "completion",
          reason: "invalid_api_response",
        });
        return null;
      }
      return result;
    } catch {
      log("whatsapp_ai_provider_failed", {
        provider: this.key,
        operation: "completion",
        reason: "request_error",
      });
      return null;
    }
  }
}
