import { afterEach, describe, expect, it } from "vitest";
import {
  issueScopedRuntimeToken,
  organizationFromOpenClawSessionKey,
  validateScopedRuntimeToken,
} from "../src/customer-zero/runtime-identity.js";

describe("native runtime identity", () => {
  afterEach(() => {
    delete process.env.DEPARTIFY_RUNTIME_TOKEN;
  });

  it("issues and validates a short-lived audience-scoped token", () => {
    const issued = issueScopedRuntimeToken({
      secret: "runtime-secret",
      organizationId: "org-a",
      sessionKey: "departify:ceo:org-a",
      nowSeconds: 100,
      ttlSeconds: 60,
    });
    expect(issued.claims.organizationId).toBe("org-a");
    expect(validateScopedRuntimeToken({
      token: issued.token,
      secret: "runtime-secret",
      nowSeconds: 120,
    })).toMatchObject({ valid: true, claims: { organizationId: "org-a" } });
  });

  it("fails closed for expiry, audience and signature changes", () => {
    const issued = issueScopedRuntimeToken({
      secret: "runtime-secret",
      organizationId: "org-a",
      sessionKey: "departify:ceo:org-a",
      nowSeconds: 100,
    });
    expect(validateScopedRuntimeToken({ token: issued.token, secret: "runtime-secret", nowSeconds: 161 })).toMatchObject({
      valid: false,
      reason: "invalid_claims",
    });
    expect(validateScopedRuntimeToken({ token: issued.token, secret: "runtime-secret", expectedAudience: "other", nowSeconds: 110 })).toMatchObject({
      valid: false,
      reason: "invalid_claims",
    });
    expect(validateScopedRuntimeToken({ token: `${issued.token}x`, secret: "runtime-secret", nowSeconds: 110 })).toMatchObject({
      valid: false,
      reason: "invalid_signature",
    });
  });

  it("derives the tenant only from the trusted Departify session key", () => {
    expect(organizationFromOpenClawSessionKey("departify:ceo:org-a")).toEqual({
      organizationId: "org-a",
      agentId: "main",
    });
    expect(organizationFromOpenClawSessionKey("agent:main:departify:ceo:org-a")).toEqual({
      organizationId: "org-a",
      agentId: "main",
    });
    expect(organizationFromOpenClawSessionKey("departify:ceo:org-a:org-b")).toBeNull();
    expect(organizationFromOpenClawSessionKey("agent:other:departify:ceo:org-a")).toBeNull();
    expect(organizationFromOpenClawSessionKey("agent:main:main")).toBeNull();
  });

  it("rejects a scoped token issued for another runtime agent", () => {
    const issued = issueScopedRuntimeToken({
      secret: "runtime-secret",
      organizationId: "org-a",
      sessionKey: "departify:ceo:org-a",
      agentId: "other-agent",
    });
    expect(validateScopedRuntimeToken({
      token: issued.token,
      secret: "runtime-secret",
    })).toMatchObject({ valid: false, reason: "invalid_claims" });
  });
});
