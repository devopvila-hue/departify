import type { RoutingStrategy } from "../policies/routing-policy.js";

/**
 * Configuration contract consumed by the LLM Router composition.
 *
 * The Router itself never reads environment variables. The host application is
 * responsible for loading this shape (typically from `@departify/config`) and
 * handing it to the composition entry point. Keeping this type local to the
 * Router preserves its provider-agnostic contract.
 */
export interface LlmRouterConfig {
  defaultProvider: string;
  defaultStrategy: RoutingStrategy;
}
