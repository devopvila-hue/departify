/**
 * P0 — Customer Zero Google OAuth canonical redirect URI contract.
 *
 * The Google Cloud Web Client has ONE authorized redirect URI:
 *   https://app.departify.app/connections/google/callback
 *
 * The backend must use that EXACT URL:
 *   1. In the authorization request (`?redirect_uri=...`)
 *   2. In the token exchange request (POST /token body)
 *
 * If the two URLs drift apart — or if either URL contains a per-org
 * path like /api/customer-zero/${orgId}/connections/gmail/callback —
 * Google rejects the flow with `redirect_uri_mismatch`. This file
 * exists to LOCK THAT CONTRACT.
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { buildServer } from "../src/server/server.js";
import { loadBackendConfig } from "@departify/config";
import type { FastifyInstance } from "fastify";
import type { InjectOptions } from "light-my-request";
import { makeFakeTenant } from "./helpers/fake-tenant.js";
import {
  gmailTokenStore,
  gmailOAuthStateStore,
  googleOAuthRedirectUri,
  GOOGLE_OAUTH_REDIRECT_PATH,
} from "../src/customer-zero/gmail-adapter.js";
import { resetCustomerZeroSessionsForTest } from "../src/customer-zero/customer-zero-session.js";

const AUTH = { authorization: "Bearer token-a" };

/** The exact redirect URI the founder registered on Google Cloud. */
const PRODUCTION_REDIRECT_URI =
  "https://app.departify.app/connections/google/callback";

/** Every Google tool the CEO can connect during Customer Zero. */
const ALL_GOOGLE_TOOLS = [
  "gmail",
  "google_workspace",
  "google_calendar",
  "google_drive",
] as const;

