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
import { type LlmCredentialStore } from "./llm-credentials.js";
import { listByokProviderDescriptors } from "./byok-providers.js";

export interface LlmRuntime {
  readonly router: LlmRouter;
}

/**
 * Builds the real LLM Router for Customer Zero. Every supported BYOK
 * provider (openai + minimax today) exposes an OpenAI-compatible
 * /v1/chat/completions endpoint, so the router is built from the OpenAI
 * adapter instantiated with the tenant's BYOK key + base URL. We try
 * providers in registry order and pick the first one with a stored
 * credential; the rest of the runtime does not need to know which.
 */
export function buildLlmRuntime(options?: {
  organizationId?: string;
  credentialStore?: LlmCredentialStore;
}): LlmRuntime {
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
    const store = options.credentialStore;
    for (const provider of listByokProviderDescriptors()) {
      if (!provider.enabled) continue;
      const row = await store.get(options.organizationId, provider.id);
      if (!row?.apiKey) continue;
      const cacheKey = `${provider.id}:${row.model}:${row.apiKey}`;
      if (tenantRouter && tenantCredentialKey === cacheKey) return tenantRouter;
      const providerRouter = bootstrapLlmRouter({
        config: {
          defaultProvider: provider.id,
          defaultStrategy: loadLlmRouterConfig().defaultStrategy,
        },
        providers: [
          createOpenAIProviderFromApiKey(row.apiKey, row.model, row.baseUrl ?? undefined),
        ],
      }).router;
      tenantRouter = providerRouter;
      tenantCredentialKey = cacheKey;
      return tenantRouter;
    }
    return resolve();
  };

  const requestMethods = new Set(["chat", "complete", "embed", "stream"]);

  const router = new Proxy({} as LlmRouter, {
    get(_target, property) {
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
