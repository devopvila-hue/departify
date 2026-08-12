import { describe, expect, it } from "vitest";
import { normalizeDeviceKey } from "../src/openclaw/openclaw-adapter.js";

describe("OpenClaw device key configuration", () => {
  it("accepts the JSON envelope used by the local OpenClaw CLI", async () => {
    const envelope = JSON.stringify({ privateKeyPem: "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----" });
    expect(normalizeDeviceKey(envelope)).toContain("BEGIN PRIVATE KEY");
  });

  it("leaves a PEM secret unchanged", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----";
    expect(normalizeDeviceKey(pem)).toBe(pem);
  });
});
