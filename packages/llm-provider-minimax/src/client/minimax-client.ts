import OpenAI from "openai";
import type { MiniMaxProviderRuntimeConfig } from "../configuration/minimax-provider-config.js";

export interface MiniMaxChatCompletionChoice {
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

export interface MiniMaxChatCompletionResult {
  choices: readonly MiniMaxChatCompletionChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export interface MiniMaxStreamChunk {
  choices: readonly {
    delta?: {
      content?: string | null;
    };
  }[];
}

export interface MiniMaxChatCompletionClient {
  create(
    request: Readonly<Record<string, unknown>>,
  ): Promise<MiniMaxChatCompletionResult> | AsyncIterable<MiniMaxStreamChunk>;
}

export interface MiniMaxProviderClient {
  chat: {
    completions: MiniMaxChatCompletionClient;
  };
}

export function createMiniMaxClient(
  config: MiniMaxProviderRuntimeConfig,
): MiniMaxProviderClient {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    timeout: config.timeoutMs,
    maxRetries: config.maxRetries,
  }) as unknown as MiniMaxProviderClient;
}
