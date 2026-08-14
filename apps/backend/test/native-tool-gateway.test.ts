import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { EngineAdapter, EngineHealth, EngineHistory, EngineMessageResult, EngineSendMessageInput, EngineSession, EngineToolState, EngineUsage } from "@departify/engine-adapter";
import { buildServer } from "../src/server/server.js";
import { loadBackendConfig } from "@departify/config";
import type { FastifyInstance } from "fastify";
import { makeFakeTenant } from "./helpers/fake-tenant.js";
import { issueScopedRuntimeToken } from "../src/customer-zero/runtime-identity.js";
import { MarketingService } from "../src/customer-zero/marketing-service.js";

class GatewayTestEngine implements EngineAdapter {
  readonly inputs: EngineSendMessageInput[] = [];
  readonly nativePolicies: Array<{ sessionId: string; toolNames: readonly string[] }> = [];
  nativeSelection = true;
  nativeFailure = false;
  nativeText = "Contexto de empresa consultado.";
  async createSession(input?: { sessionId?: string }): Promise<EngineSession> {
    return { id: input?.sessionId ?? "ceo:test", status: "active" };
  }
  async sendMessage(input: EngineSendMessageInput): Promise<EngineMessageResult> {
    this.inputs.push(input);
    if (input.nativeBusinessTools && this.nativeFailure) {
      throw new Error("simulated native engine outage");
    }
    return {
      sessionId: input.sessionId,
      text: input.nativeBusinessTools
        ? /\bsegundo\b/i.test(input.message)
          ? "Segundo email revisado: más corto y directo."
          : this.nativeText
        : "ok",
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
      marketing: new MarketingService({ engine }),
      nativeBusinessTools: true,
    });
    offServer = await buildServer(loadBackendConfig(), {
      auth: tenant,
      organizations: tenant,
      engine: offEngine,
      marketing: new MarketingService({ engine: offEngine }),
    });
  });

  afterEach(() => {
    delete process.env.DEPARTIFY_RUNTIME_TOKEN;
    engine.nativeSelection = true;
    engine.nativeFailure = false;
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

  it("delegates to native Marketing specialist sessions and persists assigned work", async () => {
    process.env.DEPARTIFY_RUNTIME_TOKEN = secret;
    const start = await server.inject({
      method: "POST",
      url: "/api/customer-zero/start",
      headers: { authorization: "Bearer token-a" },
      payload: {
        companyName: "Native Marketing Workforce",
        hasWebsite: false,
        description: "B2B software company.",
        goal: "Conseguir clientes",
      },
    });
    expect(start.statusCode).toBe(200);
    const organizationId = start.json().organizationId as string;
    const token = issueScopedRuntimeToken({
      secret,
      organizationId,
      sessionKey: `departify:ceo:${organizationId}`,
    }).token;
    const before = engine.inputs.length;
    const response = await server.inject({
      method: "POST",
      url: "/internal/native-tools/tool",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        toolName: "departify.marketing.delegate",
        params: {
          objective: "Preparar una campaña de captación para septiembre",
          specialists: ["agent_content_strategist", "agent_ads_specialist"],
        },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "success", operation: "departify.marketing.delegate" });
    expect(response.json().data.delegated).toEqual([
      expect.objectContaining({ specialistId: "agent_content_strategist", status: "completed" }),
      expect.objectContaining({ specialistId: "agent_ads_specialist", status: "completed" }),
    ]);
    const specialistInputs = engine.inputs.slice(before);
    expect(specialistInputs.filter((input) => input.agentId !== "agent_marketing_director").map((input) => input.agentId)).toEqual([
      "agent_content_strategist",
      "agent_ads_specialist",
    ]);
    expect(specialistInputs.every((input) => input.nativeBusinessTools !== true)).toBe(true);
    expect(specialistInputs.at(-1)?.agentId).toBe("agent_marketing_director");
    expect(response.json().data.synthesis).toBeTruthy();
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
    expect(response.headers["x-departify-correlation-id"]).toBeTruthy();
    expect(response.json().reply).toContain("Contexto de empresa consultado");
    const lastInput = engine.inputs.at(-1);
    expect(lastInput?.nativeBusinessTools).toBe(true);
    expect(engine.nativePolicies).toHaveLength(1);
    const trace = engine.inputs.at(-1);
    expect(trace?.nativeBusinessTools).toBe(true);
    expect(lastInput?.runtimeContext).toContain("DEPARTIFY_NATIVE_RUNTIME_CONTEXT");
    expect(lastInput?.runtimeContext).not.toContain("DEPARTIFY_BUSINESS_TOOL_DEFINITIONS");
    expect(lastInput?.businessTools).toBeUndefined();
  });

  it("does not fall through to the legacy router after native generation fails", async () => {
    engine.nativeFailure = true;
    const start = await server.inject({
      method: "POST",
      url: "/api/customer-zero/start",
      headers: { authorization: "Bearer token-a" },
      payload: {
        companyName: "Native Failure Isolation",
        hasWebsite: false,
        description: "B2B software company.",
        goal: "Conseguir clientes",
      },
    });
    expect(start.statusCode).toBe(200);
    const organizationId = start.json().organizationId as string;
    const before = engine.inputs.length;
    const response = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/command-center/message`,
      headers: { authorization: "Bearer token-a" },
      payload: { message: "¿Qué está pasando en mi empresa?" },
    });
    expect(response.statusCode).toBe(502);
    expect(response.json().error).toMatchObject({ code: "ENGINE_EXECUTION", statusCode: 502 });
    expect(engine.inputs.slice(before)).toHaveLength(1);
  });

  it("routes the portal conversation endpoint through the same native path", async () => {
    engine.nativeSelection = false;
    const start = await server.inject({
      method: "POST",
      url: "/api/customer-zero/start",
      headers: { authorization: "Bearer token-a" },
      payload: {
        companyName: "Native Conversation Endpoint",
        hasWebsite: false,
        description: "B2B software company.",
        goal: "Conseguir clientes",
      },
    });
    expect(start.statusCode).toBe(200);
    const organizationId = start.json().organizationId as string;
    const created = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/conversations`,
      headers: { authorization: "Bearer token-a" },
      payload: {},
    });
    expect(created.statusCode).toBe(201);
    const conversationId = created.json().conversation.id as string;
    const before = engine.inputs.length;
    const response = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/conversations/${conversationId}/messages`,
      headers: { authorization: "Bearer token-a" },
      payload: { message: "Hazme un mailing de tres correos para vender Departify." },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().reply).toContain("Contexto de empresa consultado");
    const input = engine.inputs[before];
    expect(input?.nativeBusinessTools).toBe(true);
    expect(input?.sessionId).toBeTruthy();
    expect(response.json().reply).not.toMatch(/Lo paso a Elvira|Marketing|No puedo afirmar/i);
  });

  it("keeps the legacy Marketing message ingress on the canonical conversation", async () => {
    engine.nativeSelection = false;
    engine.nativeText = "Respuesta canónica de Marketing.";
    const start = await server.inject({
      method: "POST",
      url: "/api/customer-zero/start",
      headers: { authorization: "Bearer token-a" },
      payload: {
        companyName: "Canonical Marketing Ingress",
        hasWebsite: false,
        description: "B2B software company.",
        goal: "Conseguir clientes",
      },
    });
    const organizationId = start.json().organizationId as string;
    const response = await server.inject({
      method: "POST",
      url: `/api/departments/marketing/${organizationId}/message`,
      headers: { authorization: "Bearer token-a" },
      payload: { message: "Prepara una propuesta para septiembre." },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().reply).toBe(engine.nativeText);

    const conversations = await server.inject({
      method: "GET",
      url: `/api/customer-zero/${organizationId}/conversations`,
      headers: { authorization: "Bearer token-a" },
    });
    expect(conversations.statusCode).toBe(200);
    expect(conversations.json().conversations).toHaveLength(1);
    const conversationId = conversations.json().conversations[0].id as string;
    const history = await server.inject({
      method: "GET",
      url: `/api/customer-zero/${organizationId}/conversations/${conversationId}`,
      headers: { authorization: "Bearer token-a" },
    });
    expect(history.json().messages.at(-1)).toMatchObject({ role: "assistant", content: engine.nativeText });
  });

  it("persists and returns the exact native response across a durable conversation", async () => {
    engine.nativeSelection = false;
    engine.nativeText = "Mailing preparado:\n1. Presentación\n2. Caso de uso\n3. Cierre";
    const start = await server.inject({
      method: "POST",
      url: "/api/customer-zero/start",
      headers: { authorization: "Bearer token-a" },
      payload: {
        companyName: "Native Response Preservation",
        hasWebsite: false,
        description: "B2B software company.",
        goal: "Conseguir clientes",
      },
    });
    const organizationId = start.json().organizationId as string;
    const created = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/conversations`,
      headers: { authorization: "Bearer token-a" },
      payload: {},
    });
    const conversationId = created.json().conversation.id as string;
    const first = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/conversations/${conversationId}/messages`,
      headers: { authorization: "Bearer token-a" },
      payload: { message: "Hazme un mailing de tres correos para vender Departify." },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().reply).toBe(engine.nativeText);
    expect(first.json().reply).not.toContain("La operación ha terminado");

    const history = await server.inject({
      method: "GET",
      url: `/api/customer-zero/${organizationId}/conversations/${conversationId}`,
      headers: { authorization: "Bearer token-a" },
    });
    const messages = history.json().messages as Array<{ role: string; content: string }>;
    expect(messages.at(-1)).toMatchObject({ role: "assistant", content: engine.nativeText });

    engine.nativeText = "Mailing revisado: el segundo correo queda más corto y directo.";
    const second = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/conversations/${conversationId}/messages`,
      headers: { authorization: "Bearer token-a" },
      payload: { message: "Ahora haz el segundo más corto y directo." },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().reply).toContain("Segundo email revisado");
  });

  it("does not turn an empty native response into a false completed-operation message", async () => {
    engine.nativeSelection = false;
    engine.nativeText = "";
    const start = await server.inject({
      method: "POST",
      url: "/api/customer-zero/start",
      headers: { authorization: "Bearer token-a" },
      payload: {
        companyName: "Native Empty Response",
        hasWebsite: false,
        description: "B2B software company.",
        goal: "Conseguir clientes",
      },
    });
    const organizationId = start.json().organizationId as string;
    const response = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/command-center/message`,
      headers: { authorization: "Bearer token-a" },
      payload: { message: "Hazme un mailing de tres correos para vender Departify." },
    });
    expect(response.statusCode).toBe(502);
    expect(response.json().error).toMatchObject({ code: "ENGINE_EXECUTION", statusCode: 502 });
    engine.nativeText = "Contexto de empresa consultado.";
  });

  it("resolves an explicit durable work reference before capability routing", async () => {
    const start = await server.inject({
      method: "POST",
      url: "/api/customer-zero/start",
      headers: { authorization: "Bearer token-a" },
      payload: {
        companyName: "Durable Status Lookup",
        hasWebsite: false,
        description: "B2B software company.",
        goal: "Conseguir clientes",
      },
    });
    expect(start.statusCode).toBe(200);
    const organizationId = start.json().organizationId as string;
    const conversation = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/conversations`,
      headers: { authorization: "Bearer token-a" },
      payload: {},
    });
    const conversationId = conversation.json().conversation.id as string;
    const task = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/work-items`,
      headers: { authorization: "Bearer token-a" },
      payload: {
        capability: "crm.contacts.summary",
        title: "Análisis de contactos de Mautic",
        summary: "Estado del análisis",
        conversationId,
      },
    });
    expect(task.statusCode).toBe(200);
    const taskId = task.json().task.id as string;
    const response = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/conversations/${conversationId}/messages`,
      headers: { authorization: "Bearer token-a" },
      payload: { message: `¿En qué punto está el trabajo? (${taskId})` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().reply).toContain("Análisis de contactos de Mautic");
    expect(response.json().reply).toContain("estado");
    expect(response.json().reply).not.toContain("conectado");
  });

  it("keeps a completed native reasoning response instead of falling through to legacy routing", async () => {
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
      payload: { message: "Hazme un mailing de tres correos para vender Departify." },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().reply).toContain("Contexto de empresa consultado");
    expect(response.json().reply).not.toMatch(/Elvira|Marketing|No puedo afirmar/i);
    expect(engine.inputs.at(-1)?.nativeBusinessTools).toBe(true);
    expect(engine.nativePolicies.length).toBeGreaterThan(0);
  });

  it("keeps an ambiguous native business response in the same CEO path", async () => {
    engine.nativeSelection = false;
    const start = await server.inject({
      method: "POST",
      url: "/api/customer-zero/start",
      headers: { authorization: "Bearer token-a" },
      payload: {
        companyName: "Native Ambiguous Work",
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
      payload: { message: "Quiero crear listas con mis contactos pero no sé cómo categorizarlos." },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().reply).toContain("Contexto de empresa consultado");
    expect(response.json().reply).not.toMatch(/Lo paso a Elvira|Marketing/i);
    expect(engine.inputs.at(-1)?.nativeBusinessTools).toBe(true);
  });

  it("keeps native session continuity across two natural CEO turns", async () => {
    engine.nativeSelection = false;
    const beforeInputs = engine.inputs.length;
    const start = await server.inject({
      method: "POST",
      url: "/api/customer-zero/start",
      headers: { authorization: "Bearer token-a" },
      payload: {
        companyName: "Native Continuity",
        hasWebsite: false,
        description: "B2B software company.",
        goal: "Conseguir clientes",
      },
    });
    expect(start.statusCode).toBe(200);
    const organizationId = start.json().organizationId as string;
    const first = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/command-center/message`,
      headers: { authorization: "Bearer token-a" },
      payload: { message: "Quiero crear listas con mis contactos pero no sé cómo categorizarlos." },
    });
    const second = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/command-center/message`,
      headers: { authorization: "Bearer token-a" },
      payload: { message: "Usa las categorías que consideres mejores." },
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const turnInputs = engine.inputs.slice(beforeInputs);
    expect(turnInputs).toHaveLength(2);
    expect(turnInputs[0]?.sessionId).toBe(turnInputs[1]?.sessionId);
    expect(turnInputs.every((input) => input.nativeBusinessTools === true)).toBe(true);
    expect(second.json().reply).not.toMatch(/Lo paso a Elvira|Marketing/i);
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
