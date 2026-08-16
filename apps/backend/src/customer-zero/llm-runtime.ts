import {
  loadLlmRouterConfig,
  type LlmRouterConfig,
} from "@departify/config";
import {
  createOpenAIProviderFromApiKey,
  createOpenAIProviderFromConfig,
} from "@departify/llm-provider-openai";
import {
  bootstrapLlmRouter,
  type LlmRouter,
} from "@departify/llm-router";
import {
  type LlmCredentialStore,
  BYOK_PROVIDER,
} from "./llm-credentials.js";

export interface LlmRuntime {
  readonly router: LlmRouter;
}

/**
 * Builds the real LLM Router for Customer Zero. The OpenAI provider is
 * OpenAI-compatible, so it can target any compatible endpoint (Sprint 57:
 * the local gateway when configured via OPENAI_BASE_URL). No fake provider,
 * no mocked replies — this is the real inference stack.
 */
export function buildLlmRuntime(options?: {
  organizationId?: string;
  credentialStore?: LlmCredentialStore;
}): LlmRuntime {
  // The router is built lazily: a session (and therefore the whole product
  // flow) must not fail to exist just because the provider is not configured
  // in this environment. When it is missing, the calls fail honestly at call
  // time and the analysis degrades to the deterministic facts.
  let cached: LlmRouter | null = null;
  let tenantCredentialKey: string | null = null;
  let tenantRouter: LlmRouter | null = null;
  const resolve = (): LlmRouter => {
    if (!cached) {
      const config: LlmRouterConfig = loadLlmRouterConfig();
      const provider = createOpenAIProviderFromConfig();
      cached = bootstrapLlmRouter({ config, providers: [provider] }).router;
    }
    return cached;
  };

  const resolveTenant = async (): Promise<LlmRouter> => {
    if (!options?.organizationId || !options.credentialStore) return resolve();
    const credential = await options.credentialStore.get(
      options.organizationId,
      BYOK_PROVIDER,
    );
    if (!credential) return resolve();
    const cacheKey = `${credential.model}:${credential.apiKey}`;
    if (!tenantRouter || tenantCredentialKey !== cacheKey) {
      tenantRouter = bootstrapLlmRouter({
        config: {
          defaultProvider: BYOK_PROVIDER,
          defaultStrategy: loadLlmRouterConfig().defaultStrategy,
        },
        providers: [createOpenAIProviderFromApiKey(credential.apiKey, credential.model)],
      }).router;
      tenantCredentialKey = cacheKey;
    }
    return tenantRouter;
  };

  const requestMethods = new Set(["chat", "complete", "embed", "stream"]);

  const router = new Proxy({} as LlmRouter, {
    get(_target, property) {
      // Never resolve the provider just because a property is READ (the tool
      // catalog inspects the router at registration time). Resolution happens
      // when the method is actually called.
      if (requestMethods.has(String(property))) {
        if (property === "stream") {
          return async function* (...args: unknown[]) {
            const target = await resolveTenant();
            const method = (target as unknown as Record<string, unknown>)[String(property)];
            if (typeof method !== "function") {
              throw new Error(`LLM router has no method '${String(property)}'.`);
            }
            yield* (method as (...inner: unknown[]) => AsyncIterable<unknown>).apply(
              target,
              args,
            );
          };
        }
        return async (...args: unknown[]) => {
          const target = await resolveTenant();
          const method = (target as unknown as Record<string, unknown>)[String(property)];
          if (typeof method !== "function") {
            throw new Error(`LLM router has no method '${String(property)}'.`);
          }
          return (method as (...inner: unknown[]) => unknown).apply(target, args);
        };
      }
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
