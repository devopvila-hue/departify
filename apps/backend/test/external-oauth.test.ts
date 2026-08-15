import { afterEach, describe, expect, it } from "vitest";
import {
  completeExternalOAuth,
  externalOAuthMissingCredentials,
  META_SOCIAL_SCOPES,
  startExternalOAuth,
} from "../src/customer-zero/external-oauth.js";
import {
  createInMemoryOAuthStateStore,
  installGoogleOAuthStateStore,
} from "../src/customer-zero/oauth-state.js";
import {
  installExternalOAuthTokenStoreForTest,
  summarizeExternalOAuthToken,
  type ExternalOAuthTokenRecord,
} from "../src/customer-zero/external-oauth-tokens.js";

describe("provider-backed marketing OAuth", () => {
  afterEach(() => {
    delete process.env.META_APP_ID;
    delete process.env.META_APP_SECRET;
    delete process.env.TICKTICK_CLIENT_ID;
    delete process.env.TICKTICK_CLIENT_SECRET;
    installGoogleOAuthStateStore(null);
    installExternalOAuthTokenStoreForTest(null);
  });

  it("reports exact missing credentials without attempting a provider call", () => {
    expect(externalOAuthMissingCredentials("meta_business")).toEqual([
      "META_APP_ID",
      "META_APP_SECRET",
    ]);
    expect(externalOAuthMissingCredentials("ticktick")).toEqual([
      "TICKTICK_CLIENT_ID",
      "TICKTICK_CLIENT_SECRET",
    ]);
  });

  it("creates a durable, provider-specific Meta authorization state", async () => {
    process.env.META_APP_ID = "meta-app-test";
    process.env.META_APP_SECRET = "meta-secret-test";
    const stateStore = createInMemoryOAuthStateStore();
    installGoogleOAuthStateStore(stateStore);

    const out = await startExternalOAuth({
      organizationId: "org-a",
      userId: "user-a",
      provider: "meta_business",
      returnPath: "/conexiones",
      redirectUri: "https://app.departify.app/connections/meta_business/callback",
    });

    const authorizationUrl = new URL(out.authorizationUrl);
    expect(authorizationUrl.origin).toBe("https://www.facebook.com");
    expect(authorizationUrl.pathname).toContain("/dialog/oauth");
    expect(authorizationUrl.searchParams.get("client_id")).toBe("meta-app-test");
    expect(authorizationUrl.searchParams.get("state")).toBe(out.state);
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      "https://app.departify.app/connections/meta_business/callback",
    );
    expect((await stateStore.get(out.state))?.requestedToolId).toBe("meta_business");
    expect(new URL(out.authorizationUrl).searchParams.get("scope")?.split(" ")).toEqual([...META_SOCIAL_SCOPES]);
    expect(out.authorizationUrl).not.toContain("ads_");

    await expect(
      completeExternalOAuth({
        organizationId: "org-a",
        userId: "user-a",
        provider: "meta_business",
        code: "provider-code",
        state: "forged-state",
        redirectUri: "https://app.departify.app/connections/meta_business/callback",
      }),
    ).rejects.toThrow("invalid_state");
  });

  it("discovers social assets and grants only the capabilities those assets support", async () => {
    process.env.META_APP_ID = "meta-app-test";
    process.env.META_APP_SECRET = "meta-secret-test";
    const stateStore = createInMemoryOAuthStateStore();
    installGoogleOAuthStateStore(stateStore);
    const tokenStore = {
      put: vi.fn(),
      get: vi.fn(),
      listForOrg: vi.fn(),
      remove: vi.fn(),
    };
    installExternalOAuthTokenStoreForTest(tokenStore);
    const started = await startExternalOAuth({
      organizationId: "org-a",
      userId: "user-a",
      provider: "meta_business",
      returnPath: "/conexiones",
      redirectUri: "https://app.departify.app/connections/meta_business/callback",
    });
    const realFetch = globalThis.fetch;
    let tokenRedirectUri = "";
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/oauth/access_token")) {
        const params = new URL(url).searchParams;
        tokenRedirectUri = params.get("redirect_uri") ?? "";
        return new Response(JSON.stringify({
          access_token: "meta-access-token",
          expires_in: 3600,
          scope: [...META_SOCIAL_SCOPES].join(" "),
        }), { status: 200 });
      }
      if (url.includes("/me?")) {
        return new Response(JSON.stringify({ id: "founder", name: "Founder" }), { status: 200 });
      }
      if (url.includes("/me/accounts?")) {
        return new Response(JSON.stringify({
          data: [{
            id: "page-1",
            name: "Departify Page",
            instagram_business_account: { id: "ig-1", name: "Departify Instagram", username: "departify" },
          }],
        }), { status: 200 });
      }
      return realFetch(input, init);
    }) as typeof fetch;
    try {
      const completed = await completeExternalOAuth({
        organizationId: "org-a",
        userId: "user-a",
        provider: "meta_business",
        code: "provider-code",
        state: started.state,
        redirectUri: "https://app.departify.app/connections/meta_business/callback",
      });
      expect(tokenRedirectUri).toBe("https://app.departify.app/connections/meta_business/callback");
      expect(completed.record.accountLabel).toBe("Departify Page · @departify");
      expect(completed.grantedCapabilities).toEqual([
        "marketing.social.read",
        "marketing.social.publish",
        "marketing.social.instagram.read",
        "marketing.social.instagram.publish",
      ]);
      expect(tokenStore.put).toHaveBeenCalledWith(expect.objectContaining({
        organizationId: "org-a",
        userId: "user-a",
        provider: "meta_business",
        accessToken: "meta-access-token",
      }));
      expect(JSON.stringify(tokenStore.put.mock.calls[0])).not.toContain("META_APP_SECRET");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("creates a TickTick authorization URL with task scopes", async () => {
    process.env.TICKTICK_CLIENT_ID = "ticktick-client-test";
    process.env.TICKTICK_CLIENT_SECRET = "ticktick-secret-test";
    installGoogleOAuthStateStore(createInMemoryOAuthStateStore());

    const out = await startExternalOAuth({
      organizationId: "org-b",
      userId: "user-b",
      provider: "ticktick",
      returnPath: "/conexiones",
      redirectUri: "https://app.departify.app/connections/ticktick/callback",
    });

    const authorizationUrl = new URL(out.authorizationUrl);
    expect(authorizationUrl.origin).toBe("https://ticktick.com");
    expect(authorizationUrl.pathname).toBe("/oauth/authorize");
    expect(authorizationUrl.searchParams.get("client_id")).toBe("ticktick-client-test");
    expect(authorizationUrl.searchParams.get("scope")).toBe("tasks:read tasks:write");
  });

  it("summaries never expose raw OAuth tokens", () => {
    const record: ExternalOAuthTokenRecord = {
      organizationId: "org-a",
      userId: "user-a",
      provider: "ticktick",
      accessToken: "raw-access-token",
      refreshToken: "raw-refresh-token",
      expiresAt: null,
      scopes: ["tasks:read"],
      accountLabel: "Founder",
      operationalVerifiedAt: new Date().toISOString(),
      operationalProbeError: null,
    };
    const summary = summarizeExternalOAuthToken(record);
    expect(summary).toEqual(expect.objectContaining({
      hasAccessToken: true,
      hasRefreshToken: true,
      provider: "ticktick",
    }));
    expect(JSON.stringify(summary)).not.toContain("raw-access-token");
    expect(JSON.stringify(summary)).not.toContain("raw-refresh-token");
  });
});
