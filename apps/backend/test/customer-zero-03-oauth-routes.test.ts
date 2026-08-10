import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { buildServer } from "../src/server/server.js";
import { loadBackendConfig } from "@departify/config";
import type { FastifyInstance } from "fastify";
import type { InjectOptions } from "light-my-request";
import { makeFakeTenant } from "./helpers/fake-tenant.js";
import {
  gmailTokenStore,
  gmailOAuthStateStore,
} from "../src/customer-zero/gmail-adapter.js";
import { resetCustomerZeroSessionsForTest } from "../src/customer-zero/customer-zero-session.js";

/**
 * CZ03 — real Google OAuth unified handshake at the HTTP boundary.
 *
 * The connect endpoint must return a real Google authorization URL carrying a
 * CSRF state nonce (bound to org+user), and the callback endpoint must
 * validate that nonce and complete the token exchange server-side. These are
 * the two gaps the CZ03 recovery closed (the previous wiring only flipped the
 * connection status without ever talking to Google).
 */

const AUTH = { authorization: "Bearer token-a" };

describe("CZ03 — Google OAuth unified handshake (routes)", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    const tenant = makeFakeTenant();
    server = await buildServer(loadBackendConfig(), {
      auth: tenant,
      organizations: tenant,
    });
  });

  afterEach(() => {
    resetCustomerZeroSessionsForTest();
    gmailTokenStore.remove("org-a", "user-a");
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    delete process.env.PUBLIC_BASE_URL;
  });

  function authedInject(options: InjectOptions) {
    return server.inject({
      ...options,
      headers: { ...AUTH, ...(options.headers ?? {}) },
    });
  }

  async function startOrg(): Promise<string> {
    const response = await authedInject({
      method: "POST",
      url: "/api/customer-zero/start",
      payload: {
        companyName: "Moon",
        hasWebsite: false,
        description: "Plataforma de vivienda compartida.",
        goal: "Conseguir clientes",
      },
    });
    expect(response.statusCode).toBe(200);
    return response.json().organizationId as string;
  }

  it("connect without Google credentials reports missing credentials (honest)", async () => {
    const org = await startOrg();
    const response = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/connections/gmail/connect`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.connection.status).toBe("blocked");
    expect(body.connection.missingCredentials).toContain("GOOGLE_OAUTH_CLIENT_ID");
  });

  it("connect with credentials returns a Google authorization URL with a state nonce", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "client-test";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret-test";
    process.env.PUBLIC_BASE_URL = "https://app.departify.app";
    const org = await startOrg();
    const response = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/connections/gmail/connect`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.connection.status).toBe("connecting");
    expect(body.connection.authorizationUrl).toContain(
      "accounts.google.com/o/oauth2/v2/auth",
    );
    expect(body.connection.authorizationUrl).toContain("state=");
    expect(body.connection.authorizationUrl).toContain("redirect_uri=");
    expect(body.connection.oauthState).toBeTruthy();
    // The state nonce is registered in the server-side OAuth state store.
    expect(gmailOAuthStateStore.get(body.connection.oauthState)).not.toBeNull();
  });

  it("P0 redirect_uri: with PUBLIC_BASE_URL=https://app.departify.app the authorization URL contains exactly https://app.departify.app/connections/google/callback", async () => {
    // Regression for the production redirect_uri_mismatch error.
    // The Google Cloud OAuth Web Client was configured by the founder
    // with:
    //   Authorized JavaScript origin:  https://app.departify.app
    //   Authorized redirect URI:       https://app.departify.app/connections/google/callback
    // The backend must generate EXACTLY that redirect_uri. Nothing
    // else, no trailing slash, no /api/... path, no localhost, no
    // api.departify.app.
    process.env.GOOGLE_OAUTH_CLIENT_ID = "client-test";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret-test";
    process.env.PUBLIC_BASE_URL = "https://app.departify.app";
    const org = await startOrg();
    const response = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/connections/gmail/connect`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    const authorizationUrl = body.connection.authorizationUrl as string;

    // Extract the exact redirect_uri the backend will hand to Google.
    const parsed = new URL(authorizationUrl);
    const redirectUri = parsed.searchParams.get("redirect_uri");
    expect(redirectUri).not.toBeNull();
    expect(redirectUri).toBe("https://app.departify.app/connections/google/callback");

    // Defensive checks: every common production mistake must be absent.
    expect(redirectUri).not.toMatch(/^http:\/\//);
    expect(redirectUri).not.toContain("localhost");
    expect(redirectUri).not.toContain("api.departify.app");
    expect(redirectUri).not.toContain("/api/customer-zero/");
    expect(redirectUri?.endsWith("/")).toBe(false);
    expect(redirectUri).not.toMatch(/\/+$/);

    // The same contract holds for every Google tool the founder can
    // declare during onboarding.
    for (const toolId of [
      "gmail",
      "google_workspace",
      "google_calendar",
      "google_drive",
    ]) {
      const r = await authedInject({
        method: "POST",
        url: `/api/customer-zero/${org}/connections/${toolId}/connect`,
      });
      expect(r.statusCode).toBe(200);
      const u = r.json().connection.authorizationUrl as string;
      expect(new URL(u).searchParams.get("redirect_uri")).toBe(
        "https://app.departify.app/connections/google/callback",
      );
    }
  });

  it("callback with a forged state is rejected (CSRF / replay)", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "client-test";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret-test";
    process.env.PUBLIC_BASE_URL = "https://app.departify.app";
    const org = await startOrg();
    // Start a real handshake so a connection exists in "connecting" state.
    await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/connections/gmail/connect`,
    });
    const response = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/connections/gmail/callback`,
      payload: { code: "x", state: "forged-nonce" },
    });
    // The forged state does not exist in the OAuth state store → rejected.
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("invalid_state");
  });

  it("callback completes a real handshake and persists tokens (org+user scoped)", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "client-test";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret-test";
    process.env.PUBLIC_BASE_URL = "https://app.departify.app";
    const org = await startOrg();
    const connect = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/connections/gmail/connect`,
    });
    const state = connect.json().connection.oauthState as string;
    expect(state).toBeTruthy();

    // Mock the Google token + userinfo exchange. We capture the body of
    // the POST to oauth2.googleapis.com/token so we can P0-pin that
    // redirect_uri handed to Google's token endpoint is byte-identical
    // to the one used in the authorize URL.
    const realFetch = globalThis.fetch;
    let tokenRequestBody: URLSearchParams | null = null;
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("oauth2.googleapis.com/token")) {
        if (init?.body && typeof init.body === "string") {
          tokenRequestBody = new URLSearchParams(init.body);
        }
        return new Response(
          JSON.stringify({
            access_token: "access-1",
            refresh_token: "refresh-1",
            expires_in: 3600,
            scope: "openid email profile gmail.readonly gmail.compose gmail.send",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("userinfo")) {
        return new Response(
          JSON.stringify({ email: "ceo@departify.app", name: "CEO" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return realFetch(input, init);
    }) as unknown as typeof fetch;

    try {
      const callback = await authedInject({
        method: "POST",
        url: `/api/customer-zero/${org}/connections/gmail/callback`,
        payload: { code: "auth-code-1", state },
      });
      expect(callback.statusCode).toBe(200);
      const body = callback.json();
      expect(body.connection.status).toBe("connected");
      expect(body.identity.email).toBe("ceo@departify.app");
      // Tokens persisted, org+user scoped.
      const tokens = gmailTokenStore.get(org, "user-a");
      expect(tokens?.accessToken).toBe("access-1");
      expect(tokens?.refreshToken).toBe("refresh-1");
      expect(tokens?.email).toBe("ceo@departify.app");
      // P0 — the redirect_uri sent to Google's token endpoint MUST
      // match the authorize redirect_uri byte-for-byte. Otherwise
      // Google rejects with `redirect_uri_mismatch`.
      expect(tokenRequestBody).not.toBeNull();
      expect(tokenRequestBody!.get("redirect_uri")).toBe(
        "https://app.departify.app/connections/google/callback",
      );
      // The connection is now connected — a second callback is rejected at the
      // handshake-state gate (409), and the consumed nonce is also gone.
      const replay = await authedInject({
        method: "POST",
        url: `/api/customer-zero/${org}/connections/gmail/callback`,
        payload: { code: "auth-code-1", state },
      });
      expect(replay.statusCode).toBe(409);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("tokens are org-isolated — another org never sees them", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "client-test";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret-test";
    process.env.PUBLIC_BASE_URL = "https://app.departify.app";
    gmailTokenStore.put("org-a", "user-a", {
      accessToken: "tok-a",
      refreshToken: "ref-a",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      scopes: ["openid", "gmail.readonly"],
      email: "ceo@departify.app",
      displayName: "CEO",
    });
    expect(gmailTokenStore.get("org-a", "user-a")?.email).toBe("ceo@departify.app");
    expect(gmailTokenStore.get("org-b", "user-a")).toBeNull();
    expect(gmailTokenStore.get("org-a", "user-b")).toBeNull();
    // The public connection list never includes the refresh token.
    const org = await startOrg();
    const list = await authedInject({
      method: "GET",
      url: `/api/customer-zero/${org}/connections`,
    });
    const serialized = JSON.stringify(list.json());
    expect(serialized).not.toContain("refreshToken");
    expect(serialized).not.toContain("ref-a");
  });
});
