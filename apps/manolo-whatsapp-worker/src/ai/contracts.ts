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

export type DecisionQuestion =
  | {
      type: "predicate";
      name: string;
      instructions: string;
    }
  | {
      type: "choice";
      name: string;
      instructions: string;
      choices: readonly (string | { value: string; description?: string })[];
    }
  | {
      type: "score";
      name: string;
      instructions: string;
      levels?: readonly string[];
    };

export type DecisionAnswer =
  | {
      type: "predicate";
      name: string;
      probability: number;
    }
  | {
      type: "choice";
      name: string;
      choice: string;
      probabilities?: Record<string, number>;
      confidence?: number;
    }
  | {
      type: "score";
      name: string;
      score: number;
      probabilities?: Record<string, number>;
      confidence?: number;
    };

export type AiDecisionsRequest = {
  model?: string;
  input: string | readonly AiMessage[];
  questions: readonly DecisionQuestion[];
};

export type AiDecisionsResult = {
  id?: string;
  model?: string;
  answers: readonly DecisionAnswer[];
};

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
  decide?(
    request: AiDecisionsRequest,
    log: AiLogger,
  ): Promise<AiDecisionsResult | null>;
}

export interface AudioTranscriber {
  readonly key: string;
  transcribe(
    request: AudioTranscriptionRequest,
    log: AiLogger,
  ): Promise<string | null>;
}
