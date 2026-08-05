import {
  loadOpenAIProviderConfig,
  type OpenAIProviderConfig,
} from "@departify/config";
import { createOpenAIProviderFromConfig } from "../../src/index.js";

let openAIProviderConfig: OpenAIProviderConfig | null = null;
try {
  openAIProviderConfig = loadOpenAIProviderConfig();
} catch {
  openAIProviderConfig = null;
}

const integrationTest = openAIProviderConfig ? it : it.skip;

describe("OpenAI provider integration", () => {
  integrationTest(
    "performs a real chat call when OpenAI config is available",
    async () => {
      const provider = createOpenAIProviderFromConfig();
      const response = await provider.chat({
        type: "chat",
        requestId: "req_openai_live_001",
        requiredCapabilities: ["chat"],
        messages: [
          {
            role: "user",
            content: "Reply with exactly: departify-ok",
          },
        ],
      });

      expect(response.providerId).toBe("openai");
      expect(response.message.toLowerCase()).toContain("departify-ok");
    },
    60_000,
  );
});
