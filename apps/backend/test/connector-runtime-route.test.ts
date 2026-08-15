import { beforeAll, describe, expect, it } from "vitest";
import type {
  ConnectorExecutionRequest,
  ConnectorExecutionResult,
  ConnectorHealthResult,
  ConnectorRuntime,
} from "@departify/connector-runtime";
import { buildServer } from "../src/server/server.js";
import { loadBackendConfig } from "@departify/config";
import { makeFakeTenant } from "./helpers/fake-tenant.js";
import type { ToolStateStore, OrganizationToolState } from "../src/customer-zero/tool-state.js";

class FakeToolStateStore implements ToolStateStore {
  private readonly states = new Map<string, OrganizationToolState>();

  set(state: OrganizationToolState): void {
    this.states.set(`${state.organizationId}:${state.toolId}`, state);
  }

  async get(organizationId: string, toolId: string): Promise<OrganizationToolState | null> {
    return this.states.get(`${organizationId}:${toolId}`) ?? null;
  }

  async listForOrg(organizationId: string): Promise<OrganizationToolState[]> {
    return [...this.states.values()].filter((state) => state.organizationId === organizationId);
  }

  async upsert(state: OrganizationToolState): Promise<void> {
    this.set(state);
  }
}

class FakeConnectorRuntime implements ConnectorRuntime {
  readonly provider = "activepieces" as const;
  readonly requests: ConnectorExecutionRequest[] = [];

  async health(): Promise<ConnectorHealthResult> {
    return { provider: "activepieces", healthy: true, status: 200, durationMs: 1 };
  }

  async execute<TOutput = unknown>(
    request: ConnectorExecutionRequest,
  ): Promise<ConnectorExecutionResult<TOutput>> {
    this.requests.push(request);
    const now = new Date().toISOString();
    return {
      requestId: request.requestId,
      organizationId: request.organizationId,
      provider: "activepieces",
      capability: request.capability,
      operation: request.operation,
      status: request.operation === "prepare" ? "prepared" : "succeeded",
      output: { tenant: request.organizationId, received: request.input } as TOutput,
      durationMs: 1,
      startedAt: now,
      completedAt: now,
    };
  }
}

