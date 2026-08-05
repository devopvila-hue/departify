import type {
  ChatRequest,
  CompletionRequest,
  LlmProvider,
  LlmProviderDescriptor,
  StreamChunk,
} from "@departify/llm-router";
import type {
  MiniMaxChatCompletionResult,
  MiniMaxProviderClient,
  MiniMaxStreamChunk,
} from "../client/minimax-client.js";
import type { MiniMaxProviderRuntimeConfig } from "../configuration/minimax-provider-config.js";
import { MiniMaxProviderError } from "../errors/minimax-provider-error.js";
import { createMiniMaxModelDescriptor } from "../models/minimax-models.js";
import {
  mapChatRequestToMiniMax,
  mapCompletionRequestToMiniMax,
} from "../mappers/minimax-request-mapper.js";
import {
  mapMiniMaxChatResponse,
  mapMiniMaxCompletionResponse,
  mapMiniMaxStreamChunk,
} from "../mappers/minimax-response-mapper.js";

export class MiniMaxLlmProvider implements LlmProvider {
  private readonly providerId = "minimax";

  constructor(
    private readonly client: MiniMaxProviderClient,
    private readonly config: MiniMaxProviderRuntimeConfig,
  ) {}

  describe(): LlmProviderDescriptor {
    return {
      providerId: this.providerId,
      displayName: "MiniMax",
      capabilities: {
        capabilities: [
          "chat",
          "completion",
          "tool_calling",
          "streaming",
          "structured_output",
          "json_output",
        ],
      },
      models: [createMiniMaxModelDescriptor(this.config.defaultModel)],
    };
  }

  supportsToolCalling(): boolean {
    return true;
  }

  supportsStructuredOutput(): boolean {
    return true;
  }

  async chat(request: ChatRequest) {
    try {
      const result = await this.client.chat.completions.create(
        mapChatRequestToMiniMax({ ...request, stream: false }, this.config),
      );
      return mapMiniMaxChatResponse(
        request.requestId,
        this.providerId,
        request.modelPreference?.modelId ?? this.config.defaultModel,
        result as MiniMaxChatCompletionResult,
      );
    } catch (cause) {
      throw new MiniMaxProviderError("MiniMax chat request failed.", {
        cause,
      });
    }
  }

  async complete(request: CompletionRequest) {
    try {
      const result = await this.client.chat.completions.create(
        mapCompletionRequestToMiniMax(
          { ...request, stream: false },
          this.config,
        ),
      );
      return mapMiniMaxCompletionResponse(
        request.requestId,
        this.providerId,
        request.modelPreference?.modelId ?? this.config.defaultModel,
        result as MiniMaxChatCompletionResult,
      );
    } catch (cause) {
      throw new MiniMaxProviderError("MiniMax completion request failed.", {
        cause,
      });
    }
  }

  async *stream(
    request: ChatRequest | CompletionRequest,
  ): AsyncIterable<StreamChunk> {
    try {
      const mapped =
        request.type === "chat"
          ? mapChatRequestToMiniMax({ ...request, stream: true }, this.config)
          : mapCompletionRequestToMiniMax(
              { ...request, stream: true },
              this.config,
            );
      const stream = this.client.chat.completions.create(mapped);
      let sequence = 0;
      for await (const chunk of stream as AsyncIterable<MiniMaxStreamChunk>) {
        yield mapMiniMaxStreamChunk(request.requestId, sequence, chunk);
        sequence += 1;
      }
      yield {
        requestId: request.requestId,
        sequence,
        contentDelta: "",
        done: true,
      };
    } catch (cause) {
      throw new MiniMaxProviderError("MiniMax streaming request failed.", {
        cause,
      });
    }
  }
}
