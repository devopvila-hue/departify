import { createSystemHealthToolDefinition } from "../../src/index.js";

describe("system.health Tool", () => {
  it("returns a typed snapshot of the runtime", async () => {
    const tool = createSystemHealthToolDefinition({
      runtime: {
        name: "@departify/backend",
        version: "0.1.0",
        environment: "test",
      },
      catalogVersion: "1.0.0",
      clock: () => new Date("2026-08-05T12:00:00Z"),
    });

    const output = (await tool.executor!()) as unknown as {
      runtime: { name: string; version: string; environment: string };
      toolRuntime: { registered: number; providers: string[] };
      router: { providers: string[]; defaultProvider: string };
      version: string;
      timestamp: string;
    };

    expect(output.runtime).toEqual({
      name: "@departify/backend",
      version: "0.1.0",
      environment: "test",
    });
    expect(output.version).toBe("1.0.0");
    expect(output.timestamp).toBe("2026-08-05T12:00:00.000Z");
    expect(output.router.defaultProvider).toBe("none");
  });

  it("surfaces registered providers from the LLM provider registry", async () => {
    const llmProviderRegistry = {
      listDescriptors: () => [
        {
          providerId: "openai",
          displayName: "OpenAI",
          capabilities: { capabilities: ["chat"] },
          models: [
            {
              providerId: "openai",
              modelId: "gpt-4o-mini",
              displayName: "gpt-4o-mini",
              capabilities: ["chat"],
              costScore: 50,
              latencyScore: 50,
              availabilityScore: 90,
            },
          ],
        },
      ],
    };

    const tool = createSystemHealthToolDefinition({
      llmProviderRegistry: llmProviderRegistry as never,
      llmRouter: { defaultProviderId: "openai" },
    });

    const output = (await tool.executor!()) as unknown as {
      router: { providers: string[]; defaultProvider: string };
      providerRegistry: { providers: { providerId: string }[] };
    };

    expect(output.router.providers).toEqual(["openai"]);
    expect(output.router.defaultProvider).toBe("openai");
    expect(output.providerRegistry.providers[0]?.providerId).toBe("openai");
  });
});
