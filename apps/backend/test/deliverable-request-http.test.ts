import { afterEach, describe, expect, it } from "vitest";
import type { EngineAdapter } from "@departify/engine-adapter";
import type {
  EngineHistory,
  EngineHealth,
  EngineMessageResult,
  EngineSendMessageInput,
  EngineSession,
  EngineToolState,
  EngineUsage,
} from "@departify/engine-adapter";
import type { FastifyInstance } from "fastify";
import type { InjectOptions } from "light-my-request";
import { loadBackendConfig } from "@departify/config";
import { buildServer } from "../src/server/server.js";
import { makeFakeTenant } from "./helpers/fake-tenant.js";
import { InMemoryInboxStore } from "../src/customer-zero/inbox-domain.js";
import { InMemoryDepartmentWorkStore } from "../src/customer-zero/department-work.js";
import { InMemoryToolStateStore } from "../src/customer-zero/tool-state.js";
import {
  getOrCreateCustomerZeroSession,
  resetCustomerZeroSessionsForTest,
} from "../src/customer-zero/customer-zero-session.js";
import { __resetWorkStoreForTests } from "../src/server/routes/customer-zero-v2.js";
import { classifyDeliverableRequest } from "../src/customer-zero/command-center.js";

const AUTH = { authorization: "Bearer token-a" };

class CapabilityAckEngine implements EngineAdapter {
  readonly inputs: EngineSendMessageInput[] = [];
  readonly policies: string[][] = [];
  private sessionCreated = false;
  private session: EngineSession = { id: "ceo:deliverable-test", status: "active" };

  async createSession(input?: { sessionId?: string }): Promise<EngineSession> {
    this.session = { ...this.session, id: input?.sessionId ?? this.session.id };
    this.sessionCreated = true;
    return this.session;
  }

  async setNativeToolPolicy(input: { sessionId: string; toolNames: readonly string[] }): Promise<void> {
    this.policies.push([...input.toolNames]);
  }

  async sendMessage(input: EngineSendMessageInput): Promise<EngineMessageResult> {
    this.inputs.push(input);
    if (input.nativeBusinessTools && this.onNativeTurn) {
      const result = await this.onNativeTurn(input);
      return {
        sessionId: input.sessionId,
        messageId: `message-${this.inputs.length}`,
        status: "completed",
        text: result.summary,
        toolCalls: [{ name: "departify.work.deliverable", status: "completed" }],
      };
    }
    return {
      sessionId: input.sessionId,
      messageId: `message-${this.inputs.length}`,
      status: "completed",
      // This reproduces the production failure: OpenClaw acknowledges access
      // but does not select a work executor/native provider operation.
      text: "Sí. Mautic está conectado y operativo. Ya tengo acceso y puedo trabajar con ello.",
    };
  }

  onNativeTurn?: (input: EngineSendMessageInput) => Promise<{ summary: string }>;

  async getSession(sessionId: string): Promise<EngineSession | null> {
    return this.sessionCreated && this.session.id === sessionId ? this.session : null;
  }

  async getHistory(sessionId: string): Promise<EngineHistory> {
    return { sessionId, items: [] };
  }

  async closeSession(): Promise<void> {}
  async getUsage(): Promise<EngineUsage> { return {}; }
  async getToolState(): Promise<EngineToolState> { return { available: [], denied: [] }; }
  async health(): Promise<EngineHealth> { return { healthy: true, ready: true, provider: "fake" }; }
}

