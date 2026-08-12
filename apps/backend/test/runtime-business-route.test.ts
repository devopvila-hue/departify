import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
import { buildServer } from "../src/server/server.js";
import { loadBackendConfig } from "@departify/config";
import type { FastifyInstance } from "fastify";
import type { InjectOptions } from "light-my-request";
import { makeFakeTenant } from "./helpers/fake-tenant.js";
import { InMemoryInboxStore } from "../src/customer-zero/inbox-domain.js";
import { InMemoryDepartmentWorkStore } from "../src/customer-zero/department-work.js";
import {
  getOrCreateCustomerZeroSession,
  resetCustomerZeroSessionsForTest,
} from "../src/customer-zero/customer-zero-session.js";
import {
  __resetWorkStoreForTests,
  isRuntimeExplicitApproval,
} from "../src/server/routes/customer-zero-v2.js";
import {
  createInMemoryGoogleTokenStore,
  getGoogleTokenStore,
  installGoogleTokenStore,
} from "../src/customer-zero/google-tokens.js";

const AUTH = { authorization: "Bearer token-a" };

class FakeRuntimeEngine implements EngineAdapter {
  readonly inputs: EngineSendMessageInput[] = [];
  mode: "task" | "calendar" | "email" = "task";
  scriptedRouting: "normal" | "wrong-calendar-follow-up" = "normal";
  private sessionCreated = false;
  private readonly session: EngineSession = {
    id: "ceo:runtime-test",
    status: "active",
  };

  async createSession(input?: { sessionId?: string }): Promise<EngineSession> {
    this.session.id = input?.sessionId ?? this.session.id;
    this.sessionCreated = true;
    return this.session;
  }

  async sendMessage(input: EngineSendMessageInput): Promise<EngineMessageResult> {
    this.inputs.push(input);
    const isCalendarCreate = /\b(?:crea|cea)\b[\s\S]*\bevento\b/i.test(input.message) && !input.toolResult;
    const isCalendarRead = /\beventos?\b/i.test(input.message) && !isCalendarCreate && !input.toolResult;
    const isEmailReply = this.mode === "email" && /^(?:responde|respondele|resp[oó]ndele|contesta)/i.test(input.message.trim());
    const isEmailRead = this.mode === "email" && /\b(?:correo|correos|email|mail)\b/i.test(input.message) && !isEmailReply && !input.toolResult;
    const text = isCalendarRead
      ? `<departify_tool_call>${JSON.stringify({
          name: "departify.calendar.list",
          arguments: { range: "upcoming" },
        })}</departify_tool_call>`
      : this.scriptedRouting === "wrong-calendar-follow-up" && isCalendarCreate
        ? `<departify_tool_call>${JSON.stringify({
            name: "departify.tasks.create",
            arguments: { title: "Tarea incorrecta", summary: "No debe ejecutarse." },
          })}</departify_tool_call>`
      : isEmailRead
        ? `<departify_tool_call>${JSON.stringify({
            name: "departify.email.list",
            arguments: { limit: 3 },
          })}</departify_tool_call>`
        : isEmailReply
          ? `<departify_tool_call>${JSON.stringify({
              name: "departify.email.reply",
              arguments: { body: "mañana lo miro" },
            })}</departify_tool_call>`
          : input.toolResult
      ? this.mode === "calendar"
        ? "Evento preparado y bloqueado hasta la aprobación."
        : this.mode === "email"
          ? "Borrador de respuesta preparado; falta la aprobación explícita."
        : "He convertido el correo actual en una tarea durable."
      : this.mode === "calendar"
        ? `<departify_tool_call>${JSON.stringify({
            name: "departify.calendar.create",
            arguments: {
              title: "hola",
              start: new Date(Date.now() + 10 * 60_000).toISOString(),
              durationMinutes: 30,
            },
          })}</departify_tool_call>`
        : `<departify_tool_call>{"name":"departify.tasks.create","arguments":{"fromCurrentEmail":true,"title":"Revisar consulta de pricing"}}</departify_tool_call>`;
    return {
      sessionId: input.sessionId,
      messageId: `message-${this.inputs.length}`,
      text,
      status: "completed",
    };
  }

