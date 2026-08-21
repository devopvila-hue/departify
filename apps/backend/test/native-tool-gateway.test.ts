import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type {
  EngineAdapter,
  EngineHealth,
  EngineHistory,
  EngineMessageResult,
  EngineSendMessageInput,
  EngineSession,
  EngineToolState,
  EngineUsage,
} from "@departify/engine-adapter";
import { buildServer } from "../src/server/server.js";
import { loadBackendConfig } from "@departify/config";
import type { FastifyInstance } from "fastify";
import { makeFakeTenant } from "./helpers/fake-tenant.js";
import { issueScopedRuntimeToken } from "../src/customer-zero/runtime-identity.js";
import { MarketingService } from "../src/customer-zero/marketing-service.js";
import { InMemoryCompanyDnaStore } from "../src/customer-zero/company-dna.js";
import { InMemoryToolStateStore } from "../src/customer-zero/tool-state.js";
import {
  createInMemoryGoogleTokenStore,
  installGoogleTokenStore,
  type GoogleTokenStore,
} from "../src/customer-zero/google-tokens.js";

class GatewayTestEngine implements EngineAdapter {
  readonly inputs: EngineSendMessageInput[] = [];
  readonly nativePolicies: Array<{
    sessionId: string;
    toolNames: readonly string[];
  }> = [];
  nativeSelection = true;
  nativeFailure = false;
  nativePostGenerationFailure = false;
  nativeText = "Contexto de empresa consultado.";
  delegatedText = "Resultado especialista listo.";
  async createSession(input?: { sessionId?: string }): Promise<EngineSession> {
    return { id: input?.sessionId ?? "ceo:test", status: "active" };
  }
  async sendMessage(
    input: EngineSendMessageInput,
  ): Promise<EngineMessageResult> {
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
        : this.delegatedText,
      status: "completed",
      ...(input.nativeBusinessTools && this.nativePostGenerationFailure
        ? { postGenerationFailure: true }
        : {}),
      ...(input.nativeBusinessTools && this.nativeSelection
        ? {
            toolCalls: [
              {
                name: "departify.company.context",
                status: "completed" as const,
              },
            ],
          }
        : {}),
    };
  }
  async setNativeToolPolicy(input: {
    sessionId: string;
    toolNames: readonly string[];
  }): Promise<void> {
    this.nativePolicies.push(input);
  }
  async getSession(): Promise<EngineSession | null> {
    return null;
  }
  async getHistory(sessionId: string): Promise<EngineHistory> {
    return { sessionId, items: [] };
  }
  async closeSession(): Promise<void> {}
  async getUsage(): Promise<EngineUsage> {
    return {};
  }
  async getToolState(): Promise<EngineToolState> {
    return { available: [], denied: [] };
  }
  async health(): Promise<EngineHealth> {
    return { healthy: true, ready: true, provider: "test" };
  }
}

async function waitFor(check: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(check()).toBe(true);
}

async function waitForAsync(
  check: () => Promise<boolean>,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check()) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(await check()).toBe(true);
}

