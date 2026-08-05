import {
  LlmRouterValidationError,
  ModelCatalog,
  ModelRouter,
  routingStrategies,
} from "../src/index.js";
import { modelCatalogFixtures } from "./fixtures.js";

describe("model catalog and routing", () => {
  it("declares routing strategies", () => {
    expect(routingStrategies).toEqual([
      "capability_first",
      "lowest_cost",
      "lowest_latency",
      "highest_availability",
      "balanced",
    ]);
  });

  it("finds models by capability", () => {
    const catalog = new ModelCatalog(modelCatalogFixtures());

    expect(catalog.findSupporting(["embeddings"])).toHaveLength(1);
    expect(
      catalog.find("provider_beta", "model_reasoning_tools"),
    ).toMatchObject({
      displayName: "Reasoning Tools Model",
    });
  });

  it("selects models using routing policies", () => {
    const router = new ModelRouter(new ModelCatalog(modelCatalogFixtures()));

    expect(
      router.select({
        strategy: "lowest_latency",
        requiredCapabilities: ["chat"],
      }),
    ).toMatchObject({
      providerId: "provider_alpha",
      modelId: "model_chat_fast",
    });

    expect(
      router.select({
        strategy: "highest_availability",
        requiredCapabilities: ["chat", "tool_calling"],
      }),
    ).toMatchObject({
      providerId: "provider_beta",
    });
  });

  it("rejects impossible routing policies", () => {
    const router = new ModelRouter(new ModelCatalog(modelCatalogFixtures()));

    expect(() =>
      router.select({
        strategy: "lowest_cost",
        requiredCapabilities: ["vision", "embeddings"],
      }),
    ).toThrow(LlmRouterValidationError);
  });
});
