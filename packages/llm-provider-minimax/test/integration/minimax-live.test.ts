import { loadMiniMaxProviderConfig } from "@departify/config";
import {
  ProviderRegistry,
  LlmRouter,
  createNoopObservability,
  type LlmRouterConfig,
} from "@departify/llm-router";
import { registerMiniMaxProvider } from "../../src/index.js";

let config: ReturnType<typeof loadMiniMaxProviderConfig> | null = null;
try {
  config = loadMiniMaxProviderConfig();
} catch {
  config = null;
}

const integrationTest = config ? it : it.skip;

describe("MiniMax provider live integration", () => {
  integrationTest(
    "serves chat requests through the LlmRouter facade when credentials are available",
    async () => {
      const registry = new ProviderRegistry();
      registerMiniMaxProvider(registry);

      const routerConfig: LlmRouterConfig = {
        defaultProvider: "minimax",
        defaultStrategy: "capability_first",
      };

      const router = LlmRouter.bootstrap({
        registry,
        defaultProviderId: routerConfig.defaultProvider,
        strategy: routerConfig.defaultStrategy,
        observability: createNoopObservability(),
      });

      const response = await router.chat({
        type: "chat",
        requestId: "req_minimax_live_001",
        requiredCapabilities: ["chat"],
        messages: [
          { role: "user", content: "Reply with exactly: departify-ok" },
        ],
      });

      expect(response.providerId).toBe("minimax");
      expect(response.message.toLowerCase()).toContain("departify-ok");
    },
    60_000,
  );
});
