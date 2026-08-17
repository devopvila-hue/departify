import { afterEach, describe, expect, it } from "vitest";
import {
  completeExternalOAuth,
  externalOAuthMissingCredentials,
  META_INSTAGRAM_SCOPES,
  META_SOCIAL_SCOPES,
  TIKTOK_SCOPES,
  externalOAuthRedirectUri,
  startExternalOAuth,
} from "../src/customer-zero/external-oauth.js";
import {
  createInMemoryOAuthStateStore,
  getGoogleOAuthStateStore,
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
    delete process.env.GITHUB_OAUTH_CLIENT_ID;
    delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
    delete process.env.TIKTOK_CLIENT_KEY;
    delete process.env.TIKTOK_CLIENT_SECRET;
    delete process.env.TIKTOK_BUSINESS_APP_ID;
    delete process.env.TIKTOK_BUSINESS_APP_SECRET;
    delete process.env.TIKTOK_BUSINESS_SCOPES;
    delete process.env.PUBLIC_API_BASE_URL;
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
    expect(externalOAuthMissingCredentials("github")).toEqual([
      "GITHUB_OAUTH_CLIENT_ID",
      "GITHUB_OAUTH_CLIENT_SECRET",
    ]);
  });

  it("uses the production API callback bridge for TikTok OAuth", () => {
    process.env.NODE_ENV = "production";
    expect(externalOAuthRedirectUri("tiktok", "https://app.departify.app"))
      .toBe("https://api.departify.app/connections/tiktok/callback");
    expect(externalOAuthRedirectUri("tiktok_business", "https://app.departify.app"))
      .toBe("https://api.departify.app/connections/tiktok_ads/callback");
    delete process.env.NODE_ENV;
  });

  it("creates a GitHub repository authorization state without exposing write capability", async () => {
    process.env.GITHUB_OAUTH_CLIENT_ID = "github-client-test";
    process.env.GITHUB_OAUTH_CLIENT_SECRET = "github-secret-test";
    const stateStore = createInMemoryOAuthStateStore();
    installGoogleOAuthStateStore(stateStore);

    const out = await startExternalOAuth({
      organizationId: "org-seo",
      userId: "user-seo",
      provider: "github",
      returnPath: "/seo",
      redirectUri: "https://app.departify.app/connections/github_repository/callback",
    });
    const authorizationUrl = new URL(out.authorizationUrl);

    expect(authorizationUrl.origin).toBe("https://github.com");
    expect(authorizationUrl.pathname).toBe("/login/oauth/authorize");
    expect(authorizationUrl.searchParams.get("client_id")).toBe("github-client-test");
    expect(authorizationUrl.searchParams.get("scope")?.split(" ")).toEqual(["read:user", "repo"]);
    expect((await stateStore.get(out.state))?.requestedToolId).toBe("github_repository");
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

  it("creates a separate Instagram Login authorization URL with current business scopes", async () => {
    process.env.META_APP_ID = "meta-app-test";
    process.env.META_APP_SECRET = "meta-secret-test";
    const stateStore = createInMemoryOAuthStateStore();
    installGoogleOAuthStateStore(stateStore);

    const out = await startExternalOAuth({
      organizationId: "org-instagram",
      userId: "user-instagram",
      provider: "meta_instagram",
      returnPath: "/conexiones",
      redirectUri: "https://app.departify.app/connections/meta_business/callback",
    });
    const authorizationUrl = new URL(out.authorizationUrl);
    expect(authorizationUrl.origin).toBe("https://www.instagram.com");
    expect(authorizationUrl.pathname).toBe("/oauth/authorize");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      "https://app.departify.app/connections/meta_business/callback",
    );
    expect(authorizationUrl.searchParams.get("scope")?.split(",")).toEqual([...META_INSTAGRAM_SCOPES]);
    expect(authorizationUrl.searchParams.get("scope")).not.toContain("instagram_basic");
  });

  it("exchanges Instagram Login code and grants only Instagram capabilities", async () => {
    process.env.META_APP_ID = "meta-app-test";
    process.env.META_APP_SECRET = "meta-secret-test";
    installGoogleOAuthStateStore(createInMemoryOAuthStateStore());
    const tokenStore = {
      put: vi.fn(),
      get: vi.fn(),
      listForOrg: vi.fn(),
      remove: vi.fn(),
    };
    installExternalOAuthTokenStoreForTest(tokenStore);
    const started = await startExternalOAuth({
      organizationId: "org-instagram",
      userId: "user-instagram",
      provider: "meta_instagram",
      returnPath: "/conexiones",
      redirectUri: "https://app.departify.app/connections/meta_business/callback",
    });
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.instagram.com/oauth/access_token") {
        expect(init?.method).toBe("POST");
        return new Response(JSON.stringify({
          access_token: "instagram-short-token",
          user_id: "ig-1",
          permissions: [...META_INSTAGRAM_SCOPES].join(","),
        }), { status: 200 });
      }
      if (url.includes("graph.instagram.com/access_token")) {
        return new Response(JSON.stringify({
          access_token: "instagram-long-token",
          expires_in: 5_184_000,
        }), { status: 200 });
      }
      if (url.includes("graph.instagram.com/v25.0/me?")) {
        return new Response(JSON.stringify({ id: "ig-1", username: "departify" }), { status: 200 });
      }
      return realFetch(input, init);
    }) as typeof fetch;
    try {
      const completed = await completeExternalOAuth({
        organizationId: "org-instagram",
        userId: "user-instagram",
        provider: "meta_instagram",
        code: "instagram-code",
        state: started.state,
        redirectUri: "https://app.departify.app/connections/meta_business/callback",
      });
      expect(completed.record.provider).toBe("meta_instagram");
      expect(completed.record.accessToken).toBe("instagram-long-token");
      expect(completed.grantedCapabilities).toEqual([
        "marketing.social.instagram.read",
        "marketing.social.instagram.publish",
      ]);
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

  it("creates TikTok Login Kit authorization with the approved read scopes", async () => {
    process.env.TIKTOK_CLIENT_KEY = "tiktok-client-test";
    process.env.TIKTOK_CLIENT_SECRET = "tiktok-secret-test";
    installGoogleOAuthStateStore(createInMemoryOAuthStateStore());
    const out = await startExternalOAuth({
      organizationId: "org-tiktok",
      userId: "user-tiktok",
      provider: "tiktok",
      returnPath: "/marketing",
      redirectUri: "https://app.departify.app/connections/tiktok/callback",
    });
    const url = new URL(out.authorizationUrl);
    expect(url.origin).toBe("https://www.tiktok.com");
    expect(url.pathname).toBe("/v2/auth/authorize/");
    expect(url.searchParams.get("client_key")).toBe("tiktok-client-test");
    expect(url.searchParams.get("scope")?.split(",")).toEqual([...TIKTOK_SCOPES]);
    expect((await getStateRecord(out.state))?.requestedToolId).toBe("tiktok");
  });

  it("exchanges TikTok Login Kit and probes the real profile without granting Ads write", async () => {
    process.env.TIKTOK_CLIENT_KEY = "tiktok-client-test";
    process.env.TIKTOK_CLIENT_SECRET = "tiktok-secret-test";
    const stateStore = createInMemoryOAuthStateStore();
    installGoogleOAuthStateStore(stateStore);
    const tokenStore = { put: vi.fn(), get: vi.fn(), listForOrg: vi.fn(), remove: vi.fn() };
    installExternalOAuthTokenStoreForTest(tokenStore);
    const started = await startExternalOAuth({
      organizationId: "org-tiktok",
      userId: "user-tiktok",
      provider: "tiktok",
      returnPath: "/marketing",
      redirectUri: "https://app.departify.app/connections/tiktok/callback",
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://open.tiktokapis.com/v2/oauth/token/") {
        expect(init?.method).toBe("POST");
        return new Response(JSON.stringify({
          access_token: "tiktok-access-token",
          refresh_token: "tiktok-refresh-token",
          expires_in: 86400,
          refresh_expires_in: 31536000,
          scope: [...TIKTOK_SCOPES].join(","),
        }), { status: 200 });
      }
      if (url.startsWith("https://open.tiktokapis.com/v2/user/info/")) {
        expect((init?.headers as Record<string, string>).authorization).toBe("Bearer tiktok-access-token");
        return new Response(JSON.stringify({ data: { user: { display_name: "Departify" } } }), { status: 200 });
      }
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    try {
      const completed = await completeExternalOAuth({
        organizationId: "org-tiktok",
        userId: "user-tiktok",
        provider: "tiktok",
        code: "tiktok-code",
        state: started.state,
        redirectUri: "https://app.departify.app/connections/tiktok/callback",
      });
      expect(completed.record.accountLabel).toBe("TikTok · Departify");
      expect(completed.grantedCapabilities).toEqual([
        "marketing.tiktok",
        "marketing.tiktok.content.read",
      ]);
      expect(completed.grantedCapabilities).not.toContain("marketing.tiktok.ads.create");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("uses TikTok for Business Marketing API auth and discovers advertiser accounts", async () => {
    process.env.TIKTOK_BUSINESS_APP_ID = "tiktok-business-app";
    process.env.TIKTOK_BUSINESS_APP_SECRET = "tiktok-business-secret";
    process.env.TIKTOK_BUSINESS_SCOPES = "advertiser.read,campaign.read,report.read";
    const stateStore = createInMemoryOAuthStateStore();
    installGoogleOAuthStateStore(stateStore);
    const tokenStore = { put: vi.fn(), get: vi.fn(), listForOrg: vi.fn(), remove: vi.fn() };
    installExternalOAuthTokenStoreForTest(tokenStore);
    const started = await startExternalOAuth({
      organizationId: "org-tiktok-ads",
      userId: "user-tiktok",
      provider: "tiktok_business",
      returnPath: "/marketing",
      redirectUri: "https://app.departify.app/connections/tiktok_ads/callback",
    });
    const authUrl = new URL(started.authorizationUrl);
    expect(authUrl.searchParams.get("app_id")).toBe("tiktok-business-app");
    expect(authUrl.searchParams.get("scope")).toBe("advertiser.read,campaign.read,report.read");
    expect((await getStateRecord(started.state))?.requestedToolId).toBe("tiktok_ads");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/oauth2/access_token/")) {
        return new Response(JSON.stringify({ code: 0, message: "OK", data: { access_token: "ads-token", advertiser_ids: ["adv-1"] } }), { status: 200 });
      }
      if (url.includes("/advertiser/info/")) {
        return new Response(JSON.stringify({ code: 0, message: "OK", data: { list: [{ advertiser_id: "adv-1", name: "Departify Ads", status: "STATUS_ENABLE" }] } }), { status: 200 });
      }
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;
    try {
      const completed = await completeExternalOAuth({
        organizationId: "org-tiktok-ads",
        userId: "user-tiktok",
        provider: "tiktok_business",
        code: "business-auth-code",
        state: started.state,
        redirectUri: "https://app.departify.app/connections/tiktok_ads/callback",
      });
      expect(completed.record.accountLabel).toBe("Departify Ads");
      expect(completed.record.accountOptions).toEqual([{ id: "adv-1", label: "Departify Ads", kind: "advertiser" }]);
      expect(completed.grantedCapabilities).toEqual([
        "marketing.tiktok.ads.read",
        "marketing.tiktok.ads.report",
        "marketing.tiktok.ads.analyze",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
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

async function getStateRecord(state: string) {
  return getGoogleOAuthStateStore().get(state);
}
