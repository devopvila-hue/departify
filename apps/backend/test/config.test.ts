import { loadConfig } from "../src/server/config.js";

describe("loadConfig", () => {
  it("loads defaults for local development", () => {
    const config = loadConfig({});

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
    expect(() => loadConfig({ PORT: "invalid" })).toThrow(/Invalid PORT/);
  });
});
