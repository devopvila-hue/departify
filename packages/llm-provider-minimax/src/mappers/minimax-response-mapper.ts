import type {
  ChatResponse,
  CompletionResponse,
  StreamChunk,
} from "@departify/llm-router";
import { MiniMaxProviderError } from "../errors/minimax-provider-error.js";
import type {
  MiniMaxChatCompletionResult,
  MiniMaxStreamChunk,
} from "../client/minimax-client.js";

export function mapMiniMaxChatResponse(
  requestId: string,
  providerId: string,
  modelId: string,
  result: MiniMaxChatCompletionResult,
): ChatResponse {
  const choice = result.choices[0];
  const message = choice?.message?.content ?? "";

  return {
    type: "chat",
    requestId,
    providerId,
    modelId,
    message,
    ...(choice?.message?.tool_calls
      ? {
          toolCalls: choice.message.tool_calls.map((toolCall) => ({
            name: toolCall.function?.name ?? "",
            arguments: parseToolArguments(toolCall.function?.arguments ?? "{}"),
          })),
        }
      : {}),
    ...mapUsage(result),
    ...mapStructuredOutput(message),
  };
}

export function mapMiniMaxCompletionResponse(
  requestId: string,
  providerId: string,
  modelId: string,
  result: MiniMaxChatCompletionResult,
): CompletionResponse {
  const text = result.choices[0]?.message?.content ?? "";
  return {
    type: "completion",
    requestId,
    providerId,
    modelId,
    text,
    ...mapUsage(result),
    ...mapStructuredOutput(text),
  };
}

export function mapMiniMaxStreamChunk(
  requestId: string,
  sequence: number,
  chunk: MiniMaxStreamChunk,
): StreamChunk {
  return {
    requestId,
    sequence,
    contentDelta: chunk.choices[0]?.delta?.content ?? "",
    done: false,
  };
}

function mapUsage(
  result: MiniMaxChatCompletionResult,
): Pick<ChatResponse, "usage"> {
  if (!result.usage) {
    return {};
  }
  return {
    usage: {
      inputTokens: result.usage.prompt_tokens ?? 0,
      outputTokens: result.usage.completion_tokens ?? 0,
    },
  };
}

function mapStructuredOutput(
  content: string,
): Pick<ChatResponse, "structuredOutput"> {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) {
    return {};
  }
  try {
    const parsed = JSON.parse(trimmed) as Readonly<Record<string, unknown>>;
    return { structuredOutput: parsed };
  } catch {
    return {};
  }
}

function parseToolArguments(value: string): Readonly<Record<string, unknown>> {
  try {
    return JSON.parse(value) as Readonly<Record<string, unknown>>;
  } catch (cause) {
    throw new MiniMaxProviderError(
      "MiniMax tool call arguments are invalid JSON.",
      { cause },
    );
  }
}
