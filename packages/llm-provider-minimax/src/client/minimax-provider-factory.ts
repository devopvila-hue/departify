import { loadMiniMaxProviderConfig } from "@departify/config";
import type { LlmProvider, ProviderRegistry } from "@departify/llm-router";
import { MiniMaxLlmProvider } from "../adapters/minimax-llm-provider.js";
import { createMiniMaxClient } from "../client/minimax-client.js";
import { createMiniMaxProviderRuntimeConfig } from "../configuration/minimax-provider-config.js";

export function createMiniMaxProviderFromConfig(): MiniMaxLlmProvider {
  const config = createMiniMaxProviderRuntimeConfig(
    loadMiniMaxProviderConfig(),
  );
  return new MiniMaxLlmProvider(createMiniMaxClient(config), config);
}

/**
 * Registers the MiniMax provider into the supplied Provider Registry. The
 * Provider Registry stays agnostic to provider identity: this helper mirrors
 * `registerOpenAIProvider` and `registerGoogleVertexProvider` exactly.
 */
export function registerMiniMaxProvider(
  registry: ProviderRegistry,
): LlmProvider {
  const provider = createMiniMaxProviderFromConfig();
  registry.register(provider);
  return provider;
}