describe("P0 deliverable request HTTP boundary", () => {
  let server: FastifyInstance | null = null;
  let engine: CapabilityAckEngine | null = null;
  let workStore: InMemoryDepartmentWorkStore | null = null;
  let toolState: InMemoryToolStateStore | null = null;
  const previousMautic = {
    baseUrl: process.env.MAUTIC_BASE_URL,
    clientId: process.env.MAUTIC_CLIENT_ID,
    clientSecret: process.env.MAUTIC_CLIENT_SECRET,
  };
  const originalFetch = globalThis.fetch;

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    if (previousMautic.baseUrl === undefined) delete process.env.MAUTIC_BASE_URL;
    else process.env.MAUTIC_BASE_URL = previousMautic.baseUrl;
    if (previousMautic.clientId === undefined) delete process.env.MAUTIC_CLIENT_ID;
    else process.env.MAUTIC_CLIENT_ID = previousMautic.clientId;
    if (previousMautic.clientSecret === undefined) delete process.env.MAUTIC_CLIENT_SECRET;
    else process.env.MAUTIC_CLIENT_SECRET = previousMautic.clientSecret;
    resetCustomerZeroSessionsForTest();
    __resetWorkStoreForTests();
    await server?.close();
    server = null;
    engine = null;
    workStore = null;
    toolState = null;
  });

  it.each([
    "hazme un dashboard de los contactos de Mautic",
    "crea un informe de los contactos de Mautic",
    "analiza los contactos y enséñame los resultados",
    "genera un gráfico de contactos",
    "prepara un reporte de contactos",
  ])("recognizes a generic actionable deliverable: %s", (message) => {
    expect(classifyDeliverableRequest(message).requested).toBe(true);
  });

  it("autonomously composes authorized Mautic data into a durable dashboard", async () => {
    process.env.MAUTIC_BASE_URL = "https://mautic.test";
    process.env.MAUTIC_CLIENT_ID = "test-client";
    process.env.MAUTIC_CLIENT_SECRET = "test-secret";
    process.env.DEPARTIFY_RUNTIME_TOKEN = "runtime-test-secret";

    const mauticCalls: string[] = [];
    globalThis.fetch = (async (input: string | URL) => {
      const url = String(input);
      if (url.includes("mautic.test")) mauticCalls.push(url);
      if (url.endsWith("/oauth/v2/token")) {
        return new Response(JSON.stringify({ access_token: "provider-token" }), { status: 200 });
      }
      if (url.includes("/api/contacts")) {
        return new Response(JSON.stringify({
          total: 2,
          contacts: {
            "1": { id: 1, points: 90, fields: { all: { firstname: "A", lastname: "Lead", email: "a@example.com" } } },
            "2": { id: 2, points: 20, fields: { all: { firstname: "B", lastname: "Lead", email: "b@example.com" } } },
          },
        }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const tenant = makeFakeTenant();
    engine = new CapabilityAckEngine();
    workStore = new InMemoryDepartmentWorkStore();
    toolState = new InMemoryToolStateStore();
    server = await buildServer(loadBackendConfig(), {
      auth: tenant,
      organizations: tenant,
      inbox: new InMemoryInboxStore(),
      workStore,
      toolState,
      engine,
      nativeBusinessTools: true,
    });

    const authedInject = (options: InjectOptions) => server!.inject({
      ...options,
      headers: { ...AUTH, ...(options.headers ?? {}) },
    });

    const start = await authedInject({
      method: "POST",
      url: "/api/customer-zero/start",
      payload: {
        companyName: "Deliverable HTTP Test",
        hasWebsite: false,
        description: "Servicio B2B.",
        goal: "Conseguir clientes",
      },
    });
    expect(start.statusCode).toBe(200);
    const organizationId = start.json().organizationId as string;
    const session = getOrCreateCustomerZeroSession(organizationId);
    await toolState.upsert({
      organizationId,
      toolId: "mautic",
      label: "Mautic",
      capability: "CRM",
      declared: true,
      status: "connected",
      configSource: "env:mautic",
      grantedCapabilities: ["crm.contacts.read", "crm.contacts.list", "crm.contacts.summary"],
      verifiedAt: new Date().toISOString(),
      health: "operational",
    });
    const mautic = session.state.connections.get("mautic");
    expect(mautic).toBeTruthy();
    mautic!.status = "connected";
    mautic!.lifecycle = "connected";

    engine.onNativeTurn = async () => {
      const token = await authedInject({
        method: "POST",
        url: "/internal/native-tools/runtime-token",
        headers: { authorization: "Bearer runtime-test-secret" },
        payload: { sessionKey: `departify:ceo:${organizationId}` },
      });
      expect(token.statusCode).toBe(200);
      const scoped = token.json() as { token: string };
      const gateway = await authedInject({
        method: "POST",
        url: "/internal/native-tools/tool",
        headers: { authorization: `Bearer ${scoped.token}` },
        payload: {
          toolName: "departify.work.deliverable",
          params: {
            objective: "hazme un dashboard con el scoring de los contactos de Mautic",
            capability: "crm.contacts.list",
            transformation: "score",
            title: "Scoring de contactos",
          },
        },
      });
      expect(gateway.statusCode).toBe(200);
      return gateway.json() as { summary: string };
    };

    const response = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/command-center/message`,
      payload: { message: "hazme un dashboard con el scoring de los contactos de Mautic" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { reply: string; routing: { intent: string } };
    expect(body.routing.intent).toBe("direct_response");
    expect(body.reply).toMatch(/resultado|scoring|puntuaci[oó]n/i);
    expect(body.reply).not.toMatch(/skill|openclaw|plugin|tool|mautic est[aá] conectado/i);
    expect(engine.inputs).toHaveLength(1);
    expect(engine.inputs[0]?.nativeBusinessTools).toBe(true);
    expect(engine.policies).toHaveLength(1);

    const tasks = await workStore.listTasksForOrg(organizationId);
    const durableResults = await workStore.listResultsForOrg(organizationId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.status).toBe("completed");
    expect(durableResults).toHaveLength(1);
    expect(durableResults[0]?.chart?.kind).toBe("bar");
    expect(durableResults[0]?.producedByCapability).toBe("crm.contacts.list");
    expect(mauticCalls.some((url) => url.includes("/api/contacts"))).toBe(true);
    expect(mauticCalls.join(" ")).not.toContain("provider-token");

    const results = await authedInject({
      method: "GET",
      url: `/api/customer-zero/${organizationId}/results`,
    });
    expect(results.statusCode).toBe(200);
    expect(results.json().results).toHaveLength(1);
    expect(results.json().dashboardCount).toBe(1);
  });
});
