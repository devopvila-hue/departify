import { describe, expect, it } from "vitest";
import { sessionKey, isLoopbackUrl } from "../src/openclaw/openclaw-adapter.js";

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
