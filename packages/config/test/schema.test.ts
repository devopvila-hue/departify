import {
  backendConfigSchema,
  llmRouterConfigSchema,
  openAIProviderConfigSchema,
  validateEnv,
} from "../src/index.js";

describe("validateEnv", () => {
  it("loads Golden Image defaults", () => {
    const env = validateEnv({});

    expect(env.NODE_ENV).toBe("development");
    expect(env.HOST).toBe("127.0.0.1");
    expect(env.PORT).toBe(3210);
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.OTEL_SERVICE_NAME).toBe("departify-backend");
    expect(env.OPENAI_MODEL).toBe("gpt-4o-mini");
    expect(env.OPENAI_TIMEOUT_MS).toBe(30_000);
    expect(env.OPENAI_MAX_RETRIES).toBe(2);
    expect(env.LLM_DEFAULT_PROVIDER).toBe("openai");
    expect(env.LLM_ROUTING_STRATEGY).toBe("capability_first");
  });

  it("rejects invalid provider URLs", () => {
    expect(() => validateEnv({ SUPABASE_URL: "not-a-url" })).toThrow();
  });

  it("rejects unknown routing strategies", () => {
    expect(() =>
      validateEnv({ LLM_ROUTING_STRATEGY: "unknown_strategy" as never }),
    ).toThrow();
  });
});

describe("llmRouterConfigSchema", () => {
  it("returns the default LLM Router config when no overrides are provided", () => {
    const config = llmRouterConfigSchema.parse({});

    expect(config).toEqual({
      defaultProvider: "openai",
      defaultStrategy: "capability_first",
    });
  });

  it("accepts the balanced routing strategy", () => {
    const config = llmRouterConfigSchema.parse({
      LLM_ROUTING_STRATEGY: "balanced",
    });

    expect(config.defaultStrategy).toBe("balanced");
  });

  it("accepts a custom default provider id", () => {
    const config = llmRouterConfigSchema.parse({
      LLM_DEFAULT_PROVIDER: "anthropic",
    });

    expect(config.defaultProvider).toBe("anthropic");
  });
});

describe("openAIProviderConfigSchema", () => {
  it("creates OpenAI provider config without exposing other provider secrets", () => {
    const config = openAIProviderConfigSchema.parse({
      OPENAI_API_KEY: "test-openai-key",
      OPENAI_MODEL: "gpt-4o-mini",
      OPENAI_TIMEOUT_MS: "1000",
      OPENAI_MAX_RETRIES: "1",
      ANTHROPIC_API_KEY: "other-secret",
    });

    expect(config).toEqual({
      apiKey: "test-openai-key",
      defaultModel: "gpt-4o-mini",
      timeoutMs: 1000,
      maxRetries: 1,
    });
    expect(JSON.stringify(config)).not.toContain("other-secret");
  });

  it("requires an OpenAI API key for provider config", () => {
    expect(() => openAIProviderConfigSchema.parse({})).toThrow(
      "OPENAI_API_KEY is required",
    );
  });
});

describe("backendConfigSchema", () => {
  it("creates backend runtime config without exposing secrets", () => {
    const config = backendConfigSchema.parse({
      NODE_ENV: "test",
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_SECRET_KEY: "secret",
    });

    expect(config).toMatchObject({
      environment: "test",
      logLevel: "silent",
      providers: {
        supabaseUrl: "http://127.0.0.1:54321",
      },
    });
    expect(JSON.stringify(config)).not.toContain("secret");
  });
});
