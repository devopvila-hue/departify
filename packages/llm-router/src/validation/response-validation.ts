import type { LlmResponse, StreamChunk } from "../responses/llm-responses.js";
import { assertRouterValid } from "./router-error.js";

export function validateLlmResponse(response: LlmResponse): void {
  assertRouterValid(
    response.requestId.trim().length >= 2,
    "Response requestId is required.",
  );
  assertRouterValid(
    response.providerId.trim().length >= 2,
    "Response providerId is required.",
  );
  assertRouterValid(
    response.modelId.trim().length >= 2,
    "Response modelId is required.",
  );

  if (response.usage) {
    assertRouterValid(
      response.usage.inputTokens >= 0,
      "Input tokens cannot be negative.",
    );
    assertRouterValid(
      response.usage.outputTokens >= 0,
      "Output tokens cannot be negative.",
    );
  }

  switch (response.type) {
    case "chat":
      assertRouterValid(
        response.message.trim().length > 0,
        "Chat response message is required.",
      );
      break;
    case "completion":
      assertRouterValid(
        response.text.trim().length > 0,
        "Completion response text is required.",
      );
      break;
    case "embeddings":
      assertRouterValid(
        response.embeddings.length > 0,
        "Embedding response requires vectors.",
      );
      response.embeddings.forEach((vector) => {
        assertRouterValid(
          vector.length > 0,
          "Embedding vector cannot be empty.",
        );
      });
      break;
  }
}

export function validateStreamChunk(chunk: StreamChunk): void {
  assertRouterValid(
    chunk.requestId.trim().length >= 2,
    "Stream chunk requestId is required.",
  );
  assertRouterValid(
    Number.isInteger(chunk.sequence),
    "Stream chunk sequence must be an integer.",
  );
  assertRouterValid(
    chunk.sequence >= 0,
    "Stream chunk sequence cannot be negative.",
  );
}
