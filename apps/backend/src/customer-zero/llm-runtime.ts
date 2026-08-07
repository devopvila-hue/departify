import {
  loadLlmRouterConfig,
  type LlmRouterConfig,
} from "@departify/config";
import { createOpenAIProviderFromConfig } from "@departify/llm-provider-openai";
import {
  bootstrapLlmRouter,
  type LlmRouter,
} from "@departify/llm-router";

export interface LlmRuntime {
  readonly router: LlmRouter;
}

/**
 * Builds the real LLM Router for Customer Zero. The OpenAI provider is
 * OpenAI-compatible, so it can target any compatible endpoint (Sprint 57:
 * the local gateway when configured via OPENAI_BASE_URL). No fake provider,
 * no mocked replies — this is the real inference stack.
 */
export function buildLlmRuntime(): LlmRuntime {
  // The router is built lazily: a session (and therefore the whole product
  // flow) must not fail to exist just because the provider is not configured
  // in this environment. When it is missing, the calls fail honestly at call
  // time and the analysis degrades to the deterministic facts.
  let cached: LlmRouter | null = null;
  const resolve = (): LlmRouter => {
    if (!cached) {
      const config: LlmRouterConfig = loadLlmRouterConfig();
      const provider = createOpenAIProviderFromConfig();
      cached = bootstrapLlmRouter({ config, providers: [provider] }).router;
    }
    return cached;
  };

  const router = new Proxy({} as LlmRouter, {
    get(_target, property) {
      // Never resolve the provider just because a property is READ (the tool
      // catalog inspects the router at registration time). Resolution happens
      // when the method is actually called.
      return (...args: unknown[]) => {
        let target: Record<string, unknown>;
        try {
          target = resolve() as unknown as Record<string, unknown>;
        } catch (cause) {
          // Registration-time metadata reads must not break the product flow
          // when the provider is not configured in this environment.
          if (property === "getDefaultProviderId") {
            return "unconfigured";
          }
          throw cause;
        }
        const method = target[property as string];
        if (typeof method !== "function") {
          throw new Error(`LLM router has no method '${String(property)}'.`);
        }
        return (method as (...inner: unknown[]) => unknown).apply(target, args);
      };
    },
  });

  return { router };
}

export type { LlmRouter };
