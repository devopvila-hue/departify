import type {
  ChatProvider,
  CompletionProvider,
  LlmProvider,
  LlmProviderDescriptor,
  StreamingProvider,
} from "@departify/llm-router";
import type {
  GoogleVertexClient,
  GoogleVertexGenerationRequest,
  GoogleVertexGenerationResponse,
  GoogleVertexStreamChunk,
} from "../client/google-vertex-client.js";
import type { GoogleVertexProviderRuntimeConfig } from "../configuration/google-vertex-provider-config.js";
import { GoogleVertexProviderError } from "../errors/google-vertex-provider-error.js";
import { createGoogleVertexModelDescriptor } from "../models/google-vertex-models.js";
import {
  mapChatRequestToGoogleVertex,
  mapCompletionRequestToGoogleVertex,
} from "../mappers/google-vertex-request-mapper.js";
import {
  mapGoogleVertexChatResponse,
  mapGoogleVertexCompletionResponse,
  mapGoogleVertexStreamChunk,
} from "../mappers/google-vertex-response-mapper.js";

export class GoogleVertexLlmProvider
  implements LlmProvider, ChatProvider, CompletionProvider, StreamingProvider
{
  private readonly providerId = "google_vertex";

  constructor(
    private readonly client: GoogleVertexClient,
    private readonly config: GoogleVertexProviderRuntimeConfig,
  ) {}

  describe(): LlmProviderDescriptor {
    return {
      providerId: this.providerId,
      displayName: "Google Vertex AI",
      capabilities: {
        capabilities: [
          "chat",
          "completion",
          "tool_calling",
          "streaming",
          "structured_output",
          "vision",
          "reasoning",
        ],
      },
      models: [createGoogleVertexModelDescriptor(this.config.defaultModel)],
    };
  }

  supportsToolCalling(): boolean {
    return true;
  }

  supportsStructuredOutput(): boolean {
    return true;
  }

  async chat(request: import("@departify/llm-router").ChatRequest) {
    try {
      const model = this.client.getGenerativeModel({
        model: this.resolveModelId(request.modelPreference?.modelId),
      });
      const mapped = mapChatRequestToGoogleVertex(request);
      const result = await model.generateContent(
        mapped as GoogleVertexGenerationRequest,
      );
      return mapGoogleVertexChatResponse(
        request.requestId,
        this.providerId,
        this.resolveModelId(request.modelPreference?.modelId),
        result as GoogleVertexGenerationResponse,
      );
    } catch (cause) {
      throw new GoogleVertexProviderError(
        "Google Vertex chat request failed.",
        { cause },
      );
    }
  }

  async complete(request: import("@departify/llm-router").CompletionRequest) {
    try {
      const model = this.client.getGenerativeModel({
        model: this.resolveModelId(request.modelPreference?.modelId),
      });
      const mapped = mapCompletionRequestToGoogleVertex(request);
      const result = await model.generateContent(
        mapped as GoogleVertexGenerationRequest,
      );
      return mapGoogleVertexCompletionResponse(
        request.requestId,
        this.providerId,
        this.resolveModelId(request.modelPreference?.modelId),
        result as GoogleVertexGenerationResponse,
      );
    } catch (cause) {
      throw new GoogleVertexProviderError(
        "Google Vertex completion request failed.",
        { cause },
      );
    }
  }

  async *stream(
    request:
      | import("@departify/llm-router").ChatRequest
      | import("@departify/llm-router").CompletionRequest,
  ): AsyncIterable<import("@departify/llm-router").StreamChunk> {
    try {
      const model = this.client.getGenerativeModel({
        model: this.resolveModelId(request.modelPreference?.modelId),
      });
      const mapped =
        request.type === "chat"
          ? mapChatRequestToGoogleVertex(request)
          : mapCompletionRequestToGoogleVertex(request);
      const stream = await model.generateContentStream(
        mapped as GoogleVertexGenerationRequest,
      );
      let sequence = 0;
      for await (const chunk of stream as AsyncIterable<GoogleVertexStreamChunk>) {
        yield mapGoogleVertexStreamChunk(request.requestId, sequence, chunk);
        sequence += 1;
      }
      yield {
        requestId: request.requestId,
        sequence,
        contentDelta: "",
        done: true,
      };
    } catch (cause) {
      throw new GoogleVertexProviderError(
        "Google Vertex streaming request failed.",
        { cause },
      );
    }
  }

  private resolveModelId(modelId?: string): string {
    return modelId ?? this.config.defaultModel;
  }
}
