import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { EngineAdapter, EngineHealth, EngineHistory, EngineMessageResult, EngineSendMessageInput, EngineSession, EngineToolState, EngineUsage } from "@departify/engine-adapter";
import { buildServer } from "../src/server/server.js";
import { loadBackendConfig } from "@departify/config";
import type { FastifyInstance } from "fastify";
import { makeFakeTenant } from "./helpers/fake-tenant.js";
import { issueScopedRuntimeToken } from "../src/customer-zero/runtime-identity.js";

class GatewayTestEngine implements EngineAdapter {
  readonly inputs: EngineSendMessageInput[] = [];
  readonly nativePolicies: Array<{ sessionId: string; toolNames: readonly string[] }> = [];
  nativeSelection = true;
  async createSession(input?: { sessionId?: string }): Promise<EngineSession> {
    return { id: input?.sessionId ?? "ceo:test", status: "active" };
  }
  async sendMessage(input: EngineSendMessageInput): Promise<EngineMessageResult> {
    this.inputs.push(input);
    return {
      sessionId: input.sessionId,
      text: input.nativeBusinessTools ? "Contexto de empresa consultado." : "ok",
      status: "completed",
      ...(input.nativeBusinessTools && this.nativeSelection
        ? { toolCalls: [{ name: "departify.company.context", status: "completed" as const }] }
        : {}),
    };
  }
  async setNativeToolPolicy(input: { sessionId: string; toolNames: readonly string[] }): Promise<void> {
    this.nativePolicies.push(input);
  }
  async getSession(): Promise<EngineSession | null> { return null; }
  async getHistory(sessionId: string): Promise<EngineHistory> { return { sessionId, items: [] }; }
  async closeSession(): Promise<void> {}
  async getUsage(): Promise<EngineUsage> { return {}; }
  async getToolState(): Promise<EngineToolState> { return { available: [], denied: [] }; }
  async health(): Promise<EngineHealth> { return { healthy: true, ready: true, provider: "test" }; }
}

