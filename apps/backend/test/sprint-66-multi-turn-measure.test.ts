/**
 * Sprint 66 P0 — Multi-turn measurement harness.
 * Runs 3 consecutive turns in the same conversation and prints the
 * waterfall per turn. Internal-only; never reaches the portal.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import type { InjectOptions } from "light-my-request";
import { makeFakeTenant } from "./helpers/fake-tenant.js";
import { InMemoryInboxStore } from "../src/customer-zero/inbox-domain.js";
import { InMemoryDepartmentWorkStore } from "../src/customer-zero/department-work.js";
import { resetCustomerZeroSessionsForTest } from "../src/customer-zero/customer-zero-session.js";
import {
  createInMemoryGoogleTokenStore,
  installGoogleTokenStore,
} from "../src/customer-zero/google-tokens.js";

class StubEngine implements EngineAdapter {
  public calls: Array<{ input: EngineSendMessageInput; elapsedMs: number }> = [];
  public sessionCreates: string[] = [];
  public sessionGets: string[] = [];
  public policySets: string[] = [];
  private sessions = new Map<string, EngineSession>();
  private nextId = 0;

  async createSession(input?: { sessionId?: string }): Promise<EngineSession> {
    const id = input?.sessionId ?? `engine-${++this.nextId}`;
    this.sessionCreates.push(id);
    const session: EngineSession = {
      id,
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.sessions.set(id, session);
    return session;
  }

  async getSession(id: string): Promise<EngineSession | null> {
    this.sessionGets.push(id);
    return this.sessions.get(id) ?? null;
  }

  async sendMessage(input: EngineSendMessageInput): Promise<EngineMessageResult> {
    const start = Date.now();
    // Simulate OpenClaw direct call latency (chat-only path).
    await new Promise((resolve) => setTimeout(resolve, 80));
    const elapsedMs = Date.now() - start;
    this.calls.push({ input, elapsedMs });
    return {
      sessionId: input.sessionId,
      text: "Hola, esto es una respuesta de prueba.",
      status: "completed",
      toolCalls: [],
      durationMs: elapsedMs,
    };
  }

  async setNativeToolPolicy(input: {
    sessionId: string;
    toolNames: string[];
  }): Promise<void> {
    this.policySets.push(input.sessionId);
  }

  async health(): Promise<EngineHealth> {
    return { healthy: true, ready: true, provider: "stub" };
  }

  async getHistory(sessionId: string): Promise<EngineHistory> {
    return { sessionId, items: [] };
  }

  async closeSession(_sessionId: string): Promise<void> {
    return;
  }

  async getUsage(_sessionId: string): Promise<EngineUsage> {
    return {};
  }

  async getToolState(_sessionId: string): Promise<EngineToolState> {
    return { available: [], denied: [] };
  }
}

const AUTH = { authorization: "Bearer token-a" };

describe("Sprint 66 P0 — multi-turn measurement", () => {
  let server: FastifyInstance;
  let engine: StubEngine;

  beforeAll(async () => {
    const tenant = makeFakeTenant();
    const inbox = new InMemoryInboxStore();
    const workStore = new InMemoryDepartmentWorkStore();
    engine = new StubEngine();
    installGoogleTokenStore(createInMemoryGoogleTokenStore());
    server = await buildServer(loadBackendConfig(), {
      auth: tenant,
      organizations: tenant,
      inbox,
      workStore,
      engine,
      engineRuntimePolicy: "strict",
      nativeBusinessTools: true,
    });
  });

  afterAll(async () => {
    resetCustomerZeroSessionsForTest();
    installGoogleTokenStore(null);
    await server.close();
  });

  function authedInject(options: InjectOptions) {
    return server.inject({
      ...options,
      headers: { ...AUTH, ...(options.headers ?? {}) },
    });
  }

  async function startOrg(): Promise<{ org: string; conversationId: string }> {
    const start = await authedInject({
      method: "POST",
      url: "/api/customer-zero/start",
      payload: {
        companyName: "Acme Test",
        hasWebsite: false,
        description: "Acme test org.",
        goal: "Operar la mejor pyme.",
      },
    });
    expect(start.statusCode).toBe(200);
    const org = start.json().organizationId as string;
    const convo = await authedInject({
      method: "GET",
      url: `/api/customer-zero/${org}/conversations`,
    });
    const conversationId = convo.json().conversations[0].id as string;
    return { org, conversationId };
  }

  it("TT-1: 3-turn waterfall — measure per-turn engine call count, session lookup, policy set", async () => {
    const { org, conversationId } = await startOrg();
    const messages = ["hola", "qué puedes hacer por mi empresa", "continúa"];
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const start = Date.now();
      const response = await authedInject({
        method: "POST",
        url: `/api/customer-zero/${org}/conversations/${conversationId}/messages/stream`,
        payload: { message },
      });
      const elapsedMs = Date.now() - start;
      const body = response.body as string;
      const frames = body
        .split("\n\n")
        .filter((f) => f.trim().length > 0)
        .map((f) => {
          let eventName = "message";
          let data = "";
          for (const line of f.split("\n")) {
            if (line.startsWith("event:")) eventName = line.slice(6).trim();
            else if (line.startsWith("data:")) data += line.slice(5).trim();
          }
          return { eventName, data: data ? JSON.parse(data) : null };
        });
      const activityStates = frames
        .filter((f) => f.eventName === "activity")
        .map((f) => f.data?.state as string);
      const resultFrame = frames.find((f) => f.eventName === "result");
      const errorFrame = frames.find((f) => f.eventName === "error");
      const resultText = resultFrame?.data?.reply as string | undefined;
      console.info(
        `[TT-1 turn ${i + 1}] elapsed=${elapsedMs}ms frames=${frames.length} states=${activityStates.join(",")} result=${resultText ? "OK" : errorFrame ? `ERROR ${(errorFrame.data as { message?: string })?.message}` : "MISSING"}`,
      );
    }
    console.info(`[TT-1 engine] sessionCreates=${engine.sessionCreates.length} sessionGets=${engine.sessionGets.length} policySets=${engine.policySets.length} sendMessageCalls=${engine.calls.length}`);
    console.info(`[TT-1 sessionCreates] ${engine.sessionCreates.join(",")}`);
    console.info(`[TT-1 sessionGets] ${engine.sessionGets.join(",")}`);
    expect(engine.calls.length).toBe(3);
  });
});
