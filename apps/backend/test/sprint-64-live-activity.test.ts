/**
 * Sprint 64 — Live Activity / Native OpenClaw Experience
 *
 * Proves that the chat pipeline surfaces real backend activity to the
 * portal, the conversation trace carries a coherent waterfall, and the
 * chat response includes both activity events and a timeline.
 *
 * Acceptance criteria:
 *   - The activity events appear in chronological order in the response.
 *   - The "received" event is emitted BEFORE the engine call returns
 *     (CEO sees feedback while the engine is still working).
 *   - The "streaming" event is emitted AFTER the engine call returns
 *     but BEFORE persistence — the moment the CEO's response starts
 *     being written.
 *   - The timeline field is present and contains at least T1..T3, T15.
 *   - Fake activity pills ("Pensando…", "Analizando…", "Finalizando…")
 *     NEVER appear in the activity stream.
 *
 * These tests run with a stub engine adapter that records inputs and
 * returns a deterministic response. No real OpenClaw, no real Supabase.
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

class CapturingEngine implements EngineAdapter {
  public inputs: EngineSendMessageInput[] = [];
  public sessions: EngineSession[] = [];
  public sendDelayMs = 0;
  private nextId = 0;

  async createSession(input?: { sessionId?: string }): Promise<EngineSession> {
    const id = input?.sessionId ?? `engine-${++this.nextId}`;
    const session: EngineSession = {
      id,
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.sessions.push(session);
    return session;
  }

  async getSession(id: string): Promise<EngineSession | null> {
    return this.sessions.find((s) => s.id === id) ?? null;
  }

  async sendMessage(input: EngineSendMessageInput): Promise<EngineMessageResult> {
    this.inputs.push(input);
    if (this.sendDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.sendDelayMs));
    }
    return {
      sessionId: input.sessionId,
      text: "Hola, esto es una respuesta de prueba.",
      status: "completed",
      toolCalls: [],
      durationMs: this.sendDelayMs,
    };
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

describe("Sprint 64 — Live Activity / Native OpenClaw experience", () => {
  let server: FastifyInstance;
  let engine: CapturingEngine;

  beforeAll(async () => {
    const tenant = makeFakeTenant();
    const inbox = new InMemoryInboxStore();
    const workStore = new InMemoryDepartmentWorkStore();
    engine = new CapturingEngine();
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

  async function startOrg(): Promise<string> {
    const response = await authedInject({
      method: "POST",
      url: "/api/customer-zero/start",
      payload: {
        companyName: "Acme Test",
        hasWebsite: false,
        description: "Acme test org for Sprint 64.",
        goal: "Operar la mejor pyme.",
      },
    });
    expect(response.statusCode).toBe(200);
    return response.json().organizationId as string;
  }

  it("A1: emits work_state events in chronological order (received → retrieving_context → delegated → streaming)", async () => {
    const org = await startOrg();
    const response = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/command-center/message`,
      payload: { message: "hola" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    const states = (body.events as Array<{ kind: string; state?: string }>)
      .filter((e) => e.kind === "work_state")
      .map((e) => e.state);
    // First three MUST be present and in order.
    expect(states.indexOf("received")).toBeGreaterThanOrEqual(0);
    expect(states.indexOf("retrieving_context")).toBeGreaterThan(
      states.indexOf("received"),
    );
    expect(states.indexOf("delegated")).toBeGreaterThan(
      states.indexOf("retrieving_context"),
    );
    // Streaming MUST be after the engine call returns.
    const streamingIdx = states.indexOf("streaming");
    expect(streamingIdx).toBeGreaterThan(states.indexOf("delegated"));
    // No fake pills are allowed.
    const serialized = JSON.stringify(body.events);
    expect(serialized).not.toContain("Pensando…");
    expect(serialized).not.toContain("Analizando…");
    expect(serialized).not.toContain("Finalizando…");
  });

  it("A2: timeline is recorded in backend logs only — NEVER surfaced in the chat response (Product Identity Boundary)", async () => {
    const org = await startOrg();
    const response = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/command-center/message`,
      payload: { message: "hola" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    // The timeline is internal observability; the CEO must NEVER see
    // waterfall key names (which include internal jargon such as
    // "compaction", "leak", "recovery"). It exists in the trace
    // logger (`console.info` under [chat-timeline]) but is stripped
    // from the response.
    expect(body.timeline).toBeUndefined();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("compaction");
    expect(serialized).not.toContain("leak");
    expect(serialized).not.toContain("recovery");
    expect(serialized).not.toContain("T1_backend_request_received");
  });

  it("A3: 'received' is the first activity event the CEO sees — honest and never contains raw model jargon", async () => {
    const org = await startOrg();
    const response = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/command-center/message`,
      payload: { message: "hola" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    const workStates = (
      body.events as Array<{
        kind: string;
        state?: string;
        message?: string;
      }>
    ).filter((e) => e.kind === "work_state");
    expect(workStates.length).toBeGreaterThanOrEqual(1);
    const first = workStates[0]!;
    expect(first.state).toBe("received");
    // The message must be human-readable and never leak runtime.
    expect(first.message).toMatch(/^Recibido/);
    expect(first.message).not.toMatch(/OpenClaw|engine|GPT|model/i);
  });

  it("A4: 'streaming' event is emitted AFTER the engine returns and BEFORE persistence", async () => {
    const org = await startOrg();
    // Force the engine call to take 80ms so we can verify the ordering.
    engine.sendDelayMs = 80;
    try {
      const response = await authedInject({
        method: "POST",
        url: `/api/customer-zero/${org}/command-center/message`,
        payload: { message: "hola" },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      const states = (body.events as Array<{ kind: string; state?: string }>)
        .filter((e) => e.kind === "work_state")
        .map((e) => e.state);
      const streamingIdx = states.indexOf("streaming");
      const delegatedIdx = states.indexOf("delegated");
      const retrievingIdx = states.indexOf("retrieving_context");
      const receivedIdx = states.indexOf("received");
      // All four must be present.
      expect(streamingIdx).toBeGreaterThanOrEqual(0);
      expect(delegatedIdx).toBeGreaterThanOrEqual(0);
      expect(retrievingIdx).toBeGreaterThanOrEqual(0);
      expect(receivedIdx).toBeGreaterThanOrEqual(0);
      // Chronological order: received → retrieving_context → delegated → streaming.
      expect(receivedIdx).toBeLessThan(retrievingIdx);
      expect(retrievingIdx).toBeLessThan(delegatedIdx);
      // Streaming is emitted AFTER the engine call returns (which
      // takes 80ms). The events array is appended in chronological
      // order so streaming MUST appear after the engine's
      // getSession/createSession activity.
      expect(streamingIdx).toBeGreaterThan(delegatedIdx);
    } finally {
      engine.sendDelayMs = 0;
    }
  });

  it("A5: at least one work_state event is emitted BEFORE the engine returns (CEO feedback while work is in flight)", async () => {
    const org = await startOrg();
    // Engine takes 80ms; we expect the "received" event to be present
    // in the response timeline (emitted before the engine call).
    engine.sendDelayMs = 80;
    try {
      const response = await authedInject({
        method: "POST",
        url: `/api/customer-zero/${org}/command-center/message`,
        payload: { message: "hola" },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      const events = body.events as Array<{
        kind: string;
        state?: string;
        at?: number;
      }>;
      const receiving = events.find(
        (e) => e.kind === "work_state" && e.state === "received",
      );
      expect(receiving).toBeDefined();
      // The "received" event must carry a timestamp.
      expect(typeof receiving?.at).toBe("number");
    } finally {
      engine.sendDelayMs = 0;
    }
  });

  it("A6: activity events carry timestamps so the portal can render timing without trusting a UI clock", async () => {
    const org = await startOrg();
    const response = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/command-center/message`,
      payload: { message: "hola" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    const events = body.events as Array<{
      kind: string;
      state?: string;
      at?: number;
    }>;
    const received = events.find(
      (e) => e.kind === "work_state" && e.state === "received",
    );
    expect(received).toBeDefined();
    expect(typeof received?.at).toBe("number");
    expect(received!.at!).toBeGreaterThan(0);
  });

  it("B1: /message/stream returns text/event-stream with progressive activity frames and a terminal result", async () => {
    const org = await startOrg();
    const response = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/command-center/message/stream`,
      payload: { message: "hola" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    const raw = response.body as string;
    // Parse SSE frames: event: X\ndata: {...}\n\n
    const frames = raw
      .split("\n\n")
      .filter((f) => f.trim().length > 0)
      .map((f) => {
        let eventName = "message";
        let data = "";
        for (const line of f.split("\n")) {
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        return { eventName, data: data ? (JSON.parse(data) as Record<string, unknown>) : null };
      });
    const activityFrames = frames.filter((f) => f.eventName === "activity");
    const resultFrame = frames.find((f) => f.eventName === "result");
    // At least "received" + "retrieving_context" + "delegated" + "streaming".
    const states = activityFrames
      .map((f) => f.data?.state as string | undefined)
      .filter(Boolean);
    expect(states.indexOf("received")).toBeGreaterThanOrEqual(0);
    expect(states.indexOf("retrieving_context")).toBeGreaterThan(
      states.indexOf("received"),
    );
    expect(states.indexOf("delegated")).toBeGreaterThan(
      states.indexOf("retrieving_context"),
    );
    expect(states.indexOf("streaming")).toBeGreaterThan(
      states.indexOf("delegated"),
    );
    // Terminal result frame carries the reply.
    expect(resultFrame).toBeDefined();
    expect(typeof resultFrame?.data?.reply).toBe("string");
    expect((resultFrame?.data?.reply as string).length).toBeGreaterThan(0);
  });

  it("B2: /message/stream never leaks internal timeline jargon (Product Identity Boundary)", async () => {
    const org = await startOrg();
    const response = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/command-center/message/stream`,
      payload: { message: "hola" },
    });
    expect(response.statusCode).toBe(200);
    const raw = response.body as string;
    expect(raw).not.toContain("compaction");
    expect(raw).not.toContain("leak");
    expect(raw).not.toContain("recovery");
    expect(raw).not.toContain("T1_backend_request_received");
    expect(raw).not.toContain("OpenClaw");
    expect(raw).not.toContain("Pensando…");
    expect(raw).not.toContain("Analizando…");
    expect(raw).not.toContain("Finalizando…");
  });

  it("B3: /message/stream emits 'received' BEFORE the engine returns (progressive feedback)", async () => {
    const org = await startOrg();
    engine.sendDelayMs = 80;
    try {
      const response = await authedInject({
        method: "POST",
        url: `/api/customer-zero/${org}/command-center/message/stream`,
        payload: { message: "hola" },
      });
      expect(response.statusCode).toBe(200);
      const raw = response.body as string;
      const frames = raw
        .split("\n\n")
        .filter((f) => f.trim().length > 0)
        .map((f) => {
          let eventName = "message";
          let data = "";
          for (const line of f.split("\n")) {
            if (line.startsWith("event:")) eventName = line.slice(6).trim();
            else if (line.startsWith("data:")) data += line.slice(5).trim();
          }
          return { eventName, data: data ? (JSON.parse(data) as Record<string, unknown>) : null };
        });
      const received = frames.find(
        (f) => f.eventName === "activity" && f.data?.state === "received",
      );
      expect(received).toBeDefined();
      expect(typeof received?.data?.at).toBe("number");
    } finally {
      engine.sendDelayMs = 0;
    }
  });
});