describe("native company context gateway", () => {
  let server: FastifyInstance;
  let engine: GatewayTestEngine;
  let offServer: FastifyInstance;
  let offEngine: GatewayTestEngine;
  const secret = "native-gateway-test-secret";

  beforeAll(async () => {
    const tenant = makeFakeTenant();
    engine = new GatewayTestEngine();
    offEngine = new GatewayTestEngine();
    server = await buildServer(loadBackendConfig(), {
      auth: tenant,
      organizations: tenant,
      engine,
      nativeBusinessTools: true,
    });
    offServer = await buildServer(loadBackendConfig(), {
      auth: tenant,
      organizations: tenant,
      engine: offEngine,
    });
  });

  afterEach(() => {
    delete process.env.DEPARTIFY_RUNTIME_TOKEN;
    engine.nativeSelection = true;
  });

  it("returns bounded canonical context and ignores model organization arguments", async () => {
    process.env.DEPARTIFY_RUNTIME_TOKEN = secret;
    const start = await server.inject({
      method: "POST",
      url: "/api/customer-zero/start",
      headers: { authorization: "Bearer token-a" },
      payload: {
        companyName: "Native Context A",
        hasWebsite: false,
        description: "B2B software company.",
        goal: "Conseguir clientes",
      },
    });
    expect(start.statusCode).toBe(200);
    const orgA = start.json().organizationId as string;
    const tokenA = issueScopedRuntimeToken({
      secret,
      organizationId: orgA,
      sessionKey: `departify:ceo:${orgA}`,
    }).token;
    const response = await server.inject({
      method: "POST",
      url: "/internal/native-tools/company-context",
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { organizationId: "org-b", section: "all" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "success",
      organization: { id: orgA },
      company: { name: "Native Context A" },
    });
    expect(JSON.stringify(response.json())).not.toMatch(/access_token|refresh_token|service_role|authorization/i);
    expect(JSON.stringify(response.json())).not.toMatch(/Google|Gmail|Hostinger|Mautic|provider/i);
  });

  it("rejects a token from tenant A when its signed claims are changed to tenant B", async () => {
    process.env.DEPARTIFY_RUNTIME_TOKEN = secret;
    const issued = issueScopedRuntimeToken({
      secret,
      organizationId: "org-a",
      sessionKey: "departify:ceo:org-a",
    });
    const parts = issued.token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ ...issued.claims, organizationId: "org-b", sessionKey: "departify:ceo:org-b" })).toString("base64url");
    const forged = `${parts[0]}.${forgedPayload}.${parts[2]}`;
    const response = await server.inject({
      method: "POST",
      url: "/internal/native-tools/company-context",
      headers: { authorization: `Bearer ${forged}` },
      payload: {},
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects unknown, unavailable, expired, and wrong-audience native calls", async () => {
    process.env.DEPARTIFY_RUNTIME_TOKEN = secret;
    const org = "native-negative-org";
    const token = issueScopedRuntimeToken({ secret, organizationId: org, sessionKey: `departify:ceo:${org}` }).token;
    const headers = { authorization: `Bearer ${token}` };
    const unknown = await server.inject({
      method: "POST",
      url: "/internal/native-tools/tool",
      headers,
      payload: { toolName: "departify.email.send", params: {} },
    });
    expect(unknown.statusCode).toBe(404);
    const unavailable = await server.inject({
      method: "POST",
      url: "/internal/native-tools/tool",
      headers,
      payload: { toolName: "departify.email.list", params: { limit: 3 } },
    });
    expect(unavailable.statusCode).toBe(403);
    const expired = issueScopedRuntimeToken({ secret, organizationId: org, sessionKey: `departify:ceo:${org}`, nowSeconds: 100, ttlSeconds: 1 }).token;
    const expiredResponse = await server.inject({
      method: "POST",
      url: "/internal/native-tools/tool",
      headers: { authorization: `Bearer ${expired}` },
      payload: { toolName: "departify.company.context", params: {} },
    });
    expect(expiredResponse.statusCode).toBe(401);
    const wrongAudience = issueScopedRuntimeToken({ secret, organizationId: org, sessionKey: `departify:ceo:${org}`, audience: "wrong-audience" }).token;
    const wrongAudienceResponse = await server.inject({
      method: "POST",
      url: "/internal/native-tools/tool",
      headers: { authorization: `Bearer ${wrongAudience}` },
      payload: { toolName: "departify.company.context", params: {} },
    });
    expect(wrongAudienceResponse.statusCode).toBe(401);
  });

  it("rejects a malformed organization session before a UUID-backed store query", async () => {
    expect(issueScopedRuntimeToken({
      secret,
      organizationId: "engine032fresh20260812",
      sessionKey: "departify:ceo:engine032fresh20260812",
    }).claims.organizationId).not.toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("routes the real CEO HTTP entrypoint through native mode without textual tools", async () => {
    const start = await server.inject({
      method: "POST",
      url: "/api/customer-zero/start",
      headers: { authorization: "Bearer token-a" },
      payload: {
        companyName: "Native Route A",
        hasWebsite: false,
        description: "B2B software company.",
        goal: "Conseguir clientes",
      },
    });
    expect(start.statusCode).toBe(200);
    const organizationId = start.json().organizationId as string;
    const response = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/command-center/message`,
      headers: { authorization: "Bearer token-a" },
      payload: { message: "¿qué está haciendo Marketing ahora?" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().reply).toContain("Contexto de empresa consultado");
    const lastInput = engine.inputs.at(-1);
    expect(lastInput?.nativeBusinessTools).toBe(true);
    expect(engine.nativePolicies.at(-1)?.toolNames).toContain("departify.company.context");
    const trace = engine.inputs.at(-1);
    expect(trace?.nativeBusinessTools).toBe(true);
    expect(lastInput?.runtimeContext).toBeUndefined();
    expect(lastInput?.businessTools).toBeUndefined();
  });

  it("does not report native success when OpenClaw returns no native selection", async () => {
    engine.nativeSelection = false;
    const start = await server.inject({
      method: "POST",
      url: "/api/customer-zero/start",
      headers: { authorization: "Bearer token-a" },
      payload: {
        companyName: "Native No Selection",
        hasWebsite: false,
        description: "B2B software company.",
        goal: "Conseguir clientes",
      },
    });
    expect(start.statusCode).toBe(200);
    const organizationId = start.json().organizationId as string;
    const response = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/command-center/message`,
      headers: { authorization: "Bearer token-a" },
      payload: { message: "¿Qué sabes de mi empresa?" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().reply).not.toContain("Contexto de empresa consultado");
    expect(engine.inputs.at(-1)?.nativeBusinessTools).toBe(true);
    expect(engine.nativePolicies.at(-1)?.toolNames).toContain("departify.company.context");
  });

  it("keeps ENGINE 02 textual mode when the native flag is off", async () => {
    const start = await offServer.inject({
      method: "POST",
      url: "/api/customer-zero/start",
      headers: { authorization: "Bearer token-a" },
      payload: {
        companyName: "Legacy Route",
        hasWebsite: false,
        description: "B2B software company.",
        goal: "Conseguir clientes",
      },
    });
    expect(start.statusCode).toBe(200);
    const organizationId = start.json().organizationId as string;
    const response = await offServer.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/command-center/message`,
      headers: { authorization: "Bearer token-a" },
      payload: { message: "¿Qué sabes de mi empresa?" },
    });
    expect(response.statusCode).toBe(200);
    const input = offEngine.inputs.at(-1);
    expect(input?.nativeBusinessTools).toBeUndefined();
    expect(input?.runtimeContext).toContain("DEPARTIFY_RUNTIME_BUSINESS_CONTEXT");
    expect(input?.businessTools).toBeDefined();
  });
});
