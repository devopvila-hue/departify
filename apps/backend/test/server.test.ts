import type { BackendConfig } from "@departify/config";
import { EngineInvalidRequestError } from "@departify/engine-adapter";
import { buildServer } from "../src/server/server.js";

const testConfig: BackendConfig = {
  environment: "test",
  host: "127.0.0.1",
  port: 0,
  logLevel: "silent",
  name: "@departify/backend",
  version: "0.0.0-test",
  observability: {
    serviceName: "departify-backend",
    metricsEnabled: false,
    tracingEnabled: false,
  },
  providers: {},
  corsAllowedOrigins: [],
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

  it("preserves the chat correlation id on centralized engine errors", async () => {
    const server = await buildServer(testConfig);
    server.get("/test-engine-error", async () => {
      throw new EngineInvalidRequestError("invalid request", {
        provider: "openclaw",
      });
    });

    const response = await server.inject({
      headers: { "x-departify-correlation-id": "chat-test-correlation" },
      method: "GET",
      url: "/test-engine-error",
    });
    await server.close();

    expect(response.statusCode).toBe(400);
    expect(response.headers["x-departify-correlation-id"]).toBe(
      "chat-test-correlation",
    );
    expect(response.json().error).toMatchObject({
      code: "ENGINE_INVALID_REQUEST",
      statusCode: 400,
    });
  });
});
