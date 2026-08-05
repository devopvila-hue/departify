import type { LlmModelDescriptor } from "../../models/model-catalog.js";
import type { ModelCatalog } from "../../models/model-catalog.js";
import type { LlmRequest } from "../../requests/llm-requests.js";
import {
  ModelRouter,
  type RoutingDecision,
} from "../../routing/model-router.js";
import type { RoutingPolicy, RoutingStrategy } from "../routing-policy.js";

/**
 * Translates an `LlmRequest` into a routing decision using the supplied policy.
 *
 * The Sprint 18 baseline supports the two strategies required by the
 * Definition of Done: `capability_first` (default) and `balanced`. Other
 * strategies already implemented by `ModelRouter` continue to work unchanged.
 */
export class ProviderSelector {
  constructor(
    private readonly catalog: ModelCatalog,
    private readonly router: ModelRouter,
  ) {}

  resolve(
    request: LlmRequest,
    options?: { strategy?: RoutingStrategy },
  ): RoutingDecision {
    const preferred = request.modelPreference;

    if (preferred?.providerId && preferred.modelId) {
      const model = this.catalog.find(preferred.providerId, preferred.modelId);
      if (model) {
        const strategy = options?.strategy ?? "capability_first";
        return {
          providerId: preferred.providerId,
          modelId: preferred.modelId,
          strategy,
          rationale: "Caller-supplied model preference.",
        };
      }
    }

    const strategy = options?.strategy ?? "capability_first";
    const policy = buildPolicy(strategy, request);
    return this.router.select(policy);
  }
}

function buildPolicy(
  strategy: RoutingStrategy,
  request: LlmRequest,
): RoutingPolicy {
  const policy: RoutingPolicy = {
    strategy,
    requiredCapabilities: request.requiredCapabilities,
  };
  if (request.modelPreference?.providerId) {
    return {
      ...policy,
      preferredProviderIds: [request.modelPreference.providerId],
    };
  }
  return policy;
}

/**
 * Convenience helper that picks the best descriptor from the catalog for a
 * given request using the same logic as `ProviderSelector`. Useful for callers
 * that want to introspect the routing decision without instantiating the
 * selector.
 */
export function selectModelForRequest(
  catalog: ModelCatalog,
  router: ModelRouter,
  request: LlmRequest,
  strategy: RoutingStrategy = "capability_first",
): LlmModelDescriptor {
  const selector = new ProviderSelector(catalog, router);
  const decision = selector.resolve(request, { strategy });
  const model = catalog.find(decision.providerId, decision.modelId);
  if (!model) {
    throw new Error(
      `Routing decision references unknown model ${decision.providerId}/${decision.modelId}.`,
    );
  }
  return model;
}
