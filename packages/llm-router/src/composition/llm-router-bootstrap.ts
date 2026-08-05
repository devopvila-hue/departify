import type { LlmRouterConfig } from "./config-types.js";
import type { LlmProvider } from "../contracts/provider-contracts.js";
import { LlmRouter } from "./llm-router-facade.js";
import type { RouterObservability } from "../observability/router-observability.js";
import { ProviderRegistry } from "../providers/provider-registry.js";

/**
 * Input contract for the official LLM Router composition.
 *
 * The composition lives in `packages/llm-router` itself so that the rest of
 * the system (Executive Director, Agent Runtime, applications) can depend on a
 * single boundary while concrete providers remain isolated in their own
 * packages.
 */
export interface LlmRouterBootstrapInput {
  config: LlmRouterConfig;
  providers: readonly LlmProvider[];
  observability?: RouterObservability;
}

export interface LlmRouterBootstrapResult {
  router: LlmRouter;
  registry: ProviderRegistry;
}

/**
 * Boots the official LLM Router composition:
 *
 * 1. Instantiates the Provider Registry.
 * 2. Registers every supplied provider.
 * 3. Selects the default provider from the registry, falling back to the
 *    configuration-supplied default.
 * 4. Wires the routing strategy, observability, and the unified facade.
 *
 * Additional providers added in future sprints must register through the same
 * registry without changing this entry point.
 */
export function bootstrapLlmRouter(
  input: LlmRouterBootstrapInput,
): LlmRouterBootstrapResult {
  const registry = new ProviderRegistry();
  for (const provider of input.providers) {
    registry.register(provider);
  }

  const resolvedDefault = registry.has(input.config.defaultProvider)
    ? input.config.defaultProvider
    : registry.listDescriptors()[0]?.providerId;

  if (!resolvedDefault) {
    throw new Error(
      "LLM Router bootstrap requires at least one registered provider.",
    );
  }

  const router = LlmRouter.bootstrap({
    registry,
    defaultProviderId: resolvedDefault,
    strategy: input.config.defaultStrategy,
    ...(input.observability ? { observability: input.observability } : {}),
  });

  return { router, registry };
}
