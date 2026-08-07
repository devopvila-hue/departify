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
  const config: LlmRouterConfig = loadLlmRouterConfig();
  const provider = createOpenAIProviderFromConfig();
  const { router } = bootstrapLlmRouter({
    config,
    providers: [provider],
  });
  return { router };
}

export type { LlmRouter };