describe("Activepieces connector runtime route", () => {
  const tenant = makeFakeTenant();
  const toolState = new FakeToolStateStore();
  const runtime = new FakeConnectorRuntime();
  let server: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    server = await buildServer(loadBackendConfig(), {
      auth: tenant,
      organizations: tenant,
      toolState,
      connectorRuntime: runtime,
      connectorRuntimes: [{
        provider: "activepieces",
        kind: "existing_connector",
        capabilities: [
          "marketing.meta.ads.read",
          "marketing.meta.ads.manage",
          "marketing.tiktok.ads.report",
          "marketing.google.ads.report",
        ],
        runtime,
      }],
    });
  });

  it("prepares the Meta capability for the authenticated tenant", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/customer-zero/org-a/connector-runtime/execute",
      headers: { authorization: "Bearer token-a" },
      payload: {
        operation: "prepare",
        capability: "marketing.meta.ads.read",
        input: { campaignId: "campaign-a" },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      organizationId: "org-a",
      capability: "marketing.meta.ads.read",
      status: "prepared",
    });
  });

  it("prepares Facebook Pages through the normalized social capability", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/customer-zero/org-a/connector-runtime/execute",
      headers: { authorization: "Bearer token-a" },
      payload: {
        operation: "prepare",
        capability: "marketing.social.publish",
        input: { content: "Un anuncio para la página" },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      organizationId: "org-a",
      capability: "marketing.social.publish",
      status: "prepared",
    });
    expect(response.json().provider).toBeUndefined();
  });

  it("does not execute Facebook Pages without an approval", async () => {
    toolState.set({
      organizationId: "org-a",
      toolId: "meta_business",
      label: "Facebook Pages",
      declared: true,
      status: "connected",
      grantedCapabilities: ["marketing.social.publish"],
      verifiedAt: new Date().toISOString(),
    });
    const before = runtime.requests.length;
    const response = await server.inject({
      method: "POST",
      url: "/api/customer-zero/org-a/connector-runtime/execute",
      headers: { authorization: "Bearer token-a" },
      payload: {
        operation: "execute",
        capability: "marketing.social.publish",
        input: { content: "No publicar todavía" },
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      status: "prepared",
      error: { code: "approval_required" },
    });
    expect(runtime.requests).toHaveLength(before);
    toolState.set({
      organizationId: "org-a",
      toolId: "meta_business",
      label: "Facebook Pages",
      declared: true,
      status: "needs_connection",
      grantedCapabilities: [],
    });
  });

  it("probes Activepieces through the authenticated tenant boundary", async () => {
    const response = await server.inject({
      method: "GET",
      url: "/api/customer-zero/org-a/connector-runtime/health",
      headers: { authorization: "Bearer token-a" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      healthy: true,
    });
    expect(response.json().provider).toBeUndefined();
  });

  it("rejects cross-tenant access before the connector runtime", async () => {
    const before = runtime.requests.length;
    const response = await server.inject({
      method: "POST",
      url: "/api/customer-zero/org-a/connector-runtime/execute",
      headers: { authorization: "Bearer token-b" },
      payload: {
        operation: "prepare",
        capability: "marketing.meta.ads.read",
      },
    });
    expect(response.statusCode).toBe(403);
    expect(runtime.requests).toHaveLength(before);
  });

  it("stops Meta execution at the OAuth boundary without calling Activepieces", async () => {
    const before = runtime.requests.length;
    const response = await server.inject({
      method: "POST",
      url: "/api/customer-zero/org-a/connector-runtime/execute",
      headers: { authorization: "Bearer token-a" },
      payload: {
        operation: "execute",
        capability: "marketing.meta.ads.read",
        input: { campaignId: "campaign-a" },
      },
    });
    expect(response.statusCode).toBe(424);
    expect(response.json()).toMatchObject({
      organizationId: "org-a",
      status: "credential_required",
      error: { code: "credential_required" },
    });
    expect(runtime.requests).toHaveLength(before);
  });

  it("executes only after the tenant's Meta connection is verified", async () => {
    toolState.set({
      organizationId: "org-a",
      toolId: "meta_business",
      label: "Meta Business",
      declared: true,
      status: "connected",
      verifiedAt: new Date().toISOString(),
    });
    const response = await server.inject({
      method: "POST",
      url: "/api/customer-zero/org-a/connector-runtime/execute",
      headers: { authorization: "Bearer token-a" },
      payload: {
        operation: "execute",
        capability: "marketing.meta.ads.read",
        input: { campaignId: "campaign-a" },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      organizationId: "org-a",
      status: "succeeded",
      output: { tenant: "org-a" },
    });
    expect(runtime.requests.at(-1)?.organizationId).toBe("org-a");
  });

  it("keeps TikTok and Google Ads connections tenant-scoped", async () => {
    toolState.set({ organizationId: "org-a", toolId: "tiktok_ads", label: "TikTok Ads", declared: true, status: "connected", verifiedAt: new Date().toISOString() });
    toolState.set({ organizationId: "org-a", toolId: "google_ads", label: "Google Ads", declared: true, status: "connected", verifiedAt: new Date().toISOString() });
    for (const capability of ["marketing.tiktok.ads.report", "marketing.google.ads.report"]) {
      const response = await server.inject({
        method: "POST",
        url: "/api/customer-zero/org-a/connector-runtime/execute",
        headers: { authorization: "Bearer token-a" },
        payload: { operation: "execute", capability, input: { dateRange: "LAST_30_DAYS" } },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ organizationId: "org-a", status: "succeeded" });
    }
    const accountOverride = await server.inject({
      method: "POST",
      url: "/api/customer-zero/org-a/connector-runtime/execute",
      headers: { authorization: "Bearer token-a" },
      payload: { operation: "execute", capability: "marketing.google.ads.report", input: { providerAccountId: "account-b" } },
    });
    expect(accountOverride.statusCode).toBe(403);
    expect(accountOverride.json()).toMatchObject({ error: { code: "credential_or_account_override" } });
  });

  it("requires a durable approval before a live advertising mutation", async () => {
    const response = await server.inject({
      method: "POST",
      url: "/api/customer-zero/org-a/connector-runtime/execute",
      headers: { authorization: "Bearer token-a" },
      payload: { operation: "execute", capability: "marketing.meta.ads.manage", input: { campaignId: "campaign-a" } },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ status: "prepared", error: { code: "approval_required" } });
    expect(runtime.requests.at(-1)?.capability).not.toBe("marketing.meta.ads.manage");
  });
});
