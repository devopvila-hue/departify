import { loadOpenAIProviderConfig } from "@departify/config";
import type { LlmProvider, ProviderRegistry } from "@departify/llm-router";
import { createOpenAIClient } from "./openai-client.js";
import { createOpenAIProviderRuntimeConfig } from "../configuration/openai-provider-config.js";
import { OpenAILlmProvider } from "../adapters/openai-llm-provider.js";

export function createOpenAIProviderFromConfig(): OpenAILlmProvider {
  const config = createOpenAIProviderRuntimeConfig(loadOpenAIProviderConfig());
  return new OpenAILlmProvider(createOpenAIClient(config), config);
}

/**
 * Builds the same official OpenAI provider for a tenant-owned BYOK key.
 *
 * `baseUrl` is optional and lets the tenant point at any OpenAI-compatible
 * endpoint (the local OpenClaw gateway in development, a customer-hosted
 * proxy in production, or a third-party provider that mimics OpenAI's
 * shape — e.g. MiniMax). It is never persisted server-side; the caller is
 * the credential vault.
 */
export function createOpenAIProviderFromApiKey(
  apiKey: string,
  defaultModel: string,
  baseUrl?: string,
): OpenAILlmProvider {
  const config = createOpenAIProviderRuntimeConfig({
    apiKey,
    defaultModel,
    timeoutMs: 30_000,
    maxRetries: 2,
    ...(baseUrl && baseUrl.trim().length > 0 ? { baseUrl: baseUrl.trim() } : {}),
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
