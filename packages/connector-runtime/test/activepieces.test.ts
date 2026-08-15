import { ActivepiecesConnectorRuntime } from "../src/index.js";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const request = {
  requestId: "req-1",
  organizationId: "org-a",
  capability: "marketing.meta.ads.read",
  operation: "execute" as const,
  input: { campaignId: "campaign-1" },
  sideEffect: false,
};

describe("ActivepiecesConnectorRuntime", () => {
  it("prepares a capability without contacting Activepieces", async () => {
    let calls = 0;
    const runtime = new ActivepiecesConnectorRuntime({
      baseUrl: "http://activepieces",
      webhookPaths: {},
      fetch: async () => {
        calls += 1;
        return response({});
      },
    });

    await expect(runtime.execute({ ...request, operation: "prepare" })).resolves.toMatchObject({
      status: "prepared",
      organizationId: "org-a",
    });
    expect(calls).toBe(0);
  });

  it("returns a normalized not-configured result", async () => {
    const runtime = new ActivepiecesConnectorRuntime({
      baseUrl: "http://activepieces",
      webhookPaths: {},
      fetch: async () => response({}),
    });
    await expect(runtime.execute(request)).resolves.toMatchObject({
      status: "not_configured",
      error: { code: "flow_binding_missing", retryable: false },
    });
  });

  it("sends only tenant-bound business input and signs the request", async () => {
    let received: RequestInit | undefined;
    const runtime = new ActivepiecesConnectorRuntime({
      baseUrl: "http://activepieces",
      webhookPaths: { "marketing.meta.ads.read": "/api/v1/webhooks/meta" },
      webhookSigningSecret: "runtime-secret",
      fetch: async (_url, init) => {
        received = init;
        return response({ id: "run-1", status: "SUCCEEDED", output: { clicks: 3 } });
      },
    });

    await expect(runtime.execute(request)).resolves.toMatchObject({
      status: "succeeded",
      providerExecutionId: "run-1",
      output: { clicks: 3 },
    });
    const body = String(received?.body);
    expect(body).toContain("org-a");
    expect(body).toContain("campaign-1");
    expect(body).not.toContain("runtime-secret");
    expect((received?.headers as Record<string, string>)["x-departify-signature"]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects credential-shaped input before network execution", async () => {
    let calls = 0;
    const runtime = new ActivepiecesConnectorRuntime({
      baseUrl: "http://activepieces",
      webhookPaths: { "marketing.meta.ads.read": "/api/v1/webhooks/meta" },
      fetch: async () => {
        calls += 1;
        return response({});
      },
    });
    const result = await runtime.execute({ ...request, input: { accessToken: "should-not-cross" } });
    expect(result).toMatchObject({
      status: "failed",
      error: { code: "secret_payload_rejected" },
    });
    expect(calls).toBe(0);
  });

  it("rejects tenant overrides and keeps secrets out of normalized output and events", async () => {
    const events: unknown[] = [];
    const runtime = new ActivepiecesConnectorRuntime({
      baseUrl: "http://activepieces",
      webhookPaths: { "marketing.meta.ads.read": "/api/v1/webhooks/meta" },
      webhookSigningSecret: "runtime-secret",
      onEvent: (event) => events.push(event),
      fetch: async () => response({
        id: "run-3",
        status: "SUCCEEDED",
        output: { clicks: 3, accessToken: "provider-secret" },
      }),
    });

    await expect(runtime.execute({
      ...request,
      input: { organizationId: "org-b" },
    })).resolves.toMatchObject({
      status: "failed",
      error: { code: "tenant_mismatch" },
    });

    const result = await runtime.execute(request);
    expect(result).toMatchObject({
      status: "succeeded",
      output: { clicks: 3, accessToken: "[REDACTED]" },
    });
    expect(JSON.stringify(events)).not.toContain("provider-secret");
    expect(JSON.stringify(events)).not.toContain("runtime-secret");
  });

  it("normalizes provider failure and redacts secret-shaped output", async () => {
    const runtime = new ActivepiecesConnectorRuntime({
      baseUrl: "http://activepieces",
      webhookPaths: { "marketing.meta.ads.read": "/api/v1/webhooks/meta" },
      fetch: async () => response({ id: "run-2", status: "FAILED", output: { accessToken: "secret" } }),
    });
    await expect(runtime.execute(request)).resolves.toMatchObject({
      status: "failed",
      providerExecutionId: "run-2",
      error: { code: "activepieces_run_failed" },
    });
  });

  it("maps an unavailable provider to a retryable normalized error", async () => {
    const runtime = new ActivepiecesConnectorRuntime({
      baseUrl: "http://activepieces",
      webhookPaths: { "marketing.meta.ads.read": "/api/v1/webhooks/meta" },
      fetch: async () => response({ message: "down" }, 503),
    });
    await expect(runtime.execute(request)).resolves.toMatchObject({
      status: "failed",
      error: { code: "activepieces_http_error", retryable: true, providerStatus: 503 },
    });
  });

  it("normalizes provider cancellation", async () => {
    const runtime = new ActivepiecesConnectorRuntime({
      baseUrl: "http://activepieces",
      webhookPaths: { "marketing.meta.ads.read": "/api/v1/webhooks/meta" },
      fetch: async () => response({ id: "run-4", status: "CANCELED" }),
    });
    await expect(runtime.execute(request)).resolves.toMatchObject({
      status: "cancelled",
      error: { code: "cancelled", retryable: false },
    });
  });
});
