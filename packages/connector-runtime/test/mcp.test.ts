import { describe, expect, it } from "vitest";
import { McpConnectorRuntime, selectConnectorRuntime, type ConnectorRuntimeCandidate } from "../src/index.js";
import type { ConnectorExecutionRequest, ConnectorExecutionResult, ConnectorHealthResult, ConnectorRuntime } from "../src/index.js";

const request: ConnectorExecutionRequest = {
  requestId: "req-mcp-1",
  organizationId: "org-a",
  capability: "marketing.meta.ads.report",
  operation: "execute",
  input: { dateRange: "LAST_30_DAYS" },
  sideEffect: false,
};

function json(body: unknown, status = 200, sessionId = "session-a"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(sessionId ? { "mcp-session-id": sessionId } : {}) },
  });
}

describe("McpConnectorRuntime", () => {
  it("discovers tools and calls the mapped tool without leaking auth material", async () => {
    const calls: Array<{ method: string; body: Record<string, unknown>; headers: Headers }> = [];
    const runtime = new McpConnectorRuntime({
      provider: "meta_ads",
      endpoint: "https://mcp.example.test/ads",
      authHeaders: () => ({ authorization: "Bearer secret-token" }),
      capabilityToolHints: { "marketing.meta.ads.report": ["ads_get_insights"] },
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        calls.push({ method: body.method, body, headers: new Headers(init?.headers) });
        if (body.method === "initialize") return json({ result: { protocolVersion: "2025-06-18" } });
        if (body.method === "notifications/initialized") return new Response(null, { status: 202, headers: { "mcp-session-id": "session-a" } });
        if (body.method === "tools/list") return json({ result: { tools: [{ name: "ads_get_insights", inputSchema: { type: "object" } }] } });
        return json({ result: { structuredContent: { spend: 42, access_token: "provider-secret" } } });
      },
    });

    const result = await runtime.execute(request);
    expect(result).toMatchObject({ provider: "meta_ads", status: "succeeded", output: { structuredContent: { spend: 42, access_token: "[REDACTED]" } } });
    expect(calls.map((call) => call.method)).toEqual(["initialize", "notifications/initialized", "tools/list", "tools/call"]);
    expect(calls.at(-1)?.body.params).toMatchObject({ name: "ads_get_insights", arguments: { dateRange: "LAST_30_DAYS" } });
    expect(calls.at(-1)?.headers.get("authorization")).toBe("Bearer secret-token");
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it("prepares without contacting the provider and rejects tenant/secret overrides", async () => {
    let calls = 0;
    const runtime = new McpConnectorRuntime({ provider: "tiktok_ads", endpoint: "https://mcp.example.test/tiktok", fetch: async () => { calls += 1; return json({}); } });
    await expect(runtime.execute({ ...request, operation: "prepare", capability: "marketing.tiktok.ads.create" })).resolves.toMatchObject({ status: "prepared" });
    await expect(runtime.execute({ ...request, input: { tenantId: "org-b" } })).resolves.toMatchObject({ status: "failed", error: { code: "tenant_mismatch" } });
    await expect(runtime.execute({ ...request, input: { accessToken: "should-not-cross" } })).resolves.toMatchObject({ status: "failed", error: { code: "secret_payload_rejected" } });
    expect(calls).toBe(0);
  });

  it("normalizes unauthorized and unavailable tool responses", async () => {
    const unauthorized = new McpConnectorRuntime({ provider: "meta_ads", endpoint: "https://mcp.example.test/ads", fetch: async () => json({ detail: "no" }, 401) });
    await expect(unauthorized.execute(request)).resolves.toMatchObject({ status: "unauthorized", error: { code: "unauthorized", retryable: false } });

    const unavailable = new McpConnectorRuntime({ provider: "google_ads_mcp", endpoint: "https://mcp.example.test/google", fetch: async (_url, init) => {
      const method = JSON.parse(String(init?.body)).method;
      if (method === "initialize") return json({ result: {} });
      if (method === "tools/list") return json({ result: { tools: [{ name: "campaigns_list" }] } });
      return json({});
    } });
    await expect(unavailable.execute({ ...request, capability: "marketing.google.ads.report" })).resolves.toMatchObject({ status: "not_configured", error: { code: "mcp_tool_unavailable" } });
  });
});

describe("provider selection policy", () => {
  it("prefers official MCP/API over Activepieces and custom providers", () => {
    const fake = (provider: "activepieces" | "google_ads_api" | "meta_ads"): ConnectorRuntime => ({
      provider,
      execute: async <TOutput = unknown>(request: ConnectorExecutionRequest): Promise<ConnectorExecutionResult<TOutput>> => { void request; throw new Error("not used"); },
      health: async (): Promise<ConnectorHealthResult> => ({ provider, healthy: true, status: 200, durationMs: 0 }),
    });
    const candidates: ConnectorRuntimeCandidate[] = [
      { provider: "activepieces", kind: "activepieces_community", capabilities: ["marketing.google.ads.read"], runtime: fake("activepieces") },
      { provider: "google_ads_api", kind: "official_api", capabilities: ["marketing.google.ads.read"], runtime: fake("google_ads_api") },
      { provider: "meta_ads", kind: "custom", capabilities: ["marketing.google.ads.read"], runtime: fake("meta_ads") },
    ];
    expect(selectConnectorRuntime("marketing.google.ads.read", candidates)?.candidate.provider).toBe("google_ads_api");
  });
});
