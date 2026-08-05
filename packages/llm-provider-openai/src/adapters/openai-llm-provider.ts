import type {
  ChatRequest,
  ChatResponse,
  CompletionRequest,
  CompletionResponse,
  LlmProvider,
  LlmProviderDescriptor,
  StreamChunk,
} from "@departify/llm-router";
import type {
  OpenAIChatCompletionResult,
  OpenAIProviderClient,
  OpenAIStreamChunk,
} from "../client/openai-client.js";
import type { OpenAIProviderRuntimeConfig } from "../configuration/openai-provider-config.js";
import { createOpenAIModelDescriptor } from "../models/openai-models.js";
import {
  mapChatRequestToOpenAI,
  mapCompletionRequestToOpenAI,
} from "../mappers/request-mapper.js";
import {
  mapOpenAIChatResponse,
  mapOpenAICompletionResponse,
  mapOpenAIStreamChunk,
} from "../mappers/response-mapper.js";
import { OpenAIProviderError } from "../errors/openai-provider-error.js";

export class OpenAILlmProvider implements LlmProvider {
  private readonly providerId = "openai";

  constructor(
    private readonly client: OpenAIProviderClient,
    private readonly config: OpenAIProviderRuntimeConfig,
  ) {}

  describe(): LlmProviderDescriptor {
    return {
      providerId: this.providerId,
      displayName: "OpenAI",
      capabilities: {
        capabilities: [
          "chat",
          "tool_calling",
          "streaming",
          "structured_output",
          "json_output",
        ],
      },
      models: [createOpenAIModelDescriptor(this.config.defaultModel)],
    };
  }

  supportsToolCalling(): boolean {
    return true;
  }

  supportsStructuredOutput(): boolean {
    return true;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    try {
      const result = await this.client.chat.completions.create(
        mapChatRequestToOpenAI(
          {
            ...request,
            stream: false,
          },
          this.config,
        ),
      );
      return mapOpenAIChatResponse(
        request.requestId,
        this.providerId,
        request.modelPreference?.modelId ?? this.config.defaultModel,
        result as OpenAIChatCompletionResult,
      );
    } catch (cause) {
      throw new OpenAIProviderError("OpenAI chat request failed.", { cause });
    }
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    try {
      const result = await this.client.chat.completions.create(
        mapCompletionRequestToOpenAI(
          {
            ...request,
            stream: false,
          },
          this.config,
        ),
      );
      return mapOpenAICompletionResponse(
        request.requestId,
        this.providerId,
        request.modelPreference?.modelId ?? this.config.defaultModel,
        result as OpenAIChatCompletionResult,
      );
    } catch (cause) {
      throw new OpenAIProviderError("OpenAI completion request failed.", {
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
          ? mapChatRequestToOpenAI({ ...request, stream: true }, this.config)
          : mapCompletionRequestToOpenAI(
              { ...request, stream: true },
              this.config,
            );
      const stream = this.client.chat.completions.create(mapped);
      let sequence = 0;
      for await (const chunk of stream as AsyncIterable<OpenAIStreamChunk>) {
        yield mapOpenAIStreamChunk(request.requestId, sequence, chunk);
        sequence += 1;
      }
      yield {
        requestId: request.requestId,
        sequence,
        contentDelta: "",
        done: true,
      };
    } catch (cause) {
      throw new OpenAIProviderError("OpenAI streaming request failed.", {
        cause,
      });
    }
  }
}
