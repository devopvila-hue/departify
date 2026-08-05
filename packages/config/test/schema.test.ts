import {
  backendConfigSchema,
  googleVertexProviderConfigSchema,
  llmRouterConfigSchema,
  miniMaxProviderConfigSchema,
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

  it("rejects unknown default providers", () => {
    expect(() =>
      validateEnv({ LLM_DEFAULT_PROVIDER: "unknown" as never }),
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

  it("accepts google_vertex as default provider", () => {
    const config = llmRouterConfigSchema.parse({
      LLM_DEFAULT_PROVIDER: "google_vertex",
    });

    expect(config.defaultProvider).toBe("google_vertex");
  });

  it("accepts minimax as default provider", () => {
    const config = llmRouterConfigSchema.parse({
      LLM_DEFAULT_PROVIDER: "minimax",
    });

    expect(config.defaultProvider).toBe("minimax");
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

describe("googleVertexProviderConfigSchema", () => {
  it("creates Google Vertex provider config from typed environment variables", () => {
    const config = googleVertexProviderConfigSchema.parse({
      GOOGLE_VERTEX_PROJECT_ID: "my-gcp-project",
      GOOGLE_VERTEX_LOCATION: "us-central1",
      GOOGLE_VERTEX_MODEL: "gemini-1.5-pro",
      GOOGLE_APPLICATION_CREDENTIALS: "/tmp/credentials.json",
    });

    expect(config).toEqual({
      projectId: "my-gcp-project",
      location: "us-central1",
      defaultModel: "gemini-1.5-pro",
      applicationCredentials: "/tmp/credentials.json",
    });
  });

  it("omits applicationCredentials when not supplied", () => {
    const config = googleVertexProviderConfigSchema.parse({
      GOOGLE_VERTEX_PROJECT_ID: "my-gcp-project",
      GOOGLE_VERTEX_LOCATION: "europe-west4",
      GOOGLE_VERTEX_MODEL: "gemini-1.5-flash",
    });

    expect(config.applicationCredentials).toBeUndefined();
  });

  it("requires project id, location and model", () => {
    expect(() => googleVertexProviderConfigSchema.parse({})).toThrow(
      "GOOGLE_VERTEX_PROJECT_ID is required",
    );
    expect(() =>
      googleVertexProviderConfigSchema.parse({
        GOOGLE_VERTEX_PROJECT_ID: "p",
      }),
    ).toThrow("GOOGLE_VERTEX_LOCATION is required");
    expect(() =>
      googleVertexProviderConfigSchema.parse({
        GOOGLE_VERTEX_PROJECT_ID: "p",
        GOOGLE_VERTEX_LOCATION: "loc",
      }),
    ).toThrow("GOOGLE_VERTEX_MODEL is required");
  });
});

describe("miniMaxProviderConfigSchema", () => {
  it("creates MiniMax provider config from typed environment variables", () => {
    const config = miniMaxProviderConfigSchema.parse({
      MINIMAX_API_KEY: "minimax-key",
      MINIMAX_BASE_URL: "https://api.minimax.example.com/v1",
      MINIMAX_MODEL: "minimax-1",
    });

    expect(config).toEqual({
      apiKey: "minimax-key",
      baseUrl: "https://api.minimax.example.com/v1",
      defaultModel: "minimax-1",
    });
  });

  it("requires api key, base url and model", () => {
    expect(() => miniMaxProviderConfigSchema.parse({})).toThrow(
      "MINIMAX_API_KEY is required",
    );
    expect(() =>
      miniMaxProviderConfigSchema.parse({ MINIMAX_API_KEY: "k" }),
    ).toThrow("MINIMAX_BASE_URL is required");
    expect(() =>
      miniMaxProviderConfigSchema.parse({
        MINIMAX_API_KEY: "k",
        MINIMAX_BASE_URL: "https://x",
      }),
    ).toThrow("MINIMAX_MODEL is required");
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
