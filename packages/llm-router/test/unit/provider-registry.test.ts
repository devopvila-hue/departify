import type {
  ChatResponse,
  LlmProvider,
  LlmProviderDescriptor,
} from "../../src/index.js";
import { LlmRouterValidationError, ProviderRegistry } from "../../src/index.js";

function buildProvider(
  providerId: string,
  modelIds: readonly string[],
  overrides: Partial<LlmProviderDescriptor> = {},
): LlmProvider {
  return {
    describe(): LlmProviderDescriptor {
      return {
        providerId,
        displayName: overrides.displayName ?? `Provider ${providerId}`,
        capabilities: overrides.capabilities ?? { capabilities: ["chat"] },
        models: modelIds.map((modelId, index) => ({
          providerId,
          modelId,
          displayName: `${providerId} ${modelId}`,
          capabilities: ["chat"],
          costScore: 50,
          latencyScore: 50,
          availabilityScore: 80 - index,
        })),
      };
    },
    async chat(): Promise<ChatResponse> {
      return {
        type: "chat",
        requestId: "ignored",
        providerId,
        modelId: modelIds[0] ?? "",
        message: `served by ${providerId}`,
      };
    },
  };
}

describe("ProviderRegistry", () => {
  it("registers and retrieves providers by id", () => {
    const registry = new ProviderRegistry();
    const provider = buildProvider("openai", ["gpt-4o-mini"]);

    registry.register(provider);

    expect(registry.has("openai")).toBe(true);
    expect(registry.tryGet("openai")).toBe(provider);
    expect(registry.get("openai")).toBe(provider);
  });

  it("returns null for unknown providers via tryGet", () => {
    const registry = new ProviderRegistry();
    expect(registry.tryGet("missing")).toBeNull();
  });

  it("throws when an unknown provider is requested via get", () => {
    const registry = new ProviderRegistry();
    expect(() => registry.get("missing")).toThrow(LlmRouterValidationError);
  });

  it("rejects duplicate registrations", () => {
    const registry = new ProviderRegistry();
    registry.register(buildProvider("openai", ["gpt-4o-mini"]));
    expect(() =>
      registry.register(buildProvider("openai", ["gpt-4o-mini"])),
    ).toThrow(LlmRouterValidationError);
  });

  it("rejects providers that do not expose any model descriptor", () => {
    const registry = new ProviderRegistry();
    expect(() => registry.register(buildProvider("empty", []))).toThrow(
      LlmRouterValidationError,
    );
  });

  it("lists providers and descriptors", () => {
    const registry = new ProviderRegistry();
    const openai = buildProvider("openai", ["gpt-4o-mini"]);
    const mock = buildProvider("mock", ["mock-1"]);

    registry.register(openai);
    registry.register(mock);

    expect(registry.list()).toHaveLength(2);
    expect(registry.listDescriptors().map((d) => d.providerId)).toEqual([
      "openai",
      "mock",
    ]);
  });

  it("reports availability based on registered model presence", () => {
    const registry = new ProviderRegistry();
    expect(registry.isAvailable("openai")).toBe(false);
    registry.register(buildProvider("openai", ["gpt-4o-mini"]));
    expect(registry.isAvailable("openai")).toBe(true);
  });

  it("selects preferred provider when supplied", () => {
    const registry = new ProviderRegistry();
    const openai = buildProvider("openai", ["gpt-4o-mini"]);
    const mock = buildProvider("mock", ["mock-1"]);
    registry.register(openai);
    registry.register(mock);

    expect(registry.selectProvider("mock")).toBe(mock);
    expect(registry.selectProvider()).toBe(openai);
  });

  it("collects models from every registered provider", () => {
    const registry = new ProviderRegistry();
    registry.register(buildProvider("openai", ["gpt-4o-mini"]));
    registry.register(buildProvider("mock", ["mock-1", "mock-2"]));

    expect(registry.collectModels().map((m) => m.modelId)).toEqual([
      "gpt-4o-mini",
      "mock-1",
      "mock-2",
    ]);
  });
});
