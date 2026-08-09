import { describe, expect, it } from "vitest";
import {
  mapGatewayError,
  type GatewayRpcError,
} from "../src/openclaw/gateway-client.js";
import {
  EngineAuthenticationError,
  EngineInvalidRequestError,
  EngineProtocolError,
  EngineRateLimitError,
  EngineSessionNotFoundError,
  EngineTimeoutError,
  EngineUnavailableError,
} from "../src/errors.js";

function gatewayErr(
  code: string,
  opts: { details?: unknown; retryable?: boolean; retryAfterMs?: number } = {},
): GatewayRpcError {
  const e = new Error(`boom (${code})`) as GatewayRpcError;
  e.gatewayCode = code;
  if (opts.details !== undefined) e.gatewayDetails = opts.details as never;
  if (opts.retryable !== undefined) e.retryable = opts.retryable;
  if (opts.retryAfterMs !== undefined) e.retryAfterMs = opts.retryAfterMs;
  return e;
}

describe("mapGatewayError — Vertex/OpenClaw → EngineError taxonomy", () => {
  it("maps 429 RESOURCE_EXHAUSTED to EngineRateLimitError", () => {
    const err = gatewayErr("429 RESOURCE_EXHAUSTED", {
      details: { code: "RESOURCE_EXHAUSTED" },
      retryable: true,
      retryAfterMs: 1000,
    });
    const mapped = mapGatewayError(err, "sendMessage");
    expect(mapped).toBeInstanceOf(EngineRateLimitError);
    expect(mapped.code).toBe("ENGINE_RATE_LIMIT");
    expect(mapped.retryable).toBe(true);
    expect(mapped.retryAfterMs).toBe(1000);
    expect(mapped.operation).toBe("sendMessage");
  });

  it("maps generic rate limit / quota to EngineRateLimitError", () => {
    expect(mapGatewayError(gatewayErr("rate limit reached"), "x")).toBeInstanceOf(
      EngineRateLimitError,
    );
    expect(mapGatewayError(gatewayErr("quota exceeded"), "x")).toBeInstanceOf(
      EngineRateLimitError,
    );
  });

  it("maps 401 / unauthorized to EngineAuthenticationError", () => {
    expect(mapGatewayError(gatewayErr("unauthorized"), "x")).toBeInstanceOf(
      EngineAuthenticationError,
    );
    expect(mapGatewayError(gatewayErr("401 invalid token"), "x")).toBeInstanceOf(
      EngineAuthenticationError,
    );
  });

  it("maps NOT_PAIRED to EngineAuthenticationError", () => {
    expect(mapGatewayError(gatewayErr("NOT_PAIRED pairing required"), "x")).toBeInstanceOf(
      EngineAuthenticationError,
    );
  });

  it("maps session-not-found to EngineSessionNotFoundError", () => {
    expect(
      mapGatewayError(gatewayErr("session not found"), "getSession"),
    ).toBeInstanceOf(EngineSessionNotFoundError);
  });

  it("maps INVALID_REQUEST / MISSING_SCOPE to EngineInvalidRequestError", () => {
    expect(
      mapGatewayError(gatewayErr("INVALID_REQUEST"), "createSession"),
    ).toBeInstanceOf(EngineInvalidRequestError);
    expect(
      mapGatewayError(gatewayErr("MISSING_SCOPE operator.write"), "x"),
    ).toBeInstanceOf(EngineInvalidRequestError);
  });

  it("maps timeout to EngineTimeoutError", () => {
    expect(mapGatewayError(gatewayErr("TIMEOUT request timed out"), "x")).toBeInstanceOf(
      EngineTimeoutError,
    );
  });

  it("maps unavailable/closed to EngineUnavailableError", () => {
    expect(mapGatewayError(gatewayErr("ECONNREFUSED"), "x")).toBeInstanceOf(
      EngineUnavailableError,
    );
    expect(mapGatewayError(gatewayErr("UNAVAILABLE"), "x")).toBeInstanceOf(
      EngineUnavailableError,
    );
  });

  it("defaults unknown gateway errors to EngineProtocolError", () => {
    const mapped = mapGatewayError(gatewayErr("SOME_NEW_CODE"), "x");
    expect(mapped).toBeInstanceOf(EngineProtocolError);
    expect(mapped.code).toBe("ENGINE_PROTOCOL");
  });

  it("produces a Departify message, not the raw gateway object", () => {
    const mapped = mapGatewayError(
      gatewayErr("429 RESOURCE_EXHAUSTED", { details: { code: "RESOURCE_EXHAUSTED" } }),
      "x",
    );
    // The frontend sees a stable EngineRateLimitError with a clean message;
    // the raw gateway `details` object never leaks as a JSON blob.
    expect(mapped.message).toContain("Engine rate limit");
    expect(mapped).not.toHaveProperty("gatewayDetails");
  });
});
