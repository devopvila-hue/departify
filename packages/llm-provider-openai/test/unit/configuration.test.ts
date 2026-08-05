import {
  createOpenAIProviderRuntimeConfig,
  OpenAIProviderValidationError,
} from "../../src/index.js";

describe("OpenAI provider configuration", () => {
  it("validates runtime config from packages/config", () => {
    expect(
      createOpenAIProviderRuntimeConfig({
        apiKey: "test-key",
        defaultModel: "gpt-4o-mini",
        timeoutMs: 1000,
        maxRetries: 1,
      }),
    ).toEqual({
      apiKey: "test-key",
      defaultModel: "gpt-4o-mini",
      timeoutMs: 1000,
      maxRetries: 1,
    });
  });

  it("rejects invalid provider config", () => {
    expect(() =>
      createOpenAIProviderRuntimeConfig({
        apiKey: "",
        defaultModel: "gpt-4o-mini",
        timeoutMs: 1000,
        maxRetries: 1,
      }),
    ).toThrow(OpenAIProviderValidationError);
  });
});
