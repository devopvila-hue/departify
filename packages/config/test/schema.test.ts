import { backendConfigSchema, validateEnv } from "../src/index.js";

describe("validateEnv", () => {
  it("loads Golden Image defaults", () => {
    const env = validateEnv({});

    expect(env.NODE_ENV).toBe("development");
    expect(env.HOST).toBe("127.0.0.1");
    expect(env.PORT).toBe(3210);
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.OTEL_SERVICE_NAME).toBe("departify-backend");
  });

  it("rejects invalid provider URLs", () => {
    expect(() => validateEnv({ SUPABASE_URL: "not-a-url" })).toThrow();
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