describe("P0 — Google OAuth canonical redirect URI", () => {
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

  it("helper: googleOAuthRedirectUri('https://app.departify.app') returns the exact production URL", () => {
    expect(googleOAuthRedirectUri("https://app.departify.app")).toBe(
      PRODUCTION_REDIRECT_URI,
    );
  });

  it("helper: googleOAuthRedirectUri reads PUBLIC_BASE_URL env when arg is empty", () => {
    process.env.PUBLIC_BASE_URL = "https://app.departify.app";
    expect(googleOAuthRedirectUri("")).toBe(PRODUCTION_REDIRECT_URI);
    expect(googleOAuthRedirectUri()).toBe(PRODUCTION_REDIRECT_URI);
  });

  it("helper: trailing slashes are normalized away", () => {
    expect(googleOAuthRedirectUri("https://app.departify.app/")).toBe(
      PRODUCTION_REDIRECT_URI,
    );
  });

  it("helper: GOOGLE_OAUTH_REDIRECT_PATH is the single source of truth", () => {
    expect(GOOGLE_OAUTH_REDIRECT_PATH).toBe("/connections/google/callback");
  });

  it("authorize: every Google tool generates the EXACT production redirect_uri", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "client-test";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret-test";
    process.env.PUBLIC_BASE_URL = "https://app.departify.app";
    const org = await startOrg();

    for (const toolId of ALL_GOOGLE_TOOLS) {
      const response = await authedInject({
        method: "POST",
        url: `/api/customer-zero/${org}/connections/${toolId}/connect`,
      });
      expect(response.statusCode).toBe(200);
      const authorizationUrl = response.json().connection
        .authorizationUrl as string;

      // The URL MUST be sent to accounts.google.com, never to the
      // per-org backend callback.
      expect(authorizationUrl).toContain(
        "https://accounts.google.com/o/oauth2/v2/auth",
      );
      const parsed = new URL(authorizationUrl);
      const redirectUri = parsed.searchParams.get("redirect_uri");
      expect(redirectUri).toBe(PRODUCTION_REDIRECT_URI);

      // Defence-in-depth: the authorize URL must NEVER contain the
      // legacy /api/customer-zero/.../callback path. That path is the
      // backend API endpoint, not a Google-authorized redirect URI.
      expect(authorizationUrl).not.toMatch(/\/api\/customer-zero\//);
      expect(authorizationUrl).not.toMatch(/\/connections\/gmail\/callback/);
      expect(authorizationUrl).not.toMatch(/\/connections\/[^/]+\/callback/);

      // The organization id, user id and tool id MUST travel through
      // the OAuth state nonce, NOT through the URL.
      expect(authorizationUrl).not.toContain(org);
    }
  });

  it("token exchange: callback sends the EXACT same redirect_uri", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "client-test";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret-test";
    process.env.PUBLIC_BASE_URL = "https://app.departify.app";
    const org = await startOrg();

    // Step 1: authorize URL.
    const connect = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/connections/gmail/connect`,
    });
    expect(connect.statusCode).toBe(200);
    const authorizeUrl = connect.json().connection.authorizationUrl as string;
    const authorizeRedirectUri = new URL(authorizeUrl).searchParams.get(
      "redirect_uri",
    );
    expect(authorizeRedirectUri).toBe(PRODUCTION_REDIRECT_URI);

    const state = connect.json().connection.oauthState as string;

    // Step 2: intercept Google's token endpoint and capture the body.
    let capturedBody: URLSearchParams | null = null;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (
      input: string | URL,
      init?: RequestInit,
    ) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("oauth2.googleapis.com/token")) {
        if (init?.body && typeof init.body === "string") {
          capturedBody = new URLSearchParams(init.body);
        }
        return new Response(
          JSON.stringify({
            access_token: "access-1",
            refresh_token: "refresh-1",
            expires_in: 3600,
            scope: "openid email profile",
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
      if (url.includes("gmail.googleapis.com/gmail/v1/users/me/profile")) {
        return new Response(
          JSON.stringify({ emailAddress: "ceo@departify.app" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return realFetch(input, init);
    }) as unknown as typeof fetch;

    try {
      const callback = await authedInject({
        method: "POST",
        url: `/api/customer-zero/${org}/connections/gmail/callback`,
        payload: { code: "auth-code-x", state },
      });
      expect(callback.statusCode).toBe(200);

      // Step 3: assert token-exchange redirect_uri === authorize.
      expect(capturedBody).not.toBeNull();
      const tokenRedirectUri = capturedBody!.get("redirect_uri");
      expect(tokenRedirectUri).toBe(PRODUCTION_REDIRECT_URI);
      expect(tokenRedirectUri).toBe(authorizeRedirectUri);

      // Defence-in-depth: token exchange URL must NEVER contain
      // /api/customer-zero/ — Google would reject it.
      expect(tokenRedirectUri).not.toContain("/api/customer-zero/");
      expect(tokenRedirectUri).not.toContain("/connections/gmail/callback");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("P0 — defence-in-depth: NO code path may construct the legacy per-org backend callback URL", async () => {
    // The authorize URL contains the EXACT production redirect URI,
    // no per-org path. The OAuth state carries org+user+tool identity
    // through a separate nonce, never through the URL.
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
    const authorizationUrl: string = body.connection.authorizationUrl;

    // The canonical redirect URI MUST appear inside the authorize URL.
    // The authorize URL encodes the redirect_uri via URLSearchParams,
    // so we assert the decoded parameter (the URL itself does not
    // contain the literal "/connections/google/callback" — it
    // contains the URL-encoded equivalent).
    const parsed = new URL(authorizationUrl);
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      PRODUCTION_REDIRECT_URI,
    );

    // The legacy per-org backend-callback URL MUST NOT appear in any
    // production code path. If it does, the production handshake is
    // broken.
    expect(authorizationUrl).not.toMatch(/\/api\/customer-zero\//);
    expect(authorizationUrl).not.toMatch(/\/connections\/gmail\/callback/);
    expect(authorizationUrl).not.toMatch(/\/connections\/[^/?]+\/callback/);

    // State nonce registered. organizationId only travels through the
    // OAuth state store, NOT through any URL field the browser sees.
    const state: string = body.connection.oauthState;
    const record = await gmailOAuthStateStore.get(state);
    expect(record?.organizationId).toBe(org);
    expect(record?.userId).toBe("user-a");
  });

  it("P0 — `deps.publicBaseUrl` overridden = production URL overrides env", () => {
    process.env.PUBLIC_BASE_URL = "http://localhost:3000";
    // The helper should prefer the argument over the env when both are
    // provided. This is the behaviour production relies on: deps
    // wires PUBLIC_BASE_URL at process start, so the env never wins
    // inside the running process.
    expect(
      googleOAuthRedirectUri("https://app.departify.app"),
    ).toBe(PRODUCTION_REDIRECT_URI);
  });
});
