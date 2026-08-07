import type { BackendConfig } from "@departify/config";
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
};

describe("Customer Zero marketing endpoint", () => {
  it("accepts a real company and returns the first Marketing result", async () => {
    const server = await buildServer(testConfig);

    const response = await server.inject({
      method: "POST",
      url: "/api/customer-zero/marketing",
      payload: {
        companyName: "MOON Shared Living",
        rawData: {
          mission: {
            statement: "Co-living compartido en Barcelona y Madrid",
            confidence: {
              level: "verified",
              source: "user_input",
              lastVerified: new Date().toISOString(),
            },
          },
          market: {
            industry: "co-living",
            competition: "medium",
            confidence: {
              level: "verified",
              source: "user_input",
              lastVerified: new Date().toISOString(),
            },
          },
        },
      },
    });
    await server.close();

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("completed");
    expect(body.companyName).toBe("MOON Shared Living");
    expect(body.department).toBe("Marketing");
    expect(body.organizationId).toMatch(/^org_moon/);
    expect(body.runId).toMatch(/^run_/);
    expect(body.errors).toEqual([]);
    expect(body.firstResult).not.toBeNull();
    expect(body.firstResult.gapCount).toBeGreaterThan(0);
    expect(body.firstResult.criticalGapCount).toBeGreaterThan(0);
    expect(typeof body.firstResult.confidence).toBe("string");
  });

  it("reuses the existing composition: real Marketing department created", async () => {
    const server = await buildServer(testConfig);

    const response = await server.inject({
      method: "POST",
      url: "/api/customer-zero/marketing",
      payload: {
        companyName: "MOON",
        rawData: {},
      },
    });
    await server.close();

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("completed");
    // The first result was produced by the Marketing employee through the
    // existing onboarding pipeline.
    expect(body.firstResult).not.toBeNull();
  });

  it("runs without rawData and still completes (empty DNA path)", async () => {
    const server = await buildServer(testConfig);

    const response = await server.inject({
      method: "POST",
      url: "/api/customer-zero/marketing",
      payload: {
        companyName: "Sin datos",
      },
    });
    await server.close();

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe("completed");
  });
});

describe("Customer Zero marketing endpoint validation", () => {
  it("rejects a request without a companyName", async () => {
    const server = await buildServer(testConfig);

    const response = await server.inject({
      method: "POST",
      url: "/api/customer-zero/marketing",
      payload: {},
    });
    await server.close();

    expect(response.statusCode).toBe(400);
  });
});
