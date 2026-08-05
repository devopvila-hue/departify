import type { LlmRouterConfig } from "@departify/llm-router";
import { ProviderRegistry, bootstrapLlmRouter } from "@departify/llm-router";

interface TestEnv {
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
  OPENAI_TIMEOUT_MS: string;
  OPENAI_MAX_RETRIES: string;
}

const fakeEnv: TestEnv = {
  OPENAI_API_KEY: "test-key",
  OPENAI_MODEL: "gpt-4o-mini",
  OPENAI_TIMEOUT_MS: "1000",
  OPENAI_MAX_RETRIES: "1",
};

describe("OpenAI provider integration with the LLM Router", () => {
  it("registers the provider in a registry and wires the router facade", async () => {
    process.env.OPENAI_API_KEY = fakeEnv.OPENAI_API_KEY;
    process.env.OPENAI_MODEL = fakeEnv.OPENAI_MODEL;
    process.env.OPENAI_TIMEOUT_MS = fakeEnv.OPENAI_TIMEOUT_MS;
    process.env.OPENAI_MAX_RETRIES = fakeEnv.OPENAI_MAX_RETRIES;

    const { registerOpenAIProvider } = await import("../../src/index.js");
    const registry = new ProviderRegistry();
    registerOpenAIProvider(registry);

    const config: LlmRouterConfig = {
      defaultProvider: "openai",
      defaultStrategy: "capability_first",
    };

    const providers = [...registry.list()];
    const { router } = bootstrapLlmRouter({
      config,
      providers,
    });

    expect(router.getDefaultProviderId()).toBe("openai");
    expect(router.listProviders()).toEqual(["openai"]);
  });
});
