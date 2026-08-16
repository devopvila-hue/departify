import { loadOpenAIProviderConfig } from "@departify/config";
import type { LlmProvider, ProviderRegistry } from "@departify/llm-router";
import { createOpenAIClient } from "./openai-client.js";
import { createOpenAIProviderRuntimeConfig } from "../configuration/openai-provider-config.js";
import { OpenAILlmProvider } from "../adapters/openai-llm-provider.js";

export function createOpenAIProviderFromConfig(): OpenAILlmProvider {
  const config = createOpenAIProviderRuntimeConfig(loadOpenAIProviderConfig());
  return new OpenAILlmProvider(createOpenAIClient(config), config);
}

/** Builds the same official OpenAI provider for a tenant-owned BYOK key. */
export function createOpenAIProviderFromApiKey(
  apiKey: string,
  defaultModel: string,
): OpenAILlmProvider {
  const config = createOpenAIProviderRuntimeConfig({
    apiKey,
    defaultModel,
    timeoutMs: 30_000,
    maxRetries: 2,
  });
  return new OpenAILlmProvider(createOpenAIClient(config), config);
}

/**
 * Boots the OpenAI provider and registers it into the supplied Provider
 * Registry. Returns the registered provider so the caller can perform additional
 * setup if needed.
 */
export function registerOpenAIProvider(
  registry: ProviderRegistry,
): LlmProvider {
  const provider = createOpenAIProviderFromConfig();
  registry.register(provider);
  return provider;
}
