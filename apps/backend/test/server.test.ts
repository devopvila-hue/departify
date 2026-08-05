import { buildServer } from "../src/server/server.js";
import type { AppConfig } from "../src/server/config.js";

const testConfig: AppConfig = {
  environment: "test",
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  name: "@departify/backend",
  version: "0.0.0-test",
};

describe("backend server", () => {
  it("responds to /health", async () => {
    const server = await buildServer(testConfig);

    const response = await server.inject({ method: "GET", url: "/health" });
    await server.close();

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-request-id"]).toBeDefined();
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("responds to /version", async () => {
    const server = await buildServer(testConfig);

    const response = await server.inject({ method: "GET", url: "/version" });
    await server.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      environment: "test",
      name: "@departify/backend",
      version: "0.0.0-test",
    });
  });

  it("returns centralized not found errors", async () => {
    const server = await buildServer(testConfig);

    const response = await server.inject({
      headers: { "x-request-id": "test-request-id" },
      method: "GET",
      url: "/missing",
    });
    await server.close();

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Route not found",
        requestId: "test-request-id",
        statusCode: 404,
      },
    });
  });
});
