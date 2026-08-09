import { describe, expect, it, vi } from "vitest";
import { OpenClawGatewayClient } from "../src/openclaw/gateway-client.js";
import {
  EngineRateLimitError,
  EngineTimeoutError,
  EngineUnavailableError,
} from "../src/errors.js";

/**
 * Unit tests for retry classification. We stub the transport primitives on a
 * real OpenClawGatewayClient so the retry loop is exercised without a socket.
 * The real gateway behaviour is covered by the integration suite.
 */

function buildClient(overrides: Record<string, unknown> = {}) {
  return new OpenClawGatewayClient({
    url: "ws://127.0.0.1:18889",
    token: "t",
    connectTimeoutMs: 1000,
    requestTimeoutMs: 1000,
    retryLimit: 2,
    maxRetryDelayMs: 10,
    ...overrides,
  });
}

describe("request() retry loop", () => {
  it("retries EngineUnavailableError and succeeds on the retry", async () => {
    const client = buildClient();
    // Simulate a connected client whose first call fails with unavailable,
    // then a reconnect + success.
    let calls = 0;
    vi.spyOn(client as unknown as { ensureConnected: () => Promise<void> }, "ensureConnected")
      .mockResolvedValue(undefined);
    vi.spyOn(client as unknown as { requestOnce: (m: string, p: unknown) => Promise<unknown> }, "requestOnce")
      .mockImplementation(async () => {
        calls += 1;
        if (calls === 1) {
          throw new EngineUnavailableError("ECONNREFUSED", {
            operation: "health",
            provider: "openclaw",
            retryable: true,
          });
        }
        return { ok: true };
      });

    const result = await client.request("health", {});
    expect(result).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it("gives up after retryLimit for persistent failures", async () => {
    const client = buildClient({ retryLimit: 1 });
    vi.spyOn(client as unknown as { ensureConnected: () => Promise<void> }, "ensureConnected")
      .mockResolvedValue(undefined);
    vi.spyOn(client as unknown as { requestOnce: (m: string, p: unknown) => Promise<unknown> }, "requestOnce")
      .mockRejectedValue(
        new EngineUnavailableError("socket hang up", {
          operation: "health",
          provider: "openclaw",
          retryable: true,
        }),
      );

    await expect(client.request("health", {})).rejects.toMatchObject({
      code: "ENGINE_UNAVAILABLE",
    });
  });

  it("does NOT retry non-retryable errors (e.g. invalid request)", async () => {
    const client = buildClient({ retryLimit: 2 });
    vi.spyOn(client as unknown as { ensureConnected: () => Promise<void> }, "ensureConnected")
      .mockResolvedValue(undefined);
    let calls = 0;
    vi.spyOn(client as unknown as { requestOnce: (m: string, p: unknown) => Promise<unknown> }, "requestOnce")
      .mockImplementation(async () => {
        calls += 1;
        throw new EngineRateLimitError("RESOURCE_EXHAUSTED", {
          operation: "x",
          provider: "google-vertex",
          retryable: false,
        });
      });

    await expect(client.request("x", {})).rejects.toBeInstanceOf(
      EngineRateLimitError,
    );
    // Rate limit with retryable=false should not loop.
    expect(calls).toBe(1);
  });

  it("reset-challenge-state on every connect (DEVICE_AUTH_SIGNATURE_EXPIRED regression)", async () => {
    // After a gateway restart the server issues a fresh challenge. If the
    // client reused the previous connection's nonce/timestamp the device
    // signature is rejected as stale. connect() must clear the cached
    // challenge so waitForChallenge captures the new one.
    const client = buildClient({
      deviceKeyPem:
        "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIHtzzZqKwVnJm2H5kA6qG6MzYkMfBQsZQeP7JgX3BlDc\n-----END PRIVATE KEY-----",
    });
    const anyClient = client as unknown as {
      nonce: string | null;
      challengeTs: number;
      requestOnce: (m: string, p: unknown) => Promise<unknown>;
      waitForChallenge: () => Promise<void>;
      connect: () => Promise<void>;
    };

    // First connect: challenge cached (as if the first connection completed).
    anyClient.nonce = "nonce-1";
    anyClient.challengeTs = 1111;
    let connectParams: unknown = null;
    vi.spyOn(anyClient, "requestOnce").mockImplementation(
      async (method, params) => {
        connectParams = params;
        return { type: "hello-ok", protocol: 4 };
      },
    );
    vi.spyOn(anyClient, "waitForChallenge").mockImplementation(async () => {
      // Simulate the server sending a fresh challenge on this new connection.
      anyClient.nonce = "nonce-2";
      anyClient.challengeTs = 2222;
    });

    await anyClient.connect();

    // The connect frame must be signed against the FRESH challenge (nonce-2),
    // not the stale nonce-1 from the previous connection.
    const device = (connectParams as { device?: { nonce: string; signedAt: number } }).device;
    expect(device).toBeDefined();
    expect(device!.nonce).toBe("nonce-2");
    expect(device!.signedAt).toBe(2222);
  });
});

describe("error metadata", () => {
  it("EngineRateLimitError carries retryAfterMs", () => {
    const r = new EngineRateLimitError("rate limit", {
      provider: "google-vertex",
      statusCode: 429,
      retryAfterMs: 1500,
      operation: "sendMessage",
    });
    expect(r.code).toBe("ENGINE_RATE_LIMIT");
    expect(r.statusCode).toBe(429);
    expect(r.retryAfterMs).toBe(1500);
    expect(r.provider).toBe("google-vertex");
  });

  it("EngineTimeoutError is classified", () => {
    const t = new EngineTimeoutError("gateway request timed out", {
      operation: "sendMessage",
      provider: "openclaw",
    });
    expect(t.code).toBe("ENGINE_TIMEOUT");
  });
});
