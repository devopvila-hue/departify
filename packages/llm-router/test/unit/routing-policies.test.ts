import {
  ModelCatalog,
  ModelRouter,
  ProviderSelector,
  type LlmProvider,
  type LlmProviderDescriptor,
  type LlmModelDescriptor,
} from "../../src/index.js";

const fixtures: readonly LlmModelDescriptor[] = [
  {
    providerId: "alpha",
    modelId: "alpha-fast",
    displayName: "Alpha Fast",
    capabilities: ["chat", "streaming", "json_output"],
    costScore: 20,
    latencyScore: 10,
    availabilityScore: 80,
  },
  {
    providerId: "beta",
    modelId: "beta-tools",
    displayName: "Beta Tools",
    capabilities: ["chat", "tool_calling", "structured_output", "reasoning"],
    costScore: 70,
    latencyScore: 60,
    availabilityScore: 95,
  },
  {
    providerId: "gamma",
    modelId: "gamma-embed",
    displayName: "Gamma Embed",
    capabilities: ["embeddings"],
    costScore: 15,
    latencyScore: 20,
    availabilityScore: 90,
  },
];

function providerFromCatalog(providerId: string): LlmProvider {
  return {
    describe(): LlmProviderDescriptor {
      return {
        providerId,
        displayName: providerId,
        capabilities: { capabilities: ["chat"] },
        models: fixtures.filter((model) => model.providerId === providerId),
      };
    },
  };
}

describe("ProviderSelector", () => {
  it("selects by capability_first by default", () => {
    const catalog = new ModelCatalog(fixtures);
    const router = new ModelRouter(catalog);
    const selector = new ProviderSelector(catalog, router);

    const decision = selector.resolve({
      type: "chat",
      requestId: "req_cap",
      requiredCapabilities: ["chat", "tool_calling", "structured_output"],
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(decision.providerId).toBe("beta");
    expect(decision.modelId).toBe("beta-tools");
    expect(decision.strategy).toBe("capability_first");
  });

  it("selects by balanced strategy when requested", () => {
    const catalog = new ModelCatalog(fixtures);
    const router = new ModelRouter(catalog);
    const selector = new ProviderSelector(catalog, router);

    const decision = selector.resolve(
      {
        type: "chat",
        requestId: "req_balanced",
        requiredCapabilities: ["chat"],
        messages: [{ role: "user", content: "Hi" }],
      },
      { strategy: "balanced" },
    );

    expect(decision.strategy).toBe("balanced");
    expect(["alpha", "beta"]).toContain(decision.providerId);
  });

  it("honours caller-supplied model preferences", () => {
    const catalog = new ModelCatalog(fixtures);
    const router = new ModelRouter(catalog);
    const selector = new ProviderSelector(catalog, router);

    const decision = selector.resolve({
      type: "chat",
      requestId: "req_pref",
      requiredCapabilities: ["chat"],
      messages: [{ role: "user", content: "Hi" }],
      modelPreference: { providerId: "alpha", modelId: "alpha-fast" },
    });

    expect(decision).toMatchObject({
      providerId: "alpha",
      modelId: "alpha-fast",
      rationale: "Caller-supplied model preference.",
    });
  });

  it("ignores preferredProviderIds when no concrete model is supplied", () => {
    const catalog = new ModelCatalog(fixtures);
    const router = new ModelRouter(catalog);
    const selector = new ProviderSelector(catalog, router);

    const decision = selector.resolve({
      type: "chat",
      requestId: "req_provider_only",
      requiredCapabilities: ["chat", "tool_calling"],
      messages: [{ role: "user", content: "Hi" }],
      modelPreference: { providerId: "beta" },
    });

    expect(decision.providerId).toBe("beta");
    expect(decision.strategy).toBe("capability_first");
  });

  it("exposes a free function helper", () => {
    const catalog = new ModelCatalog(fixtures);
    const router = new ModelRouter(catalog);

    const models = providerFromCatalog("alpha").describe().models;
    const model = models[0];
    expect(model).toBeDefined();
    expect(model?.providerId).toBe("alpha");
    expect(router).toBeInstanceOf(ModelRouter);
  });
});
