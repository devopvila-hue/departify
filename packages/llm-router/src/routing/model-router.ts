import { ModelCapabilities } from "../capabilities/model-capabilities.js";
import type {
  LlmModelDescriptor,
  ModelCatalog,
} from "../models/model-catalog.js";
import type { RoutingPolicy } from "../policies/routing-policy.js";
import { validateRoutingPolicy } from "../policies/routing-policy.js";
import { assertRouterValid } from "../validation/router-error.js";

export interface RoutingDecision {
  providerId: string;
  modelId: string;
  strategy: RoutingPolicy["strategy"];
  rationale: string;
}

export class ModelRouter {
  constructor(private readonly catalog: ModelCatalog) {}

  select(policy: RoutingPolicy): RoutingDecision {
    validateRoutingPolicy(policy);
    const candidates = this.catalog
      .list()
      .filter((model) => supportsPolicy(model, policy))
      .sort((left, right) => compareModels(left, right, policy.strategy));

    assertRouterValid(
      candidates.length > 0,
      "No model satisfies the routing policy.",
    );

    const selected = candidates[0];
    assertRouterValid(selected !== undefined, "No model was selected.");
    return {
      providerId: selected.providerId,
      modelId: selected.modelId,
      strategy: policy.strategy,
      rationale: `Selected by ${policy.strategy}.`,
    };
  }
}

function supportsPolicy(
  model: LlmModelDescriptor,
  policy: RoutingPolicy,
): boolean {
  const capabilities = ModelCapabilities.create({
    capabilities: model.capabilities,
  });
  if (!capabilities.supportsAll(policy.requiredCapabilities)) {
    return false;
  }
  if (
    policy.maxCostScore !== undefined &&
    model.costScore > policy.maxCostScore
  ) {
    return false;
  }
  if (
    policy.maxLatencyScore !== undefined &&
    model.latencyScore > policy.maxLatencyScore
  ) {
    return false;
  }
  if (
    policy.minAvailabilityScore !== undefined &&
    model.availabilityScore < policy.minAvailabilityScore
  ) {
    return false;
  }
  if (
    policy.preferredProviderIds &&
    !policy.preferredProviderIds.includes(model.providerId)
  ) {
    return false;
  }
  return true;
}

function compareModels(
  left: LlmModelDescriptor,
  right: LlmModelDescriptor,
  strategy: RoutingPolicy["strategy"],
): number {
  switch (strategy) {
    case "lowest_cost":
      return left.costScore - right.costScore;
    case "lowest_latency":
      return left.latencyScore - right.latencyScore;
    case "highest_availability":
      return right.availabilityScore - left.availabilityScore;
    case "balanced":
      return scoreModel(right) - scoreModel(left);
    case "capability_first":
      return right.capabilities.length - left.capabilities.length;
  }
}

function scoreModel(model: LlmModelDescriptor): number {
  return model.availabilityScore - model.costScore - model.latencyScore;
}
