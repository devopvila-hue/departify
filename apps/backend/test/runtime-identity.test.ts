import { afterEach, describe, expect, it } from "vitest";
import {
  issueScopedRuntimeToken,
  organizationFromOpenClawSessionKey,
  validateScopedRuntimeToken,
} from "../src/customer-zero/runtime-identity.js";
import {
  createInMemoryGoogleTokenStore,
  installGoogleTokenStore,
} from "../src/customer-zero/google-tokens.js";
import { findOperationalGoogleIdentityForOrg } from "../src/customer-zero/credential-resolver.js";

describe("native runtime identity", () => {
  afterEach(() => {
    delete process.env.DEPARTIFY_RUNTIME_TOKEN;
    installGoogleTokenStore(null);
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
    expect(organizationFromOpenClawSessionKey("departify:ceo:org-a:7a9f4986-23ba-4d47-8018-f92e304c539d")).toEqual({
      organizationId: "org-a",
      userId: "7a9f4986-23ba-4d47-8018-f92e304c539d",
      agentId: "main",
    });
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

  it("fails closed when resolving Google credentials across users and tenants", async () => {
    const store = createInMemoryGoogleTokenStore();
    installGoogleTokenStore(store);
    const orgA = "7a9f4986-23ba-4d47-8018-f92e304c539d";
    const orgB = "8b660597-34cb-5e58-a299-023915cad64e";
    const userA = "336ed930-e84f-4bf2-aed0-b61d8dc1e935";
    const userB = "436ed930-e84f-4bf2-aed0-b61d8dc1e935";
    const record = (organizationId: string, userId: string) => ({
      organizationId,
      userId,
      provider: "gmail" as const,
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      scopes: [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/calendar.readonly",
      ],
      email: `${userId}@example.com`,
      displayName: userId,
      operationalVerifiedAt: new Date().toISOString(),
      operationalProbeError: null,
      operationalCapabilities: ["email.read", "calendar.read"] as const,
    });
    await store.put(record(orgA, userA));
    await store.put(record(orgB, userB));

    expect((await findOperationalGoogleIdentityForOrg(orgA, "email.read", userA))?.userId).toBe(userA);
    expect(await findOperationalGoogleIdentityForOrg(orgA, "email.read", userB)).toBeNull();
    expect(await findOperationalGoogleIdentityForOrg(orgB, "calendar.read", userA)).toBeNull();
    expect((await findOperationalGoogleIdentityForOrg(orgB, "calendar.read", userB))?.userId).toBe(userB);
  });
});
