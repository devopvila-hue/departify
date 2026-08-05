import {
  loadLlmRouterConfig,
  loadOpenAIProviderConfig,
} from "@departify/config";
import {
  LlmRouter,
  ProviderRegistry,
  createNoopObservability,
  type LlmProvider,
} from "@departify/llm-router";
import { OpenAILlmProvider } from "../../src/index.js";
import { createOpenAIClient } from "../../src/client/openai-client.js";

let openAIConfig: ReturnType<typeof loadOpenAIProviderConfig> | null = null;
try {
  openAIConfig = loadOpenAIProviderConfig();
} catch {
  openAIConfig = null;
}

const integrationTest = openAIConfig ? it : it.skip;

describe("LLM Router composition with OpenAI provider", () => {
  integrationTest(
    "serves chat requests through the LlmRouter facade using OpenAI",
    async () => {
      const runtime = {
        apiKey: openAIConfig!.apiKey,
        defaultModel: openAIConfig!.defaultModel,
        timeoutMs: openAIConfig!.timeoutMs,
        maxRetries: openAIConfig!.maxRetries,
      };
      const client = createOpenAIClient(runtime);
      const provider: LlmProvider = new OpenAILlmProvider(client, runtime);

      const registry = new ProviderRegistry();
      registry.register(provider);

      const routerConfig = loadLlmRouterConfig();
      const router = LlmRouter.bootstrap({
        registry,
        defaultProviderId: routerConfig.defaultProvider,
        strategy: routerConfig.defaultStrategy,
        observability: createNoopObservability(),
      });

      const response = await router.chat({
        type: "chat",
        requestId: "req_router_live_001",
        requiredCapabilities: ["chat"],
        messages: [
          { role: "user", content: "Reply with exactly: departify-ok" },
        ],
      });

      expect(response.providerId).toBe("openai");
      expect(response.modelId).toBe(openAIConfig!.defaultModel);
      expect(response.message.toLowerCase()).toContain("departify-ok");
    },
    60_000,
  );
});
