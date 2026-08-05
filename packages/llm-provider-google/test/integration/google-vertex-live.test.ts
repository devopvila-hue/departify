import { loadGoogleVertexProviderConfig } from "@departify/config";
import {
  ProviderRegistry,
  LlmRouter,
  createNoopObservability,
  type LlmRouterConfig,
} from "@departify/llm-router";
import { registerGoogleVertexProvider } from "../../src/index.js";

let config: ReturnType<typeof loadGoogleVertexProviderConfig> | null = null;
try {
  config = loadGoogleVertexProviderConfig();
} catch {
  config = null;
}

const integrationTest = config ? it : it.skip;

describe("Google Vertex provider live integration", () => {
  integrationTest(
    "serves chat requests through the LlmRouter facade when credentials are available",
    async () => {
      const registry = new ProviderRegistry();
      registerGoogleVertexProvider(registry);

      const routerConfig: LlmRouterConfig = {
        defaultProvider: "google_vertex",
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
        requestId: "req_vertex_live_001",
        requiredCapabilities: ["chat"],
        messages: [
          { role: "user", content: "Reply with exactly: departify-ok" },
        ],
      });

      expect(response.providerId).toBe("google_vertex");
      expect(response.message.toLowerCase()).toContain("departify-ok");
    },
    60_000,
  );
});
