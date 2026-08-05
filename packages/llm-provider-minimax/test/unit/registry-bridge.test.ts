import type { ProviderRegistry } from "@departify/llm-router";
import { ProviderRegistry as ProviderRegistryImpl } from "@departify/llm-router";

interface TestEnv {
  MINIMAX_API_KEY: string;
  MINIMAX_BASE_URL: string;
  MINIMAX_MODEL: string;
}

const fakeEnv: TestEnv = {
  MINIMAX_API_KEY: "minimax-key",
  MINIMAX_BASE_URL: "https://api.minimax.example.com/v1",
  MINIMAX_MODEL: "minimax-1",
};

describe("MiniMax provider integration with the LLM Router", () => {
  it("registers the provider in a ProviderRegistry when env is configured", async () => {
    process.env.MINIMAX_API_KEY = fakeEnv.MINIMAX_API_KEY;
    process.env.MINIMAX_BASE_URL = fakeEnv.MINIMAX_BASE_URL;
    process.env.MINIMAX_MODEL = fakeEnv.MINIMAX_MODEL;

    const { registerMiniMaxProvider } = await import("../../src/index.js");
    const registry: ProviderRegistry = new ProviderRegistryImpl();
    registerMiniMaxProvider(registry);

    expect(registry.has("minimax")).toBe(true);
  });
});
