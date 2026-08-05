# LLM Router

Provider-independent AI model routing boundary for Departify.

This package defines common contracts, capabilities, abstract models, requests, responses, routing policies, and validation. It does not import provider SDKs, read environment variables, call external services, or contain product prompts.

As of Sprint 18, the LLM Router is also the official composition boundary for AI access: it ships an internal `ProviderRegistry`, a `ProviderSelector` policy helper, a provider-agnostic observability surface (`RouterLogger` and `RouterMetrics`), and the `LlmRouter` facade that exposes `chat`, `complete`, `embed`, and `stream`. Other packages (Executive Director, Agent Runtime, applications) must talk to this facade and to it alone.

## Composition entry point

```ts
import {
  bootstrapLlmRouter,
  type LlmRouterConfig,
} from "@departify/llm-router";
import { registerOpenAIProvider } from "@departify/llm-provider-openai";

const registry = new ProviderRegistry();
registerOpenAIProvider(registry);

const config: LlmRouterConfig = {
  defaultProvider: "openai",
  defaultStrategy: "capability_first",
};

const { router } = bootstrapLlmRouter({
  config,
  providers: [...registry.list()],
});
```

## Observability

The Router never imports a logger or metrics transport. Consumers supply a `RouterObservability` instance at composition time; the package ships `createNoopObservability`, `createInMemoryObservability`, and `createConsoleObservability` as default helpers.
