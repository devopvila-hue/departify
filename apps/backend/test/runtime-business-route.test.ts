import { afterEach, beforeAll, describe, expect, it } from "vitest";
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
  mode: "task" | "calendar" = "task";
  private readonly session: EngineSession = {
    id: "ceo:runtime-test",
    status: "active",
  };

  async createSession(input?: { sessionId?: string }): Promise<EngineSession> {
    this.session.id = input?.sessionId ?? this.session.id;
    return this.session;
  }

  async sendMessage(input: EngineSendMessageInput): Promise<EngineMessageResult> {
    this.inputs.push(input);
    const text = input.toolResult
      ? this.mode === "calendar"
        ? "Evento preparado y bloqueado hasta la aprobación."
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
});
