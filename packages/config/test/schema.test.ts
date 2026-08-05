import {
  backendConfigSchema,
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
  });

  it("rejects invalid provider URLs", () => {
    expect(() => validateEnv({ SUPABASE_URL: "not-a-url" })).toThrow();
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
