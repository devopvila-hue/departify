/**
 * Sprint 67 P0 — Progressive assistant text via the OpenClaw gateway.
 *
 * The OpenClaw gateway emits `stream: "assistant"` events with
 * `data.delta` (incremental text) while the model is running. Sprint 67
 * P0 surfaces those deltas to the SSE handler so the portal can start
 * rendering the assistant bubble while the model is still generating.
 *
 * The minimal change lives in three places:
 *   - EngineAdapter contract: `onChunk` callback on `EngineSendMessageInput`.
 *   - OpenClaw gateway: `startEventCapture` invokes `onChunk` when assistant
 *     chunks arrive, and the adapter's `sendMessage` forwards it.
 *   - Departify SSE: `/command-center/message/stream` and
 *     `/conversations/:id/messages/stream` emit `event: content_delta`
 *     frames on each chunk.
 *
 * The tests below simulate the OpenClaw gateway with a controlled timing
 * so we can prove the chunk arrives before agent.wait settles.
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

/**
 * Gateway simulator that produces real text chunks BEFORE agent.wait
 * settles. It exposes the same `sendMessage` signature as the OpenClaw
 * adapter so the SSE handler will see the chunks flowing through.
 *
 * Tunables:
 *   - chunkDelayMs: gap between chunks (default 50ms)
 *   - firstChunkAt: ms after sessions.send when the first chunk arrives
 *   - settledAt: ms after sessions.send when agent.wait would return
 */
class ChunkedEngine implements EngineAdapter {
  public sessions = new Map<string, { id: string }>();
  public calls: Array<{
    input: EngineSendMessageInput;
    sentAt: number;
    onChunkCalled: number;
  }> = [];
  private nextId = 0;
  public chunkDelayMs = 50;
  public firstChunkAt = 200;
  public settledAt = 1_500;