describe("native company context gateway", () => {
  let server: FastifyInstance;
  let engine: GatewayTestEngine;
  let offServer: FastifyInstance;
  let offEngine: GatewayTestEngine;
  let companyDna: InMemoryCompanyDnaStore;
  let toolState: InMemoryToolStateStore;
  let googleTokens: GoogleTokenStore;
  const secret = "native-gateway-test-secret";

  beforeAll(async () => {
    const tenant = makeFakeTenant();
    engine = new GatewayTestEngine();
    offEngine = new GatewayTestEngine();
    companyDna = new InMemoryCompanyDnaStore();
    toolState = new InMemoryToolStateStore();
    googleTokens = createInMemoryGoogleTokenStore();
    installGoogleTokenStore(googleTokens);
    server = await buildServer(loadBackendConfig(), {
      auth: tenant,
      organizations: tenant,
      engine,
      companyDna,
      toolState,
      marketing: new MarketingService({ engine, companyDna }),
      nativeBusinessTools: true,
    });
    offServer = await buildServer(loadBackendConfig(), {
      auth: tenant,
      organizations: tenant,
      engine: offEngine,
      marketing: new MarketingService({ engine: offEngine }),
    });
  });

  afterAll(() => {
    installGoogleTokenStore(null);
  });

  afterEach(() => {
    delete process.env.DEPARTIFY_RUNTIME_TOKEN;
    engine.nativeSelection = true;
    engine.nativeFailure = false;
    engine.nativePostGenerationFailure = false;
    engine.nativeText = "Contexto de empresa consultado.";
    engine.delegatedText = "Resultado especialista listo.";
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
    expect(JSON.stringify(response.json())).not.toMatch(
      /access_token|refresh_token|service_role|authorization/i,
    );
    expect(JSON.stringify(response.json())).not.toMatch(
      /Google|Gmail|Hostinger|Mautic|provider/i,
    );
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
          department: "marketing",
          objective: "Preparar una campaña de captación para septiembre",
          specialists: ["agent_content_strategist", "agent_ads_specialist"],
        },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "success",
      operation: "departify.marketing.delegate",
    });
    expect(response.json().data).toMatchObject({ acceptedAsync: true });
    expect(response.json().data.delegated).toEqual([
      expect.objectContaining({
        specialistId: "agent_content_strategist",
        status: "running",
      }),
      expect.objectContaining({
        specialistId: "agent_ads_specialist",
        status: "running",
      }),
    ]);
    await waitFor(
      () =>
        engine.inputs.slice(before).filter((input) => input.agentId).length >=
        3,
    );
    const specialistInputs = engine.inputs.slice(before);
    expect(
      specialistInputs
        .filter((input) => input.agentId !== "agent_marketing_director")
        .map((input) => input.agentId),
    ).toEqual(["agent_content_strategist", "agent_ads_specialist"]);
    expect(
      specialistInputs.every((input) => input.nativeBusinessTools !== true),
    ).toBe(true);
    expect(specialistInputs.at(-1)?.agentId).toBe("agent_marketing_director");
    const feed = await server.inject({
      method: "GET",
      url: `/api/customer-zero/${organizationId}/work-feed`,
      headers: { authorization: "Bearer token-a" },
    });
    expect(feed.statusCode).toBe(200);
    expect(feed.json().tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assignedEmployeeId: "agent_content_strategist",
          status: "completed",
        }),
        expect.objectContaining({
          assignedEmployeeId: "agent_ads_specialist",
          status: "completed",
        }),
      ]),
    );
    expect(feed.json().results.length).toBeGreaterThanOrEqual(2);
    const employees = await server.inject({
      method: "GET",
      url: `/api/departments/marketing/${organizationId}/employees`,
      headers: { authorization: "Bearer token-a" },
    });
    expect(employees.statusCode).toBe(200);
    expect(employees.json().employees).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "agent_content_strategist" }),
        expect.objectContaining({ id: "agent_ads_specialist" }),
      ]),
    );
    expect(employees.json().employees).toHaveLength(3);
    const conversations = await server.inject({
      method: "GET",
      url: `/api/customer-zero/${organizationId}/conversations`,
      headers: { authorization: "Bearer token-a" },
    });
    const conversationId = conversations.json().conversations[0].id as string;
    const conversation = await server.inject({
      method: "GET",
      url: `/api/customer-zero/${organizationId}/conversations/${conversationId}`,
      headers: { authorization: "Bearer token-a" },
    });
    expect(conversation.json().messages.at(-1).role).toBe("assistant");
  });

  it("propagates organization Drive capabilities to delegated SEO without crossing tenants", async () => {
    process.env.DEPARTIFY_RUNTIME_TOKEN = secret;
    engine.delegatedText =
      "Auditoría SEO completada: canonical verificado y entregable preparado en Drive.";

    const startA = await server.inject({
      method: "POST",
      url: "/api/customer-zero/start",
      headers: { authorization: "Bearer token-a" },
      payload: {
        companyName: "SEO Tenant Alpha",
        hasWebsite: true,
        url: "https://alpha.example",
        description: "Empresa Alpha.",
        goal: "Corregir SEO",
      },
    });
    const orgA = startA.json().organizationId as string;
    const verifiedAt = new Date().toISOString();
    await toolState.upsert({
      organizationId: orgA,
      toolId: "google_drive",
      label: "Google Drive",
      declared: true,
      status: "connected",
      grantedCapabilities: ["drive.search", "drive.read"],
      verifiedAt,
      health: "operational",
    });
    await googleTokens.put({
      organizationId: orgA,
      userId: "founder-alpha",
      provider: "google_drive",
      accessToken: "test-access-alpha",
      refreshToken: "test-refresh-alpha",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
      email: "founder-alpha@example.test",
      displayName: "Founder Alpha",
      operationalVerifiedAt: verifiedAt,
      operationalProbeError: null,
      operationalCapabilities: ["drive.search", "drive.read"],
    });

    const invokeSeo = async (organizationId: string) => {
      const token = issueScopedRuntimeToken({
        secret,
        organizationId,
        sessionKey: `departify:ceo:${organizationId}`,
      }).token;
      return server.inject({
        method: "POST",
        url: "/internal/native-tools/tool",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          toolName: "departify.marketing.delegate",
          params: {
            department: "seo",
            objective: "Auditar y corregir el canonical",
            specialists: ["agent_seo_specialist"],
          },
        },
      });
    };

    const beforeA = engine.inputs.length;
    const acceptedA = await invokeSeo(orgA);
    expect(acceptedA.statusCode).toBe(200);
    expect(acceptedA.json().data).toMatchObject({
      acceptedAsync: true,
      department: "seo",
    });
    await waitForAsync(async () => {
      const feed = await server.inject({
        method: "GET",
        url: `/api/customer-zero/${orgA}/work-feed`,
        headers: { authorization: "Bearer token-a" },
      });
      return feed.json().tasks.some(
        (task: { departmentId: string; status: string }) =>
          task.departmentId === "seo" && task.status === "completed",
      );
    });
    const specialistA = engine.inputs
      .slice(beforeA)
      .find((input) => input.agentId === "agent_seo_specialist");
    expect(specialistA?.runtimeContext).toContain(
      '"id":"drive.search","available":true',
    );
    expect(specialistA?.runtimeContext).toContain(
      '"id":"drive.read","available":true',
    );
    expect(specialistA?.runtimeContext).not.toContain("test-refresh-alpha");
    expect(specialistA?.runtimeContext).not.toContain("test-access-alpha");
    expect(specialistA?.runtimeContext).not.toMatch(/Elvira|Content Strategist/);
    expect(specialistA?.runtimeContext).toContain('"id":"seo","name":"SEO"');

    const feedA = await server.inject({
      method: "GET",
      url: `/api/customer-zero/${orgA}/work-feed`,
      headers: { authorization: "Bearer token-a" },
    });
    expect(feedA.json().tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          departmentId: "seo",
          assignedEmployeeId: "agent_seo_specialist",
          status: "completed",
        }),
      ]),
    );
    expect(feedA.json().results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          departmentId: "seo",
          content: engine.delegatedText,
        }),
      ]),
    );
    expect(JSON.stringify(feedA.json())).not.toMatch(
      /Elvira|Content Strategist|plan de Marketing/i,
    );

    const conversationsA = await server.inject({
      method: "GET",
      url: `/api/customer-zero/${orgA}/conversations`,
      headers: { authorization: "Bearer token-a" },
    });
    const conversationA = await server.inject({
      method: "GET",
      url: `/api/customer-zero/${orgA}/conversations/${conversationsA.json().conversations[0].id}`,
      headers: { authorization: "Bearer token-a" },
    });
    const visibleCompletions = conversationA
      .json()
      .messages.filter(
        (message: { role: string; content: string }) =>
          message.role === "assistant" &&
          message.content.includes("El trabajo de SEO ha terminado"),
      );
    expect(visibleCompletions).toHaveLength(1);
    expect(visibleCompletions[0].content).not.toMatch(
      /Departify no ha podido responderte|Marketing|Elvira/i,
    );

    const startB = await server.inject({
      method: "POST",
      url: "/api/customer-zero/start",
      headers: { authorization: "Bearer token-a" },
      payload: {
        companyName: "SEO Tenant Beta",
        hasWebsite: true,
        url: "https://beta.example",
        description: "Empresa Beta sin Drive.",
        goal: "Corregir SEO",
      },
    });
    const orgB = startB.json().organizationId as string;
    const beforeB = engine.inputs.length;
    expect((await invokeSeo(orgB)).statusCode).toBe(200);
    await waitFor(
      () =>
        engine.inputs
          .slice(beforeB)
          .some((input) => input.agentId === "agent_seo_specialist"),
    );
    const specialistB = engine.inputs
      .slice(beforeB)
      .find((input) => input.agentId === "agent_seo_specialist");
    expect(specialistB?.runtimeContext).toContain(
      '"id":"drive.search","available":false',
    );
    expect(specialistB?.runtimeContext).not.toContain("SEO Tenant Alpha");
    expect(specialistB?.runtimeContext).not.toContain(
      "founder-alpha@example.test",
    );
  });

  it("rejects a token from tenant A when its signed claims are changed to tenant B", async () => {
    process.env.DEPARTIFY_RUNTIME_TOKEN = secret;
    const issued = issueScopedRuntimeToken({
      secret,
      organizationId: "org-a",
      sessionKey: "departify:ceo:org-a",
    });
    const parts = issued.token.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({
        ...issued.claims,
        organizationId: "org-b",
        sessionKey: "departify:ceo:org-b",
      }),
    ).toString("base64url");
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
    const token = issueScopedRuntimeToken({
      secret,
      organizationId: org,
      sessionKey: `departify:ceo:${org}`,
    }).token;
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
    const expired = issueScopedRuntimeToken({
      secret,
      organizationId: org,
      sessionKey: `departify:ceo:${org}`,
      nowSeconds: 100,
      ttlSeconds: 1,
    }).token;
    const expiredResponse = await server.inject({
      method: "POST",
      url: "/internal/native-tools/tool",
      headers: { authorization: `Bearer ${expired}` },
      payload: { toolName: "departify.company.context", params: {} },
    });
    expect(expiredResponse.statusCode).toBe(401);
    const wrongAudience = issueScopedRuntimeToken({
      secret,
      organizationId: org,
      sessionKey: `departify:ceo:${org}`,
      audience: "wrong-audience",
    }).token;
    const wrongAudienceResponse = await server.inject({
      method: "POST",
      url: "/internal/native-tools/tool",
      headers: { authorization: `Bearer ${wrongAudience}` },
      payload: { toolName: "departify.company.context", params: {} },
    });
    expect(wrongAudienceResponse.statusCode).toBe(401);
  });

  it("rejects a malformed organization session before a UUID-backed store query", async () => {
    expect(
      issueScopedRuntimeToken({
        secret,
        organizationId: "engine032fresh20260812",
        sessionKey: "departify:ceo:engine032fresh20260812",
      }).claims.organizationId,
    ).not.toMatch(/^[0-9a-f-]{36}$/i);
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
    expect(lastInput?.runtimeContext).toContain(
      "DEPARTIFY_NATIVE_RUNTIME_CONTEXT",
    );
    expect(lastInput?.runtimeContext).not.toContain(
      "DEPARTIFY_BUSINESS_TOOL_DEFINITIONS",
    );
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
    expect(response.json().error).toMatchObject({
      code: "ENGINE_EXECUTION",
      statusCode: 502,
    });
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
      payload: {
        message: "Hazme un mailing de tres correos para vender Departify.",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().reply).toContain("Contexto de empresa consultado");
    const input = engine.inputs[before];
    expect(input?.nativeBusinessTools).toBe(true);
    expect(input?.sessionId).toBeTruthy();
    expect(response.json().reply).not.toMatch(
      /Lo paso a Elvira|Marketing|No puedo afirmar/i,
    );
  });

  it("emits one SSE success and no failure after a valid native result is committed", async () => {
    engine.nativeSelection = false;
    engine.nativePostGenerationFailure = true;
    engine.nativeText = "Resultado SEO válido y persistido.";
    const start = await server.inject({
      method: "POST",
      url: "/api/customer-zero/start",
      headers: { authorization: "Bearer token-a" },
      payload: {
        companyName: "Delegated Success Commit",
        hasWebsite: false,
        description: "B2B software company.",
        goal: "Corregir SEO",
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
    const response = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/conversations/${conversationId}/messages/stream`,
      headers: { authorization: "Bearer token-a" },
      payload: {
        message: "Analiza esta propuesta empresarial y dame una recomendación detallada.",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body.match(/event: result/g)).toHaveLength(1);
    expect(response.body).not.toContain("event: error");
    expect(response.body).toContain(engine.nativeText);

    const history = await server.inject({
      method: "GET",
      url: `/api/customer-zero/${organizationId}/conversations/${conversationId}`,
      headers: { authorization: "Bearer token-a" },
    });
    expect(history.json().messages.at(-1)).toMatchObject({
      role: "assistant",
      content: engine.nativeText,
    });
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
    expect(history.json().messages.at(-1)).toMatchObject({
      role: "assistant",
      content: engine.nativeText,
    });
  });

  it("persists and returns the exact native response across a durable conversation", async () => {
    engine.nativeSelection = false;
    engine.nativeText =
      "Mailing preparado:\n1. Presentación\n2. Caso de uso\n3. Cierre";
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
      payload: {
        message: "Hazme un mailing de tres correos para vender Departify.",
      },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().reply).toBe(engine.nativeText);
    expect(first.json().reply).not.toContain("La operación ha terminado");

    const history = await server.inject({
      method: "GET",
      url: `/api/customer-zero/${organizationId}/conversations/${conversationId}`,
      headers: { authorization: "Bearer token-a" },
    });
    const messages = history.json().messages as Array<{
      role: string;
      content: string;
    }>;
    expect(messages.at(-1)).toMatchObject({
      role: "assistant",
      content: engine.nativeText,
    });

    engine.nativeText =
      "Mailing revisado: el segundo correo queda más corto y directo.";
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
      payload: {
        message: "Hazme un mailing de tres correos para vender Departify.",
      },
    });
    expect(response.statusCode).toBe(502);
    expect(response.json().error).toMatchObject({
      code: "ENGINE_EXECUTION",
      statusCode: 502,
    });
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
      payload: {
        message: "Hazme un mailing de tres correos para vender Departify.",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().reply).toContain("Contexto de empresa consultado");
    expect(response.json().reply).not.toMatch(
      /Elvira|Marketing|No puedo afirmar/i,
    );
    expect(engine.inputs.at(-1)?.nativeBusinessTools).toBe(true);
    expect(engine.nativePolicies.length).toBeGreaterThan(0);
  });

  it("returns successful native mutation reasoning to the deterministic approval gate", async () => {
    engine.nativeSelection = false;
    engine.nativeText = "He revisado la solicitud y prepararé el borrador.";
    const start = await server.inject({
      method: "POST",
      url: "/api/customer-zero/start",
      headers: { authorization: "Bearer token-a" },
      payload: {
        companyName: "Native Mutation Gate",
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
      payload: {
        message: "respóndele al último correo diciendo que mañana lo miro",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().reply).toMatch(/a qué correo|leer el último correo/i);
    expect(response.json().reply).not.toMatch(/motor de negocio ha fallado/i);
    expect(engine.inputs.at(-1)?.nativeBusinessTools).toBe(true);
    engine.nativeText = "Contexto de empresa consultado.";
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
      payload: {
        message:
          "Quiero crear listas con mis contactos pero no sé cómo categorizarlos.",
      },
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
      payload: {
        message:
          "Quiero crear listas con mis contactos pero no sé cómo categorizarlos.",
      },
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
    expect(
      turnInputs.every((input) => input.nativeBusinessTools === true),
    ).toBe(true);
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
    expect(input?.runtimeContext).toContain(
      "DEPARTIFY_RUNTIME_BUSINESS_CONTEXT",
    );
    expect(input?.businessTools).toBeDefined();
  });
});
