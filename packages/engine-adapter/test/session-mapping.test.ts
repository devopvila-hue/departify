import { describe, expect, it, vi } from "vitest";
import {
  OpenClawEngineAdapter,
  sessionKey,
  isLoopbackUrl,
} from "../src/openclaw/openclaw-adapter.js";

describe("session mapping", () => {
  it("derives the OpenClaw session key from a Departify id", () => {
    expect(sessionKey("abc-123")).toBe("departify:abc-123");
  });

  it("is deterministic (same input, same key)", () => {
    expect(sessionKey("x")).toBe(sessionKey("x"));
  });

  it("keeps the Departify id distinct from the gateway key", () => {
    // The engine key is internal; the Departify id is what callers see.
    expect(sessionKey("abc-123")).not.toBe("abc-123");
  });

  it("maps internal workforce sessions to their native OpenClaw agent", () => {
    expect(sessionKey("employee:org:user:agent_content_strategist", "agent_content_strategist"))
      .toBe("agent:agent_content_strategist:departify:employee:org:user:agent_content_strategist");
  });

  it("does not call the removed native-tools session-policy RPC", async () => {
    const adapter = new OpenClawEngineAdapter({
      provider: "openclaw",
      gatewayUrl: "ws://127.0.0.1:18889",
      gatewayToken: "test-token",
      requestTimeoutMs: 1000,
      connectTimeoutMs: 1000,
      retryLimit: 0,
      maxRetryDelayMs: 0,
    });
    const client = (adapter as unknown as {
      client: { request: (method: string, params: unknown) => Promise<unknown> };
    }).client;
    const request = vi.spyOn(client, "request").mockResolvedValue({});

    await adapter.setNativeToolPolicy?.({
      sessionId: "ceo:org-a:user-a",
      toolNames: ["departify.company.context"],
    });

    expect(request).not.toHaveBeenCalled();
  });

  it("preserves a durable final assistant message after a non-ok OpenClaw run", async () => {
    const adapter = new OpenClawEngineAdapter({
      provider: "openclaw",
      gatewayUrl: "ws://127.0.0.1:18889",
      gatewayToken: "test-token",
      requestTimeoutMs: 1000,
      connectTimeoutMs: 1000,
      retryLimit: 0,
      maxRetryDelayMs: 0,
    });
    const client = (adapter as unknown as {
      client: {
        runAndReadResult: (params: unknown, timeoutMs: number, timeline?: (stage: string, metadata?: Record<string, unknown>) => void) => Promise<unknown>;
      };
    }).client;
    vi.spyOn(client, "runAndReadResult").mockResolvedValue({
      runStatus: "error",
      lastAssistant: {
        text: "La respuesta final ya estaba disponible.",
      },
    });
    const stages: string[] = [];

    const result = await adapter.sendMessage({
      sessionId: "ceo:org-a:user-a",
      message: "continúa",
      timeline: (stage) => stages.push(stage),
    });

    expect(result).toMatchObject({
      status: "completed",
      text: "La respuesta final ya estaba disponible.",
      postGenerationFailure: true,
    });
    expect(stages).toContain("T12_adapter_received_final");
  });
});

describe("isLoopbackUrl", () => {
  it("recognizes loopback hosts", () => {
    expect(isLoopbackUrl("ws://127.0.0.1:18889")).toBe(true);
    expect(isLoopbackUrl("ws://localhost:18889")).toBe(true);
  });

  it("rejects non-loopback hosts (Railway private hostname)", () => {
    expect(isLoopbackUrl("ws://departify-engine.railway.internal:18889")).toBe(false);
    expect(isLoopbackUrl("ws://10.0.0.5:18889")).toBe(false);
  });
});
