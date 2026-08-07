import OpenAI from "openai";
import type { OpenAIProviderRuntimeConfig } from "../configuration/openai-provider-config.js";

export interface OpenAIChatCompletionChoice {
  message?: {
    content?: string | null;
    tool_calls?: readonly {
      function?: {
        name?: string;
        arguments?: string;
      };
    }[];
  };
}

export interface OpenAIChatCompletionResult {
  choices: readonly OpenAIChatCompletionChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export interface OpenAIStreamChunk {
  choices: readonly {
    delta?: {
      content?: string | null;
    };
  }[];
}

export interface OpenAIChatCompletionClient {
  create(
    request: Readonly<Record<string, unknown>>,
  ): Promise<OpenAIChatCompletionResult> | AsyncIterable<OpenAIStreamChunk>;
}

export interface OpenAIProviderClient {
  chat: {
    completions: OpenAIChatCompletionClient;
  };
}

export function createOpenAIClient(
  config: OpenAIProviderRuntimeConfig,
): OpenAIProviderClient {
  return new OpenAI({
    apiKey: config.apiKey,
    timeout: config.timeoutMs,
    maxRetries: config.maxRetries,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
  }) as unknown as OpenAIProviderClient;
}
