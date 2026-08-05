import {
  createMiniMaxProviderRuntimeConfig,
  MiniMaxProviderValidationError,
} from "../../src/index.js";

describe("MiniMax provider configuration", () => {
  it("creates a typed runtime config from packages/config", () => {
    const runtime = createMiniMaxProviderRuntimeConfig({
      apiKey: "test-key",
      baseUrl: "https://api.minimax.example.com/v1",
      defaultModel: "minimax-1",
    });

    expect(runtime).toMatchObject({
      apiKey: "test-key",
      baseUrl: "https://api.minimax.example.com/v1",
      defaultModel: "minimax-1",
      timeoutMs: 30_000,
      maxRetries: 2,
    });
  });

  it("rejects missing required fields", () => {
    expect(() =>
      createMiniMaxProviderRuntimeConfig({
        apiKey: "",
        baseUrl: "https://api.minimax.example.com/v1",
        defaultModel: "minimax-1",
      }),
    ).toThrow(MiniMaxProviderValidationError);
  });
});
