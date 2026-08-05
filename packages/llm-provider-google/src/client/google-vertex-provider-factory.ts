import { loadGoogleVertexProviderConfig } from "@departify/config";
import type { LlmProvider, ProviderRegistry } from "@departify/llm-router";
import { GoogleVertexLlmProvider } from "../adapters/google-vertex-llm-provider.js";
import { createGoogleVertexClient } from "../client/google-vertex-client.js";
import { createGoogleVertexProviderRuntimeConfig } from "../configuration/google-vertex-provider-config.js";

export function createGoogleVertexProviderFromConfig(): GoogleVertexLlmProvider {
  const config = createGoogleVertexProviderRuntimeConfig(
    loadGoogleVertexProviderConfig(),
  );
  return new GoogleVertexLlmProvider(createGoogleVertexClient(config), config);
}

/**
 * Registers the Google Vertex provider into the supplied Provider Registry.
 * Mirrors `registerOpenAIProvider` so the LLM Router composition can treat
 * both adapters identically without provider-specific knowledge.
 */
export function registerGoogleVertexProvider(
  registry: ProviderRegistry,
): LlmProvider {
  const provider = createGoogleVertexProviderFromConfig();
  registry.register(provider);
  return provider;
}
