import type { ProviderRegistry } from "@departify/llm-router";
import { ProviderRegistry as ProviderRegistryImpl } from "@departify/llm-router";

interface TestEnv {
  GOOGLE_VERTEX_PROJECT_ID: string;
  GOOGLE_VERTEX_LOCATION: string;
  GOOGLE_VERTEX_MODEL: string;
}

const fakeEnv: TestEnv = {
  GOOGLE_VERTEX_PROJECT_ID: "my-gcp-project",
  GOOGLE_VERTEX_LOCATION: "us-central1",
  GOOGLE_VERTEX_MODEL: "gemini-1.5-pro",
};

describe("Google Vertex provider integration with the LLM Router", () => {
  it("registers the provider in a ProviderRegistry when env is configured", async () => {
    process.env.GOOGLE_VERTEX_PROJECT_ID = fakeEnv.GOOGLE_VERTEX_PROJECT_ID;
    process.env.GOOGLE_VERTEX_LOCATION = fakeEnv.GOOGLE_VERTEX_LOCATION;
    process.env.GOOGLE_VERTEX_MODEL = fakeEnv.GOOGLE_VERTEX_MODEL;

    const { registerGoogleVertexProvider } = await import("../../src/index.js");
    const registry: ProviderRegistry = new ProviderRegistryImpl();
    registerGoogleVertexProvider(registry);

    expect(registry.has("google_vertex")).toBe(true);
  });
});
