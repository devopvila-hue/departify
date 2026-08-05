import type { LlmCapabilityCode } from "../capabilities/model-capabilities.js";
import { assertRouterValid } from "../validation/router-error.js";

export const routingStrategies = [
  "capability_first",
  "lowest_cost",
  "lowest_latency",
  "highest_availability",
  "balanced",
] as const;

export type RoutingStrategy = (typeof routingStrategies)[number];

export interface RoutingPolicy {
  strategy: RoutingStrategy;
  requiredCapabilities: readonly LlmCapabilityCode[];
  maxCostScore?: number;
  maxLatencyScore?: number;
  minAvailabilityScore?: number;
  preferredProviderIds?: readonly string[];
}

export function validateRoutingPolicy(policy: RoutingPolicy): void {
  assertRouterValid(
    routingStrategies.includes(policy.strategy),
    "Routing strategy is invalid.",
  );
  assertRouterValid(
    policy.requiredCapabilities.length > 0,
    "Routing policy requires at least one capability.",
  );
  validateOptionalScore(policy.maxCostScore, "maxCostScore");
  validateOptionalScore(policy.maxLatencyScore, "maxLatencyScore");
  validateOptionalScore(policy.minAvailabilityScore, "minAvailabilityScore");
}

function validateOptionalScore(score: number | undefined, field: string): void {
  if (score === undefined) {
    return;
  }
  assertRouterValid(Number.isInteger(score), `${field} must be an integer.`);
  assertRouterValid(
    score >= 1 && score <= 100,
    `${field} must be between 1 and 100.`,
  );
}
