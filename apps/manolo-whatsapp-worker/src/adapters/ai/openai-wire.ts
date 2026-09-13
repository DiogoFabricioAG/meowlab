import type { AiMessage } from "../../ai/contracts";

type JsonObject = Record<string, unknown>;

export function toOpenAiMessages(
  messages: readonly AiMessage[],
): readonly JsonObject[] {
  return messages.map((message) => {
    if (message.role === "assistant") {
      return {
        role: message.role,
        ...(message.content === null ? {} : { content: message.content }),
        ...(message.toolCalls && message.toolCalls.length > 0
          ? {
              tool_calls: message.toolCalls.map((toolCall) => ({
                id: toolCall.id,
                type: "function",
                function: {
                  name: toolCall.name,
                  arguments: toolCall.arguments,
                },
              })),
            }
          : {}),
      };
    }

    if (message.role === "tool") {
      return {
        role: message.role,
        content: message.content,
        tool_call_id: message.toolCallId,
        name: message.name,
      };
    }

    return { role: message.role, content: message.content };
  });
}