  async getSession(sessionId: string): Promise<EngineSession | null> {
    return this.sessionCreated && this.session.id === sessionId ? this.session : null;
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
    return { healthy: true, ready: true, provider: "fake" };
  }
}

describe("Engine 02 runtime business route", () => {
  let server: FastifyInstance;
  let inbox: InMemoryInboxStore;
  let workStore: InMemoryDepartmentWorkStore;
  let engine: FakeRuntimeEngine;

  beforeAll(async () => {
    const tenant = makeFakeTenant();
    inbox = new InMemoryInboxStore();
    workStore = new InMemoryDepartmentWorkStore();
    engine = new FakeRuntimeEngine();
    server = await buildServer(loadBackendConfig(), {
      auth: tenant,
      organizations: tenant,
      inbox,
      workStore,
      engine,
    });
  });

  afterEach(() => {
    resetCustomerZeroSessionsForTest();
    __resetWorkStoreForTests();
    engine.inputs.length = 0;
    engine.mode = "task";
    engine.scriptedRouting = "normal";
    installGoogleTokenStore(null);
  });

  function authedInject(options: InjectOptions) {
    return server.inject({
      ...options,
      headers: { ...AUTH, ...(options.headers ?? {}) },
    });
  }

  it("converts the current unified-inbox email into one durable idempotent task", async () => {
    const start = await authedInject({
      method: "POST",
      url: "/api/customer-zero/start",
      payload: {
        companyName: "Runtime Test",
        hasWebsite: false,
        description: "Servicio B2B para equipos comerciales.",
        goal: "Conseguir clientes",
      },
    });
    expect(start.statusCode).toBe(200);
    const organizationId = start.json().organizationId as string;

    const session = getOrCreateCustomerZeroSession(organizationId);
    session.state.lastEmailContext = {
      provider: "google",
      providerMessageId: "msg-current",
      subject: "Consulta de pricing",
      senderEmail: "cliente@acme.com",
    };
    const item = await inbox.upsert({
      organizationId,
      source: "gmail",
      sourceMessageId: "msg-current",
      channel: "email",
      category: "lead",
      subject: "Consulta de pricing",
      sender: { email: "cliente@acme.com", displayName: "Cliente" },
      recipients: [{ email: "ceo@departify.app" }],
      plainText: "Me interesa conocer el precio.",
      preview: "Me interesa conocer el precio.",
      receivedAt: new Date().toISOString(),
      unread: true,
      importance: 0.8,
      departmentId: "marketing",
      isLead: true,
      relatedWorkItemId: null,
      relatedConversationId: null,
      provenance: { provider: "gmail", rawEventId: "msg-current" },
      state: "classified",
    });

    const first = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/command-center/message`,
      payload: { message: "convierte este correo en tarea" },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().reply).toContain("tarea durable");
    expect(engine.inputs[0]?.runtimeContext).toContain("departify.tasks.create");
    expect(engine.inputs[0]?.runtimeContext).not.toMatch(/Bearer|Authorization|refresh_token|client_secret/i);

    const tasksAfterFirst = await workStore.listTasksForOrg(organizationId);
    expect(tasksAfterFirst).toHaveLength(1);
    expect(tasksAfterFirst[0]).toMatchObject({
      organizationId,
      title: "Revisar consulta de pricing",
      source: {
        type: "inbox_email",
        inboxItemId: item.id,
        provider: "gmail",
        providerMessageId: "msg-current",
      },
    });
    expect((await inbox.get(item.id))?.relatedWorkItemId).toBe(tasksAfterFirst[0]?.id);

    const second = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/command-center/message`,
      payload: { message: "convierte este correo en tarea" },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().reply).toContain("tarea durable");
    expect(await workStore.listTasksForOrg(organizationId)).toHaveLength(1);
  });

  it("never treats a model confirm flag as CEO approval for an external side effect", () => {
    expect(isRuntimeExplicitApproval("con alex@example.com", "calendar")).toBe(false);
    expect(isRuntimeExplicitApproval("hazlo", "calendar")).toBe(true);
    expect(isRuntimeExplicitApproval("responde al último correo", "email")).toBe(false);
    expect(isRuntimeExplicitApproval("sí, envíalo", "email")).toBe(true);
  });

  it("bridges an OpenClaw Calendar create selection into pending approval with the resolved relative time", async () => {
    const start = await authedInject({
      method: "POST",
      url: "/api/customer-zero/start",
      payload: {
        companyName: "Runtime Calendar Test",
        hasWebsite: false,
        description: "Servicio B2B para equipos comerciales.",
        goal: "Conseguir clientes",
      },
    });
    expect(start.statusCode).toBe(200);
    const organizationId = start.json().organizationId as string;
    installGoogleTokenStore(createInMemoryGoogleTokenStore());
    await getGoogleTokenStore().put({
      organizationId,
      userId: "user-a",
      provider: "gmail",
      accessToken: "access-calendar-runtime",
      refreshToken: "refresh-calendar-runtime",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      scopes: [
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/calendar.events",
      ],
      email: "ceo@departify.app",
      displayName: "CEO",
      operationalVerifiedAt: new Date().toISOString(),
      operationalProbeError: null,
      operationalCapabilities: ["calendar.read", "calendar.create"],
    });
    engine.mode = "calendar";
    const before = Date.now();
    const response = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/command-center/message`,
      payload: { message: "cea un evento en 10 mintos con hola" },
    });

    expect(response.statusCode).toBe(200);
    expect(engine.inputs[0]?.businessTools?.some((tool) => tool.name === "departify.calendar.create")).toBe(true);
    expect(engine.inputs[0]?.runtimeContext).toContain("calendar.create");
    const session = getOrCreateCustomerZeroSession(organizationId);
    expect(session.state.pendingCalendarWork).toMatchObject({
      summary: "hola",
      status: "awaiting_approval",
      timezone: "Europe/Madrid",
    });
    const startIso = session.state.pendingCalendarWork?.startIso;
    expect(startIso).toBeTruthy();
    expect(new Date(startIso!).getTime()).toBeGreaterThanOrEqual(before + 9 * 60_000);
    expect(new Date(startIso!).getTime()).toBeLessThanOrEqual(before + 11 * 60_000);
    expect(session.state.lastCalendarOperation).toBeUndefined();
  });

  it("reproduces the real HTTP two-turn Calendar flow with safe continuity tracing", async () => {
    const traceSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL) => {
      if (String(input).includes("calendar/v3")) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    try {
      const start = await authedInject({
        method: "POST",
        url: "/api/customer-zero/start",
        payload: {
          companyName: "Runtime Multi-turn Calendar Test",
          hasWebsite: false,
          description: "Servicio B2B para equipos comerciales.",
          goal: "Conseguir clientes",
        },
      });
      const organizationId = start.json().organizationId as string;
      installGoogleTokenStore(createInMemoryGoogleTokenStore());
      await getGoogleTokenStore().put({
        organizationId,
        userId: "user-a",
        provider: "gmail",
        accessToken: "access-calendar-multiturn",
        refreshToken: "refresh-calendar-multiturn",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        scopes: [
          "https://www.googleapis.com/auth/calendar.readonly",
          "https://www.googleapis.com/auth/calendar.events",
        ],
        email: "ceo@departify.app",
        displayName: "CEO",
        operationalVerifiedAt: new Date().toISOString(),
        operationalProbeError: null,
        operationalCapabilities: ["calendar.read", "calendar.create"],
      });
      engine.mode = "calendar";
      engine.scriptedRouting = "normal";

      const first = await authedInject({
        method: "POST",
        url: `/api/customer-zero/${organizationId}/command-center/message`,
        payload: { message: "y eventos?" },
      });
      const second = await authedInject({
        method: "POST",
        url: `/api/customer-zero/${organizationId}/command-center/message`,
        payload: { message: "crea un evento en 10 minutos con hola" },
      });

      expect(first.statusCode).toBe(200);
      expect(first.json().routing.intent).toBe("calendar_read");
      expect(second.statusCode).toBe(200);
      expect(second.json().routing.intent).toBe("calendar_create");
      expect(second.json().reply).toMatch(/preparado|aprobaci[oó]n/i);
      expect(second.json().reply).not.toMatch(/Elvira|Marketing/i);
      expect(engine.inputs[0]?.sessionId).toBe(engine.inputs[1]?.sessionId);
      expect(engine.inputs[1]?.businessTools?.some((tool) => tool.name === "departify.calendar.create")).toBe(true);
      expect(engine.inputs[1]?.runtimeContext).toContain("calendar.create");

      const session = getOrCreateCustomerZeroSession(organizationId);
      expect(session.state.pendingCalendarWork).toMatchObject({
        summary: "hola",
        status: "awaiting_approval",
      });

      const traces = traceSpy.mock.calls
        .filter(([event]) => event === "[ceo-turn-trace]")
        .map(([, payload]) => payload as Record<string, unknown>);
      expect(traces).toHaveLength(2);
      expect(traces[0]?.logicalSessionKey).toBe(traces[1]?.logicalSessionKey);
      expect(traces[0]?.engineSessionId).toBe(traces[1]?.engineSessionId);
      expect(traces[1]?.sessionFound).toBe(true);
      expect(traces[1]?.capabilityIds).toContain("calendar.create");
      expect(traces[1]?.toolNames).toContain("departify.calendar.create");
      expect(traces[1]?.selectedToolNames).toEqual(["departify.calendar.create"]);
      expect(traces[1]?.routingDecision).toBe("calendar_create");
      expect(traces[1]?.delegatedDepartment).toBe(null);
      expect(traces[1]?.pendingOperationType).toBe("calendar");
      expect(traces[1]?.turnNumber).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
      traceSpy.mockRestore();
    }
  });

  it("blocks a wrong OpenClaw family selection before it can create unrelated work", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL) => {
      if (String(input).includes("calendar/v3")) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    try {
      const start = await authedInject({
        method: "POST",
        url: "/api/customer-zero/start",
        payload: {
          companyName: "Runtime Wrong-family Test",
          hasWebsite: false,
          description: "Servicio B2B para equipos comerciales.",
          goal: "Conseguir clientes",
        },
      });
      const organizationId = start.json().organizationId as string;
      installGoogleTokenStore(createInMemoryGoogleTokenStore());
      await getGoogleTokenStore().put({
        organizationId,
        userId: "user-a",
        provider: "gmail",
        accessToken: "access-calendar-guard",
        refreshToken: "refresh-calendar-guard",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        scopes: [
          "https://www.googleapis.com/auth/calendar.readonly",
          "https://www.googleapis.com/auth/calendar.events",
        ],
        email: "ceo@departify.app",
        displayName: "CEO",
        operationalVerifiedAt: new Date().toISOString(),
        operationalProbeError: null,
        operationalCapabilities: ["calendar.read", "calendar.create"],
      });
      engine.mode = "calendar";
      engine.scriptedRouting = "wrong-calendar-follow-up";

      await authedInject({
        method: "POST",
        url: `/api/customer-zero/${organizationId}/command-center/message`,
        payload: { message: "y eventos?" },
      });
      const second = await authedInject({
        method: "POST",
        url: `/api/customer-zero/${organizationId}/command-center/message`,
        payload: { message: "crea un evento en 10 minutos con hola" },
      });

      expect(second.statusCode).toBe(200);
      expect(second.json().routing.intent).toBe("calendar_create");
      expect(second.json().reply).not.toMatch(/Elvira|Marketing/i);
      expect(await workStore.listTasksForOrg(organizationId)).toHaveLength(0);
      expect(getOrCreateCustomerZeroSession(organizationId).state.pendingCalendarWork).toMatchObject({
        summary: "hola",
        status: "awaiting_approval",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("keeps the latest email reference across two HTTP turns and stops at reply approval", async () => {
    const originalFetch = globalThis.fetch;
    const previousClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const previousClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    process.env.GOOGLE_OAUTH_CLIENT_ID = "client-runtime-email";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret-runtime-email";
    globalThis.fetch = (async (input: string | URL) => {
      const url = String(input);
      if (url.includes("gmail.googleapis.com/gmail/v1/users/me/messages") && url.includes("format=metadata")) {
        return new Response(JSON.stringify({
          id: "mail-latest",
          threadId: "thread-latest",
          snippet: "Lo reviso mañana.",
          labelIds: ["INBOX", "UNREAD"],
          payload: {
            headers: [
              { name: "Subject", value: "Consulta comercial" },
              { name: "From", value: "Cliente <cliente@acme.com>" },
              { name: "Date", value: "Wed, 12 Aug 2026 09:00:00 +0200" },
            ],
          },
        }), { status: 200 });
      }
      if (url.includes("gmail.googleapis.com/gmail/v1/users/me/messages")) {
        return new Response(JSON.stringify({ messages: [{ id: "mail-latest" }] }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    try {
      const start = await authedInject({
        method: "POST",
        url: "/api/customer-zero/start",
        payload: {
          companyName: "Runtime Multi-turn Email Test",
          hasWebsite: false,
          description: "Servicio B2B para equipos comerciales.",
          goal: "Conseguir clientes",
        },
      });
      const organizationId = start.json().organizationId as string;
      installGoogleTokenStore(createInMemoryGoogleTokenStore());
      await getGoogleTokenStore().put({
        organizationId,
        userId: "user-a",
        provider: "gmail",
        accessToken: "access-email-multiturn",
        refreshToken: "refresh-email-multiturn",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        scopes: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"],
        email: "ceo@departify.app",
        displayName: "CEO",
        operationalVerifiedAt: new Date().toISOString(),
        operationalProbeError: null,
        operationalCapabilities: ["email.read", "email.send"],
      });
      engine.mode = "email";

      const first = await authedInject({
        method: "POST",
        url: `/api/customer-zero/${organizationId}/command-center/message`,
        payload: { message: "¿qué correos tengo hoy?" },
      });
      const second = await authedInject({
        method: "POST",
        url: `/api/customer-zero/${organizationId}/command-center/message`,
        payload: { message: "respóndele al último que mañana lo miro" },
      });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(engine.inputs[0]?.sessionId).toBe(engine.inputs[1]?.sessionId);
      expect(engine.inputs[0]?.businessTools?.some((tool) => tool.name === "departify.email.list")).toBe(true);
      expect(engine.inputs[1]?.businessTools?.some((tool) => tool.name === "departify.email.reply")).toBe(true);
      // Each runtime tool call produces the initial engine request plus the
      // tool-result continuation; two HTTP turns therefore yield four
      // adapter inputs while preserving one engine session.
      expect(engine.inputs).toHaveLength(4);
      expect(engine.inputs[0]?.sessionId).toBe(engine.inputs[2]?.sessionId);
      expect(engine.inputs[2]?.businessTools?.some((tool) => tool.name === "departify.email.reply")).toBe(true);
      expect(second.json().reply).toMatch(/aprobaci[oó]n|borrador/i);
      expect(second.json().reply).not.toMatch(/Elvira|Marketing/i);
      expect(getOrCreateCustomerZeroSession(organizationId).state.lastEmailContext).toMatchObject({
        providerMessageId: "mail-latest",
        senderEmail: "cliente@acme.com",
      });
      expect(getOrCreateCustomerZeroSession(organizationId).state.pendingEmailWork).toMatchObject({
        status: "awaiting_approval",
        recipient: "cliente@acme.com",
        objective: "mañana lo miro",
      });
    } finally {
      globalThis.fetch = originalFetch;
      if (previousClientId === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID;
      else process.env.GOOGLE_OAUTH_CLIENT_ID = previousClientId;
      if (previousClientSecret === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
      else process.env.GOOGLE_OAUTH_CLIENT_SECRET = previousClientSecret;
    }
  });

  it("keeps a Marketing status question local and delegates only the new business objective", async () => {
    const start = await authedInject({
      method: "POST",
      url: "/api/customer-zero/start",
      payload: {
        companyName: "Runtime Business Routing Test",
        hasWebsite: false,
        description: "Servicio B2B para equipos comerciales.",
        goal: "Conseguir clientes",
      },
    });
    const organizationId = start.json().organizationId as string;

    const status = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/command-center/message`,
      payload: { message: "¿qué está haciendo Marketing ahora?" },
    });
    const objective = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${organizationId}/command-center/message`,
      payload: { message: "quiero conseguir más clientes este mes" },
    });

    expect(status.statusCode).toBe(200);
    expect(status.json().routing.intent).toBe("department_request");
    expect(status.json().routing.departments).toEqual(["marketing"]);
    expect(objective.statusCode).toBe(200);
    expect(objective.json().routing.intent).toBe("delegate_marketing");
    expect(objective.json().routing.departments).toEqual(["marketing"]);
    expect(objective.json().reply).not.toMatch(/calendar|drive|correo/i);
  });
});
