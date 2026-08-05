import type { OpenAIProviderConfig } from "@departify/config";
import { assertOpenAIProviderConfig } from "../validation/openai-provider-validation.js";

export interface OpenAIProviderRuntimeConfig {
  apiKey: string;
  defaultModel: string;
  timeoutMs: number;
  maxRetries: number;
}

export function createOpenAIProviderRuntimeConfig(
  config: OpenAIProviderConfig,
): OpenAIProviderRuntimeConfig {
  const runtimeConfig: OpenAIProviderRuntimeConfig = {
    apiKey: config.apiKey,
    defaultModel: config.defaultModel,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
  };
  assertOpenAIProviderConfig(runtimeConfig);
  return runtimeConfig;
}
