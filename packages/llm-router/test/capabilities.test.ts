import {
  LlmRouterValidationError,
  ModelCapabilities,
  llmCapabilityCodes,
} from "../src/index.js";

describe("ModelCapabilities", () => {
  it("declares abstract capability codes", () => {
    expect(llmCapabilityCodes).toEqual([
      "chat",
      "completion",
      "embeddings",
      "tool_calling",
      "streaming",
      "structured_output",
      "vision",
      "reasoning",
      "json_output",
    ]);
  });

  it("validates and queries capabilities", () => {
    const capabilities = ModelCapabilities.create({
      capabilities: ["chat", "tool_calling"],
    });

    expect(capabilities.supports("chat")).toBe(true);
    expect(capabilities.supportsAll(["chat", "tool_calling"])).toBe(true);
    expect(() =>
      ModelCapabilities.create({ capabilities: ["chat", "chat"] }),
    ).toThrow(LlmRouterValidationError);
  });
});
