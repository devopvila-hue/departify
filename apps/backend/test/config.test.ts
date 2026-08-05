import { backendConfigSchema } from "@departify/config";

describe("backendConfigSchema", () => {
  it("loads defaults for local development", () => {
    const config = backendConfigSchema.parse({});

    expect(config).toMatchObject({
      environment: "development",
      host: "127.0.0.1",
      port: 3210,
      logLevel: "info",
      name: "@departify/backend",
      version: "0.0.0",
    });
  });

  it("rejects invalid ports", () => {
    expect(() => backendConfigSchema.parse({ PORT: "invalid" })).toThrow();
  });
});
