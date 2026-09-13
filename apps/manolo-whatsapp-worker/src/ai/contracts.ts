export type AiContentPart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image_url";
      image_url: {
        url: string;
        detail?: "auto" | "low" | "high";
      };
    };

export type AiMessage = {
  role: "system" | "user";
  content: string | readonly AiContentPart[];
} | {
  role: "assistant";
  content: string | null;
  toolCalls?: readonly AiToolCall[];
} | {
  role: "tool";
  content: string;
  toolCallId: string;
  name: string;
};

export type AiCompletionRequest = {
  model: string;
  messages: readonly AiMessage[];
  temperature: number;
  maxTokens: number;
  reasoningEffort?: "low" | "medium" | "high";
  responseFormat?: Record<string, unknown>;
};

export type AudioTranscriptionRequest = {
  model: string;
  audio: Blob;
  fileName: string;
  mimeType: string;
  language: string;
  prompt: string;
};

export type AiTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type AiToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type AiCompletionResult = {
  content: string | null;
  toolCalls: readonly AiToolCall[];
};

export type AiToolCompletionRequest = AiCompletionRequest & {
  tools: readonly AiTool[];
  toolChoice?: "auto" | "none";
};

export type AiLogger = (
  event: string,
  details?: Record<string, unknown>,
) => void;

export interface AiProvider {
  readonly key: string;
  complete(
    request: AiCompletionRequest,
    log: AiLogger,
  ): Promise<string | null>;
  completeWithTools?(
    request: AiToolCompletionRequest,
    log: AiLogger,
  ): Promise<AiCompletionResult | null>;
}

export interface AudioTranscriber {
  readonly key: string;
  transcribe(
    request: AudioTranscriptionRequest,
    log: AiLogger,
  ): Promise<string | null>;
}