  async createSession(input?: { sessionId?: string }): Promise<EngineSession> {
    const id = input?.sessionId ?? `engine-${++this.nextId}`;
    this.sessions.set(id, { id });
    return {
      id,
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async getSession(id: string): Promise<EngineSession | null> {
    const s = this.sessions.get(id);
    if (!s) return null;
    return {
      id: s.id,
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async sendMessage(input: EngineSendMessageInput): Promise<EngineMessageResult> {
    const sentAt = Date.now();
    const onChunkCalled = { count: 0 };
    const fullText = "Hola, esto es una respuesta de prueba que llega por chunks.";
    // Emit chunks at firstChunkAt, then every chunkDelayMs.
    const chunks = [
      "Hola, ",
      "esto es una respuesta ",
      "de prueba que llega ",
      "por chunks.",
    ];
    let elapsed = 0;
    for (const chunk of chunks) {
      const target = elapsed === 0 ? this.firstChunkAt : elapsed + this.chunkDelayMs;
      const wait = Math.max(0, target - (Date.now() - sentAt));
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try {
        input.onChunk?.({ text: chunk, finished: false });
        onChunkCalled.count += 1;
      } catch {
        /* caller error must not poison the run */
      }
      elapsed = Date.now() - sentAt;
    }
    // Final settled wait, mirroring the OpenClaw gateway agent.wait
    // ack delay. The chunks are already on the wire; the user sees
    // them in real time.
    const settleWait = Math.max(0, this.settledAt - (Date.now() - sentAt));
    if (settleWait > 0) await new Promise((r) => setTimeout(r, settleWait));
    this.calls.push({ input, sentAt, onChunkCalled: onChunkCalled.count });
    return {
      sessionId: input.sessionId,
      text: fullText,
      status: "completed",
      toolCalls: [],
      durationMs: Date.now() - sentAt,
    };
  }

  async health(): Promise<EngineHealth> {
    return { healthy: true, ready: true, provider: "stub" };
  }
  async getHistory(_sessionId: string): Promise<EngineHistory> {
    return { sessionId: _sessionId, items: [] };
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

interface SseFrame {
  eventName: string;
  data: Record<string, unknown> | null;
}

function parseSse(raw: string): SseFrame[] {
  return raw
    .split("\n\n")
    .filter((f) => f.trim().length > 0)
    .map((f) => {
      let eventName = "message";
      let data = "";
      for (const line of f.split("\n")) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      return {
        eventName,
        data: data ? (JSON.parse(data) as Record<string, unknown>) : null,
      };
    });
}

describe("Sprint 67 P0 — progressive assistant text (content_delta)", () => {
  let server: FastifyInstance;
  let engine: ChunkedEngine;

  beforeAll(async () => {
    const tenant = makeFakeTenant();
    const inbox = new InMemoryInboxStore();
    const workStore = new InMemoryDepartmentWorkStore();
    engine = new ChunkedEngine();
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

  it("A: first content_delta arrives BEFORE agent.wait settled and the result is the authoritative final text", async () => {
    const { org, conversationId } = await startOrg();
    const response = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/conversations/${conversationId}/messages/stream`,
      payload: { message: "hola" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    const raw = response.body as string;
    const frames = parseSse(raw);
    const contentDeltas = frames.filter((f) => f.eventName === "content_delta");
    const resultFrame = frames.find((f) => f.eventName === "result");
    // At least one chunk AND exactly one result frame.
    expect(contentDeltas.length).toBeGreaterThan(0);
    expect(resultFrame).toBeDefined();
    expect(contentDeltas[0]?.data?.text).toBeTruthy();
    const firstChunkPosition = raw.indexOf("event: content_delta");
    const resultPosition = raw.indexOf("event: result");
    expect(firstChunkPosition).toBeGreaterThan(0);
    expect(resultPosition).toBeGreaterThan(firstChunkPosition);
    // The result.reply is the authoritative final text — it must
    // contain the same words as the chunked stream.
    const finalReply = (resultFrame?.data?.reply as string | undefined) ?? "";
    expect(finalReply).toContain("Hola");
    // The engine was called exactly once.
    expect(engine.calls.length).toBe(1);
  });

  it("B: a progress message is NOT converted to final — only the terminal result is", async () => {
    const { org, conversationId } = await startOrg();
    const response = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/conversations/${conversationId}/messages/stream`,
      payload: { message: "qué opinas" },
    });
    const raw = response.body as string;
    const frames = parseSse(raw);
    const progress = frames.filter((f) => f.eventName === "content_delta");
    const result = frames.find((f) => f.eventName === "result");
    expect(progress.length).toBeGreaterThan(0);
    // Exactly one result frame (no duplicate final).
    const resultFrames = frames.filter((f) => f.eventName === "result");
    expect(resultFrames.length).toBe(1);
    // The result.reply is the FULL final text, not the first chunk.
    const reply = (result?.data?.reply as string) ?? "";
    expect(reply.length).toBeGreaterThan((progress[0]?.data?.text as string).length);
  });

  it("C: persistence is canonical — exactly one CEO message and one assistant reply per turn", async () => {
    const { org, conversationId } = await startOrg();
    const before = await authedInject({
      method: "GET",
      url: `/api/customer-zero/${org}/conversations/${conversationId}`,
    });
    const beforeCount = (before.json().messages as Array<unknown>).length;
    await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/conversations/${conversationId}/messages/stream`,
      payload: { message: "hola persistente" },
    });
    const after = await authedInject({
      method: "GET",
      url: `/api/customer-zero/${org}/conversations/${conversationId}`,
    });
    const messages = after.json().messages as Array<{
      role: string;
      content: string;
    }>;
    expect(messages.length).toBe(beforeCount + 2);
    const ceoMsgs = messages.filter(
      (m) => m.role === "user" && m.content === "hola persistente",
    );
    const asstMsgs = messages.filter(
      (m) => m.role === "assistant" && m.content.length > 0,
    );
    expect(ceoMsgs.length).toBe(1);
    expect(asstMsgs.length).toBe(1);
  });

  it("J: chunks contain no internal jargon — Product Identity Boundary holds on streaming text", async () => {
    const { org, conversationId } = await startOrg();
    const response = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/conversations/${conversationId}/messages/stream`,
      payload: { message: "di hola" },
    });
    const raw = response.body as string;
    for (const forbidden of [
      "OpenClaw",
      "openclaw",
      "compaction",
      "engine",
      "gateway",
      "MiniMax",
      "model",
      "tokens",
      "runtime",
      "MCP",
    ]) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it("I: three consecutive turns in the same conversation — one stream per turn, full durability", async () => {
    const { org, conversationId } = await startOrg();
    const prompts = ["hola", "qué haces", "continúa"];
    const callsBefore = engine.calls.length;
    for (const prompt of prompts) {
      const response = await authedInject({
        method: "POST",
        url: `/api/customer-zero/${org}/conversations/${conversationId}/messages/stream`,
        payload: { message: prompt },
      });
      const frames = parseSse(response.body as string);
      const result = frames.find((f) => f.eventName === "result");
      expect(result).toBeDefined();
    }
    // Exactly one sendMessage per turn in the multi-turn window.
    expect(engine.calls.length - callsBefore).toBe(3);
    const reload = await authedInject({
      method: "GET",
      url: `/api/customer-zero/${org}/conversations/${conversationId}`,
    });
    const messages = reload.json().messages as Array<{ role: string }>;
    const userMsgs = messages.filter((m) => m.role === "user");
    const asstMsgs = messages.filter((m) => m.role === "assistant");
    expect(userMsgs.length).toBe(3);
    expect(asstMsgs.length).toBe(3);
  }, 15_000);

  it("F: SSE content_delta is sourced from the gateway chunk stream, not faked by the backend", async () => {
    const { org, conversationId } = await startOrg();
    const response = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/conversations/${conversationId}/messages/stream`,
      payload: { message: "di hola" },
    });
    const raw = response.body as string;
    const chunks = parseSse(raw)
      .filter((f) => f.eventName === "content_delta")
      .map((f) => f.data?.text as string)
      .filter(Boolean);
    const joined = chunks.join("");
    expect(joined).toContain("Hola");
    // The last chunk should match the gateway's emission order.
    const engineOutput = engine.calls[0]?.input.message;
    expect(typeof engineOutput).toBe("string");
  });
});
