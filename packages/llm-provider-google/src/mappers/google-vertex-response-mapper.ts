import type {
  ChatResponse,
  CompletionResponse,
  StreamChunk,
} from "@departify/llm-router";
import type {
  GoogleVertexGenerationResponse,
  GoogleVertexStreamChunk,
} from "../client/google-vertex-client.js";

export function mapGoogleVertexChatResponse(
  requestId: string,
  providerId: string,
  modelId: string,
  result: GoogleVertexGenerationResponse,
): ChatResponse {
  const candidate = result.candidates[0];
  const message = candidate?.content.parts
    .map((part) => part.text ?? "")
    .join("")
    .trim();

  return {
    type: "chat",
    requestId,
    providerId,
    modelId,
    message: message ?? "",
    ...mapUsage(result),
    ...mapStructuredOutput(message ?? ""),
  };
}

export function mapGoogleVertexCompletionResponse(
  requestId: string,
  providerId: string,
  modelId: string,
  result: GoogleVertexGenerationResponse,
): CompletionResponse {
  const text = result.candidates[0]?.content.parts
    .map((part) => part.text ?? "")
    .join("")
    .trim();

  return {
    type: "completion",
    requestId,
    providerId,
    modelId,
    text: text ?? "",
    ...mapUsage(result),
    ...mapStructuredOutput(text ?? ""),
  };
}

export function mapGoogleVertexStreamChunk(
  requestId: string,
  sequence: number,
  chunk: GoogleVertexStreamChunk,
): StreamChunk {
  const text = chunk.candidates[0]?.content.parts
    .map((part) => part.text ?? "")
    .join("");

  return {
    requestId,
    sequence,
    contentDelta: text ?? "",
    done: false,
  };
}

function mapUsage(
  result: GoogleVertexGenerationResponse,
): Pick<ChatResponse, "usage"> {
  const usage = result.usageMetadata;
  if (!usage) {
    return {};
  }
  return {
    usage: {
      inputTokens: usage.promptTokenCount ?? 0,
      outputTokens: usage.candidatesTokenCount ?? 0,
    },
  };
}

function mapStructuredOutput(content: string): {
  structuredOutput?: Readonly<Record<string, unknown>>;
} {
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
