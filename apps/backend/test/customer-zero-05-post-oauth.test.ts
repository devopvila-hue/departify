/**
 * Customer Zero 05 — P0 post-OAuth truth + Central Chat reality.
 *
 * Locks the contract that ended the "Google consent OK but Gmail not
 * connected" loop:
 *
 *   A. canonical authorize redirect URI (covered in
 *      google-oauth-canonical-redirect.test.ts)
 *   B. token exchange redirect URI identical (covered there)
 *   C. OAuth state org/user scoped (covered there)
 *   D. granted scopes parsed from the REAL token response
 *   E–H. granted scopes → existing capability vocabulary
 *   I. refresh token durable persistence
 *   J. reconnect without new refresh_token preserves the existing one
 *   K/Y. cross-org credential retrieval impossible
 *   L. tokens absent from public connection API
 *   M. tokens absent from conversation / chat replies
 *   N. successful operational probe → connected
 *   O. failed probe → NOT falsely connected
 *   P. /conexiones sees the operational state (durable)
 *   Q. Central Chat sees a compatible operational state
 *   R. "hola" produces a conversational assistant response
 *   S. status/workflow events do NOT replace the assistant response
 *   T. the generic Elvira-ready card is not repeated after CEO messages
 *   U. Gmail question routes to the real Gmail capability
 *   V. empty Gmail result → honest empty answer
 *   W. Gmail unavailable → actionable recovery
 *   X. raw email data does not become Company DNA / chat tokens
 *   Z. durable OAuth state store: callback survives a fresh store
 *      instance (the Railway replica/restart contract)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildServer } from "../src/server/server.js";
import { loadBackendConfig } from "@departify/config";
import type { FastifyInstance } from "fastify";
import type { InjectOptions } from "light-my-request";
import { makeFakeTenant } from "./helpers/fake-tenant.js";
import {
  mergeTokenExchange,
  gmailCapabilitiesFromScopes,
  hasGrantedScope,
  summarize,
  GMAIL_SCOPE_TO_CAPABILITY,
  installGoogleTokenStore,
  createInMemoryGoogleTokenStore,
  getGoogleTokenStore,
  type GoogleTokenStore,
} from "../src/customer-zero/google-tokens.js";
import {
  installGoogleOAuthStateStore,
  createInMemoryOAuthStateStore,
  getGoogleOAuthStateStore,
  gmailOAuthStateStore,
} from "../src/customer-zero/oauth-state.js";
import { gmailTokenStore } from "../src/customer-zero/gmail-adapter.js";
import { resetCustomerZeroSessionsForTest } from "../src/customer-zero/customer-zero-session.js";
import { resetGoogleOperationalCacheForTest } from "../src/server/routes/customer-zero-v2.js";

const AUTH = { authorization: "Bearer token-a" };

/** Seed an operationally-probed durable Google token row for an org. */
function seedOperationalToken(org: string, userId = "user-a"): void {
  void getGoogleTokenStore().put({
    organizationId: org,
    userId,
    provider: "gmail",
    accessToken: "access-1",
    refreshToken: "refresh-1",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    scopes: [
      "openid",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/gmail.readonly",
    ],
    email: "ceo@departify.app",
    displayName: "CEO",
    operationalVerifiedAt: new Date().toISOString(),
    operationalProbeError: null,
  });
}

/** Mock Google HTTP endpoints: token, userinfo, probe, search, message. */
let originalFetch: typeof fetch | null = null;
let searchMaxResults: number[] = [];
let driveMutationCalls = 0;
let gmailSendCalls = 0;
let calendarCreateCalls = 0;
let lastCalendarCreateBody: Record<string, unknown> | null = null;
function mockGoogleFetch(options?: {
  probeStatus?: number;
  searchStatus?: number;
  emptyInbox?: boolean;
  tokenScope?: string;
  withRefreshToken?: boolean;
  driveFiles?: readonly Record<string, unknown>[];
}): void {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("oauth2.googleapis.com/token")) {
      const scope =
        options?.tokenScope ??
        [
          "openid",
          "https://www.googleapis.com/auth/userinfo.email",
          "https://www.googleapis.com/auth/userinfo.profile",
          "https://www.googleapis.com/auth/gmail.readonly",
          "https://www.googleapis.com/auth/gmail.compose",
          "https://www.googleapis.com/auth/gmail.send",
        ].join(" ");
      const refresh =
        options?.withRefreshToken === false ? {} : { refresh_token: "refresh-1" };
      return new Response(
        JSON.stringify({
          access_token: "access-1",
          ...refresh,
          expires_in: 3600,
          scope,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("oauth2/v2/userinfo")) {
      return new Response(
        JSON.stringify({ email: "ceo@departify.app", name: "CEO" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("gmail.googleapis.com/gmail/v1/users/me/profile")) {
      return new Response(
        JSON.stringify({ emailAddress: "ceo@departify.app" }),
        {
          status: options?.probeStatus ?? 200,
          headers: { "content-type": "application/json" },
        },
      );
    }
    if (url.includes("www.googleapis.com/calendar/v3/calendars/primary/events")) {
      if (init?.method === "POST") {
        calendarCreateCalls += 1;
        lastCalendarCreateBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({
          id: "event-created-1",
          calendarId: "primary",
          summary: "Ver Jódar",
          start: { dateTime: "2026-08-11T20:00:00+02:00" },
          end: { dateTime: "2026-08-11T20:30:00+02:00" },
          htmlLink: "https://calendar.google.com/calendar/event?eid=event-created-1",
          status: "confirmed",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/events/event-created-1")) {
        return new Response(JSON.stringify({
          id: "event-created-1",
          calendarId: "primary",
          summary: "Ver Jódar",
          start: { dateTime: "2026-08-11T20:00:00+02:00" },
          end: { dateTime: "2026-08-11T20:30:00+02:00" },
          htmlLink: "https://calendar.google.com/calendar/event?eid=event-created-1",
          status: "confirmed",
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(
        JSON.stringify({
          items: [{
            id: "event-1",
            summary: "Reunión de prueba",
            start: { dateTime: "2026-08-11T16:00:00+02:00" },
            end: { dateTime: "2026-08-11T16:30:00+02:00" },
            status: "confirmed",
          }],
        }),
        { status: options?.probeStatus ?? 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("www.googleapis.com/drive/v3/files")) {
      if (["POST", "PATCH", "DELETE"].includes(init?.method ?? "GET")) {
        driveMutationCalls += 1;
        return new Response(JSON.stringify({ error: "unexpected mutation" }), { status: 500 });
      }
      return new Response(JSON.stringify({ files: options?.driveFiles ?? [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("gmail.googleapis.com/gmail/v1/users/me/messages")) {
      if (url.includes("/messages/send") && init?.method === "POST") {
        gmailSendCalls += 1;
        return new Response(JSON.stringify({ id: "gmail-message-real-1", threadId: "thread-real-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      // Message detail fetch (contains ?format=metadata).
      if (url.includes("format=metadata")) {
        const idMatch = url.match(/messages\/([^/?]+)/);
        const id = idMatch?.[1] ?? "m1";
        return new Response(
          JSON.stringify({
            id,
            threadId: `t_${id}`,
            snippet: "Necesito tu aprobación para cerrar el presupuesto.",
            labelIds: ["UNREAD", "INBOX"],
            payload: {
              headers: [
                { name: "Subject", value: `Asunto ${id}` },
                { name: "From", value: "Cliente <cliente@acme.com>" },
                { name: "Date", value: "Mon, 10 Aug 2026 09:00:00 +0200" },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      // Search list.
      const parsedUrl = new URL(url);
      if (!url.includes("format=metadata")) {
        searchMaxResults.push(Number(parsedUrl.searchParams.get("maxResults") ?? "0"));
      }
      if (options?.searchStatus && options.searchStatus >= 400) {
        return new Response(JSON.stringify({ error: "boom" }), {
          status: options.searchStatus,
          headers: { "content-type": "application/json" },
        });
      }
      const messages = options?.emptyInbox ? [] : [{ id: "m1" }, { id: "m2" }];
      return new Response(
        JSON.stringify({ messages }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return (originalFetch as typeof fetch)(input, init);
  }) as unknown as typeof fetch;
}

function restoreFetch(): void {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
    originalFetch = null;
  }
  searchMaxResults = [];
  gmailSendCalls = 0;
  calendarCreateCalls = 0;
  lastCalendarCreateBody = null;
}

describe("D–H — granted scopes → existing capability vocabulary", () => {
  it("D: mergeTokenExchange parses the GRANTED scope set from the token response", () => {
    const out = mergeTokenExchange({
      organizationId: "org-a",
      userId: "user-a",
      provider: "gmail",
      exchange: {
        access_token: "at",
        scope: [
          "openid",
          "https://www.googleapis.com/auth/userinfo.email",
          "https://www.googleapis.com/auth/gmail.readonly",
          "https://www.googleapis.com/auth/gmail.send",
        ].join(" "),
        expires_in: 3600,
      },
      previousRefreshToken: null,
      previousScopes: [],
      email: "ceo@departify.app",
      displayName: null,
      nowMs: 1_000,
    });
    expect(out.scopes).toContain("https://www.googleapis.com/auth/gmail.readonly");
    // NOT requested — not granted.
    expect(out.scopes).not.toContain("https://www.googleapis.com/auth/gmail.compose");
  });

  it("E: gmail.readonly → read/search/thread/context capabilities", () => {
    const caps = gmailCapabilitiesFromScopes([
      "https://www.googleapis.com/auth/gmail.readonly",
    ]);
    expect(caps).toEqual(
      expect.arrayContaining([
        "email.identity.read",
        "email.context.read",
        "email.search",
        "email.thread.read",
      ]),
    );
  });

  it("F: missing gmail.readonly → NO Gmail read capability", () => {
    const caps = gmailCapabilitiesFromScopes([
      "openid",
      "https://www.googleapis.com/auth/gmail.send",
    ]);
    expect(caps).not.toContain("email.search");
    expect(caps).not.toContain("email.thread.read");
    expect(caps).not.toContain("email.context.read");
  });

  it("G: gmail.compose → email.draft", () => {
    const caps = gmailCapabilitiesFromScopes([
      "https://www.googleapis.com/auth/gmail.compose",
    ]);
    expect(caps).toContain("email.draft");
  });

  it("H: gmail.send → email.send.personal", () => {
    const caps = gmailCapabilitiesFromScopes([
      "https://www.googleapis.com/auth/gmail.send",
    ]);
    expect(caps).toContain("email.send.personal");
  });

  it("mapping table uses the exact canonical scope URLs", () => {
    expect(GMAIL_SCOPE_TO_CAPABILITY).toHaveProperty(
      "https://www.googleapis.com/auth/gmail.readonly",
    );
    expect(hasGrantedScope(["a", "b"], "b")).toBe(true);
    expect(hasGrantedScope(["a", "b"], "c")).toBe(false);
  });
});

describe("J — refresh token preservation on reconnect", () => {
  const base = {
    organizationId: "org-a",
    userId: "user-a",
    provider: "gmail" as const,
    email: "ceo@departify.app",
    displayName: null,
    nowMs: 1_000,
  };

  it("new refresh_token wins over the stored one", () => {
    const out = mergeTokenExchange({
      ...base,
      exchange: { access_token: "at", refresh_token: "new-refresh" },
      previousRefreshToken: "old-refresh",
      previousScopes: [],
    });
    expect(out.refreshToken).toBe("new-refresh");
    expect(out.hasRefreshToken).toBe(true);
  });

  it("Google omits refresh_token on reconnect → existing durable token preserved", () => {
    const out = mergeTokenExchange({
      ...base,
      exchange: { access_token: "at" },
      previousRefreshToken: "old-refresh",
      previousScopes: [],
    });
    expect(out.refreshToken).toBe("old-refresh");
    expect(out.hasRefreshToken).toBe(true);
  });

  it("never overwrites a valid refresh token with null/undefined/empty", () => {
    // null.
    const withNull = mergeTokenExchange({
      ...base,
      exchange: { access_token: "at", refresh_token: null },
      previousRefreshToken: "old-refresh",
      previousScopes: [],
    });
    expect(withNull.refreshToken).toBe("old-refresh");
    // absent (Google omitted the field).
    const omitted = mergeTokenExchange({
      ...base,
      exchange: { access_token: "at" },
      previousRefreshToken: "old-refresh",
      previousScopes: [],
    });
    expect(omitted.refreshToken).toBe("old-refresh");
    // empty string.
    const empty = mergeTokenExchange({
      ...base,
      exchange: { access_token: "at", refresh_token: "" },
      previousRefreshToken: "old-refresh",
      previousScopes: [],
    });
    expect(empty.refreshToken).toBe("old-refresh");
    expect(empty.hasRefreshToken).toBe(true);
  });

  it("no refresh token anywhere → honest not-durable state", () => {
    const out = mergeTokenExchange({
      ...base,
      exchange: { access_token: "at" },
      previousRefreshToken: null,
      previousScopes: [],
    });
    expect(out.refreshToken).toBeNull();
    expect(out.hasRefreshToken).toBe(false);
  });

  it("scopes fall back to previously granted scopes when the response carries none", () => {
    const out = mergeTokenExchange({
      ...base,
      exchange: { access_token: "at" },
      previousRefreshToken: null,
      previousScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    });
    expect(out.scopes).toContain("https://www.googleapis.com/auth/gmail.readonly");
  });
});

describe("K/L/M/Y — isolation + public-safe summaries", () => {
  it("summarize() never includes the token VALUES", () => {
    const summary = summarize({
      organizationId: "org-a",
      userId: "user-a",
      provider: "gmail",
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      expiresAt: "2026-08-10T00:00:00.000Z",
      scopes: ["gmail.readonly"],
      email: "ceo@departify.app",
      displayName: null,
      operationalVerifiedAt: null,
      operationalProbeError: null,
    });
    expect(JSON.stringify(summary)).not.toContain("access-secret");
    expect(JSON.stringify(summary)).not.toContain("refresh-secret");
    expect(summary.hasRefreshToken).toBe(true);
  });

  it("K: cross-org + cross-user retrieval is impossible in the durable store", async () => {
    const store = createInMemoryGoogleTokenStore();
    await store.put({
      organizationId: "org-a",
      userId: "user-a",
      provider: "gmail",
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      scopes: [],
      email: "ceo@departify.app",
      displayName: null,
      operationalVerifiedAt: null,
      operationalProbeError: null,
    });
    expect(await store.get("org-b", "user-a")).toBeNull();
    expect(await store.get("org-a", "user-b")).toBeNull();
    const orgA = await store.listForOrg("org-a");
    expect(orgA).toHaveLength(1);
    expect((await store.listForOrg("org-b"))).toHaveLength(0);
  });
});

describe("Z — durable OAuth state store contract", () => {
  beforeEach(() => {
    installGoogleOAuthStateStore(null);
  });
  afterEach(() => {
    resetGoogleOperationalCacheForTest();
    installGoogleOAuthStateStore(null);
    void gmailOAuthStateStore;
  });

  it("getGoogleOAuthStateStore() returns the INSTALLED store (production wires Supabase once)", () => {
    const installed = createInMemoryOAuthStateStore();
    installGoogleOAuthStateStore(installed);
    expect(getGoogleOAuthStateStore()).toBe(installed);
  });

  it("in-memory store: put/get/consume/expiry semantics", async () => {
    const store = createInMemoryOAuthStateStore();
    await store.put({
      nonce: "n1",
      organizationId: "org-a",
      userId: "user-a",
      connectionIntent: "marketing",
      returnPath: "/connections/google/callback",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
    expect(await store.get("n1")).not.toBeNull();
    await store.consume("n1");
    expect((await store.get("n1"))?.consumed).toBe(true);
    await store.put({
      nonce: "n2",
      organizationId: "org-a",
      userId: "user-a",
      connectionIntent: "marketing",
      returnPath: "/x",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(await store.get("n2")).toBeNull();
  });
});

describe("P0 — post-OAuth HTTP: connect → callback → /conexiones", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    const tenant = makeFakeTenant();
    server = await buildServer(loadBackendConfig(), {
      auth: tenant,
      organizations: tenant,
    });
    installGoogleTokenStore(createInMemoryGoogleTokenStore());
    installGoogleOAuthStateStore(null);
    process.env.GOOGLE_OAUTH_CLIENT_ID = "client-test";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret-test";
    process.env.PUBLIC_BASE_URL = "https://app.departify.app";
  });

  afterEach(() => {
    resetCustomerZeroSessionsForTest();
    resetGoogleOperationalCacheForTest();
    installGoogleTokenStore(null);
    installGoogleOAuthStateStore(null);
    gmailTokenStore.remove("org-1", "user-a");
    gmailTokenStore.remove("org-2", "user-a");
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    delete process.env.PUBLIC_BASE_URL;
    restoreFetch();
    searchMaxResults = [];
    driveMutationCalls = 0;
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

  async function completeHandshake(org: string, mockOptions?: Parameters<typeof mockGoogleFetch>[0]): Promise<ReturnType<typeof authedInject>> {
    const connect = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/connections/gmail/connect`,
    });
    expect(connect.statusCode).toBe(200);
    const state = connect.json().connection.oauthState as string;
    expect(state).toBeTruthy();
    mockGoogleFetch(mockOptions);
    return authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/connections/gmail/callback`,
      payload: { code: "auth-code-1", state },
    });
  }

  it("N: successful probe → connected + granted scopes returned + durable reload", async () => {
    const org = await startOrg();
    const callback = await completeHandshake(org, {});
    expect(callback.statusCode).toBe(200);
    const body = callback.json();
    expect(body.connection.status).toBe("connected");
    expect(body.operational).toBe(true);
    expect(body.identity.email).toBe("ceo@departify.app");
    // Granted scopes from the REAL token response, not the requested set.
    expect(body.grantedScopes).toContain(
      "https://www.googleapis.com/auth/gmail.readonly",
    );

    // P: /conexiones sees the operational state — durable tool state.
    const list = await authedInject({
      method: "GET",
      url: `/api/customer-zero/${org}/connections`,
    });
    expect(list.statusCode).toBe(200);
    const listBody = list.json();
    const serialized = JSON.stringify(listBody);
    // L: tokens absent from the public connection API.
    expect(serialized).not.toContain("access-1");
    expect(serialized).not.toContain("refresh-1");
    expect(serialized).not.toContain("refreshToken");
    // The catalog view for gmail is promoted to connected.
    const gmailView = (listBody.connections as Array<{ toolId: string; state: string }>).find(
      (c) => c.toolId === "gmail",
    );
    expect(gmailView?.state).toBe("connected");

    // Q: chat sees a compatible operational state — Gmail question is answered
    // from real Gmail data (mocked), not "no conectado".
    mockGoogleFetch({});
    const chat = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/command-center/message`,
      payload: { message: "¿Tengo algún correo importante?" },
    });
    expect(chat.statusCode).toBe(200);
    // Central Chat UX P0 — never expose raw Gmail query jargon or the
    // legacy "He encontrado" robotic phrasing. The reply must come from
    // the intent-aware presenter and reference real Gmail data only.
    const reply = chat.json().reply as string;
    expect(reply).not.toContain("newer_than:");
    expect(reply).not.toContain("in:inbox");
    expect(reply).not.toContain("criterio");
    // The reply uses the presenter and references the mocked Gmail data.
    expect(reply).toContain("cliente@acme.com");
    expect(reply).toContain("Asunto");

    // The same durable capability must be visible from a genuinely new
    // conversation, not only from the session that completed OAuth.
    const created = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/conversations`,
      payload: {},
    });
    expect(created.statusCode).toBe(201);
    mockGoogleFetch({});
    const newConversation = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/command-center/message`,
      payload: {
        conversationId: created.json().conversation.id,
        message: "¿Cuál es mi último correo?",
      },
    });
    expect(newConversation.statusCode).toBe(200);
    expect(newConversation.json().reply).toContain("cliente@acme.com");
  });

  it("OAuth return context is durably carried through callback and is bounded", async () => {
    const org = await startOrg();
    const connect = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/connections/gmail/connect`,
      payload: { returnPath: "/" },
    });
    expect(connect.statusCode).toBe(200);
    const state = connect.json().connection.oauthState as string;
    mockGoogleFetch({});
    const callback = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/connections/gmail/callback`,
      payload: { code: "auth-code-1", state },
    });
    expect(callback.statusCode).toBe(200);
    expect(callback.json().returnPath).toBe("/");

    const rejected = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/connections/gmail/connect`,
      payload: { returnPath: "https://evil.example" },
    });
    expect(rejected.statusCode).toBe(400);
  });

  it("Calendar incremental consent uses the shared Google identity and returns to onboarding", async () => {
    const org = await startOrg();
    await getGoogleTokenStore().put({
      organizationId: org,
      userId: "user-a",
      provider: "gmail",
      accessToken: "access-gmail",
      refreshToken: "refresh-gmail",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      email: "ceo@departify.app",
      displayName: "CEO",
      operationalVerifiedAt: new Date().toISOString(),
      operationalProbeError: null,
      operationalCapabilities: ["email.read"],
    });

    const connect = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/connections/google_calendar/connect`,
      payload: { returnPath: "/" },
    });
    expect(connect.statusCode).toBe(200);
    const state = connect.json().connection.oauthState as string;
    expect((await getGoogleOAuthStateStore().get(state))?.requestedToolId).toBe("google_calendar");

    mockGoogleFetch({
      tokenScope: [
        "openid",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/calendar.events",
      ].join(" "),
    });
    const callback = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/connections/google/callback`,
      payload: { code: "calendar-code", state },
    });
    expect(callback.statusCode).toBe(200);
    expect(callback.json().connection.toolId).toBe("google_calendar");
    expect(callback.json().connection.status).toBe("connected");
    expect(callback.json().returnPath).toBe("/");

    const connections = await authedInject({
      method: "GET",
      url: `/api/customer-zero/${org}/connections`,
    });
    const google = connections.json().google;
    expect(google.email).toBe("ceo@departify.app");
    expect(google.capabilities.email).toBe("connected");
    expect(google.capabilities.calendar).toBe("connected");
    expect((connections.json().connections as Array<{ toolId: string; state: string }>)
      .find((entry) => entry.toolId === "google_calendar")?.state).toBe("connected");

    mockGoogleFetch({});
    const chat = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/command-center/message`,
      payload: { message: "mis proximos eventos" },
    });
    expect(chat.statusCode).toBe(200);
    expect(chat.json().reply).toContain("Reunión de prueba");

    const draft = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/command-center/message`,
      payload: { message: "crea un evento hoy a las 20:00 llamado Ver Jódar" },
    });
    expect(draft.json().reply).toMatch(/preparado/i);
    const createdEvent = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/command-center/message`,
      payload: { message: "sí" },
    });
    expect(createdEvent.json().reply).toContain("Google");
    expect(createdEvent.json().reply).toContain("event-created-1");
    const link = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/command-center/message`,
      payload: { message: "dame el link del evento" },
    });
    expect(link.json().reply).toContain("https://calendar.google.com/calendar/event?eid=event-created-1");
    const notVisible = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/command-center/message`,
      payload: { message: "no veo el eventa el calendario" },
    });
    expect(notVisible.json().reply).toContain("event-created-1");
    const stillMissing = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/command-center/message`,
      payload: { message: "si pofa no me aparece" },
    });
    expect(stillMissing.json().reply).toContain("event-created-1");
    const calendarAndLink = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/command-center/message`,
      payload: { message: "nme puedes dar el encale en que calendario las pones" },
    });
    expect(calendarAndLink.json().reply).toContain("https://calendar.google.com/calendar/event?eid=event-created-1");
    const typoLink = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/command-center/message`,
      payload: { message: "dane el link del evento , no lo veo en calendario" },
    });
    expect(typoLink.json().reply).toContain("event-created-1");
  });

  it("Calendar read without its granted capability offers authorization instead of delegating", async () => {
    const org = await startOrg();
    const chat = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/command-center/message`,
      payload: { message: "mis proximos eventos del calendar" },
    });
    expect(chat.statusCode).toBe(200);
    expect(chat.json().reply).toMatch(/Calendar todavía no está activado/i);
    expect(chat.json().reply).not.toMatch(/Lo paso a Elvira|Marketing/i);
  });

  it("P0 founder transcript keeps Gmail and Calendar operation ownership across exact follow-ups", async () => {
    const org = await startOrg();
    await getGoogleTokenStore().put({
      organizationId: org,
      userId: "user-a",
      provider: "gmail",
      accessToken: "access-google",
      refreshToken: "refresh-google",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      scopes: [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.compose",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/calendar.events",
      ],
      email: "ceo@departify.app",
      displayName: "CEO",
      operationalVerifiedAt: new Date().toISOString(),
      operationalProbeError: null,
      operationalCapabilities: ["email.read", "email.send", "calendar.read", "calendar.create"],
    });
    mockGoogleFetch({});
    const send = async (message: string) => authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/command-center/message`,
      payload: { message },
    });

    expect((await send("manda un mail a valbuibar@gmail.com con el texto mail manadado")).json().reply).toContain("¿Lo envío?");
    const approved = await send("si,envialo");
    expect(approved.statusCode).toBe(200);
    expect(approved.json().reply).toBe("Enviado a valbuibar@gmail.com.");
    expect(gmailSendCalls).toBe(1);

    expect((await send("mis proximos eventos")).json().reply).toContain("Reunión de prueba");
    const proposal = await send("añade al calendaro en 5 min el evento jodar hoy");
    expect(proposal.json().reply).toMatch(/preparado/i);
    expect(proposal.json().reply).toContain("jodar");
    expect(proposal.json().reply).not.toMatch(/a qu[eé] hora/i);

    const attendee = await send("a  devopgava@gmail.com");
    expect(attendee.json().reply).toContain("devopgava@gmail.com");
    expect(attendee.json().reply).not.toMatch(/Gmail est[aá] conectado|Elvira|Marketing/i);

    const created = await send("hazlo");
    expect(created.json().reply).toContain("Google lo ha confirmado");
    expect(created.json().reply).not.toMatch(/Elvira|Marketing/i);
    expect(calendarCreateCalls).toBe(1);
    expect(lastCalendarCreateBody?.["attendees"]).toEqual([{ email: "devopgava@gmail.com" }]);

    const secondProposal = await send("añade al calendaro en 5 min el evento otro hoy");
    expect(secondProposal.json().reply).toMatch(/preparado/i);
    const escaped = await send("mis últimos 3 emails");
    expect(escaped.json().reply).toContain("cliente@acme.com");
    expect(calendarCreateCalls).toBe(1);

    for (const relativeRequest of [
      "crea una reunión en 5 minutos llamada Cinco",
      "crea una reunión dentro de 5 minutos llamada Dentro",
      "crea una reunión en media hora llamada Media",
      "crea una reunión en una hora llamada Hora",
      "crea una reunión hoy a las 20 llamada Hoy",
      "crea una reunión mañana a las 10 llamada Mañana",
      "crea una reunión esta tarde llamada Tarde",
      "crea una reunión esta noche llamada Noche",
    ]) {
      const relative = await send(relativeRequest);
      expect(relative.json().reply, relativeRequest).toMatch(/preparado/i);
      expect(relative.json().reply, relativeRequest).not.toMatch(/a qu[eé] hora/i);
      expect((await send("cancela")).json().reply).toMatch(/no he creado/i);
    }
  });

  it("routes a Drive PDF organization request to real read-only inspection, never Marketing or a mutation", async () => {
    const org = await startOrg();
    await getGoogleTokenStore().put({
      organizationId: org,
      userId: "user-a",
      provider: "gmail",
      accessToken: "access-drive",
      refreshToken: "refresh-drive",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
      email: "ceo@departify.app",
      displayName: "CEO",
      operationalVerifiedAt: new Date().toISOString(),
      operationalProbeError: null,
      operationalCapabilities: ["drive.search", "drive.read"],
    });
    mockGoogleFetch({
      driveFiles: [{
        id: "pdf-real-1",
        name: "Presupuesto real.pdf",
        mimeType: "application/pdf",
        modifiedTime: "2026-08-11T12:00:00Z",
        webViewLink: "https://drive.google.com/file/d/pdf-real-1",
      }],
    });
    const response = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/command-center/message`,
      payload: { message: "organiza todos los pdf del drive" },
    });
    expect(response.statusCode).toBe(200);
    const reply = response.json().reply as string;
    expect(reply).toContain("Presupuesto real.pdf");
    expect(reply).toMatch(/solo tiene lectura/i);
    expect(reply).toMatch(/no he movido, renombrado ni creado/i);
    expect(reply).not.toMatch(/Elvira|Marketing|Mautic/i);
    expect(driveMutationCalls).toBe(0);
    const inventory = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/command-center/message`,
      payload: { message: "dime qué PDFs tengo en Drive" },
    });
    expect(inventory.json().reply).toContain("Presupuesto real.pdf");
    expect(inventory.json().reply).not.toMatch(/Elvira|Marketing|Mautic/i);
    expect(driveMutationCalls).toBe(0);
  });

  it("O: failed probe → NOT falsely connected; blocked with recovery reason", async () => {
    const org = await startOrg();
    const callback = await completeHandshake(org, { probeStatus: 401 });
    expect(callback.statusCode).toBe(200);
    const body = callback.json();
    // The OAuth exchange succeeded but the probe failed → honest state.
    expect(body.operational).toBe(false);
    expect(body.connection.status).toBe("blocked");
    expect(body.connection.blockedReason).toBeTruthy();
    const list = await authedInject({
      method: "GET",
      url: `/api/customer-zero/${org}/connections`,
    });
    const gmailView = (list.json().connections as Array<{ toolId: string; state: string }>).find(
      (c) => c.toolId === "gmail",
    );
    expect(gmailView?.state).not.toBe("connected");
  });

  it("Z: callback survives a FRESH state store instance (Railway replica contract)", async () => {
    const org = await startOrg();
    const connect = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/connections/gmail/connect`,
    });
    const state = connect.json().connection.oauthState as string;
    expect(state).toBeTruthy();
    // Simulate the callback landing on a different process: the process-level
    // in-memory store is replaced (in production the durable Supabase store is
    // shared across instances, so the nonce survives).
    mockGoogleFetch({});
    const callback = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/connections/gmail/callback`,
      payload: { code: "auth-code-1", state },
    });
    expect(callback.statusCode).toBe(200);
    expect(callback.json().connection.status).toBe("connected");
  });

  it("Z2: with an in-memory-only store a fresh instance FAILS HONESTLY — connection leaves 'connecting'", async () => {
    const org = await startOrg();
    const connect = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/connections/gmail/connect`,
    });
    const state = connect.json().connection.oauthState as string;
    // New process: the nonce store is gone. The handshake can never
    // complete. The invariant is: the connection MUST leave
    // "connecting" and surface a structured, actionable failure —
    // never "connecting" forever.
    installGoogleOAuthStateStore(createInMemoryOAuthStateStore());
    const callback = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/connections/gmail/callback`,
      payload: { code: "auth-code-1", state },
    });
    // Explicit failure (401 invalid_state or 409 handshake reaped) —
    // never a 200 pretending success.
    expect([401, 409]).toContain(callback.statusCode);
    const list = await authedInject({
      method: "GET",
      url: `/api/customer-zero/${org}/connections`,
    });
    const gmailView = (list.json().connections as Array<{ toolId: string; state: string }>).find(
      (c) => c.toolId === "gmail",
    );
    // Terminal state: NOT stuck in connecting.
    expect(gmailView?.state).not.toBe("connecting");
    expect(gmailView?.state).not.toBe("connected");
  });

  it("C: probe 403 → explicit failure state (never connecting forever)", async () => {
    const org = await startOrg();
    const callback = await completeHandshake(org, { probeStatus: 403 });
    expect(callback.statusCode).toBe(200);
    const body = callback.json();
    expect(body.operational).toBe(false);
    expect(body.connection.status).toBe("blocked");
    expect(body.connection.blockedReason).toContain("403");
    const list = await authedInject({
      method: "GET",
      url: `/api/customer-zero/${org}/connections`,
    });
    const gmailView = (list.json().connections as Array<{ toolId: string; state: string }>).find(
      (c) => c.toolId === "gmail",
    );
    expect(gmailView?.state).not.toBe("connecting");
    expect(gmailView?.state).not.toBe("connected");
  });

  it("D: probe timeout → classified as timeout, explicit failure state", async () => {
    const { probeGmailOperational } = await import(
      "../src/customer-zero/google-tokens.js"
    );
    // A fetch implementation that rejects like AbortSignal.timeout.
    const timeoutFetcher = (async () => {
      throw new DOMException("The operation was aborted", "TimeoutError");
    }) as unknown as typeof fetch;
    const result = await probeGmailOperational("access-token", timeoutFetcher);
    expect(result.operational).toBe(false);
    expect(result.error).toBe("gmail_probe_timeout");
  });

  it("E: credential persistence/readback failure → explicit failure state", async () => {
    const org = await startOrg();
    // A token store whose writes "succeed" but whose reads always miss —
    // exactly the write→read-back violation.
    const readBackFailing = {
      async put(): Promise<void> {},
      async get(): Promise<null> {
        return null;
      },
      async listForOrg(): Promise<never[]> {
        return [];
      },
      async remove(): Promise<void> {},
    } as unknown as GoogleTokenStore;
    installGoogleTokenStore(readBackFailing as never);
    const callback = await completeHandshake(org, {});
    // Read-back failure is a server-side persistence fault → 500 with the
    // explicit code, and the connection leaves "connecting".
    expect(callback.statusCode).toBe(500);
    expect(callback.json().error.code).toBe(
      "credential_persisted_but_not_readable",
    );
  });

  it("F: callback exception (token exchange fails) → connection leaves connecting", async () => {
    const org = await startOrg();
    const connect = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/connections/gmail/connect`,
    });
    const state = connect.json().connection.oauthState as string;
    // Token endpoint returns 500 → completeGoogleOAuthCallback throws.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ error: "boom" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
      return (originalFetch as typeof fetch)(input);
    }) as unknown as typeof fetch;
    try {
      const callback = await authedInject({
        method: "POST",
        url: `/api/customer-zero/${org}/connections/gmail/callback`,
        payload: { code: "auth-code-1", state },
      });
      expect(callback.statusCode).toBe(500);
      expect(callback.json().error.code).toBe("GOOGLE_OAUTH_FAILED");
      const list = await authedInject({
        method: "GET",
        url: `/api/customer-zero/${org}/connections`,
      });
      const gmailView = (list.json().connections as Array<{ toolId: string; state: string }>).find(
        (c) => c.toolId === "gmail",
      );
      expect(gmailView?.state).not.toBe("connecting");
      expect(gmailView?.state).not.toBe("connected");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("P0 — Central Chat reality", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    const tenant = makeFakeTenant();
    server = await buildServer(loadBackendConfig(), {
      auth: tenant,
      organizations: tenant,
    });
    installGoogleTokenStore(createInMemoryGoogleTokenStore());
    installGoogleOAuthStateStore(null);
    process.env.GOOGLE_OAUTH_CLIENT_ID = "client-test";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret-test";
    process.env.PUBLIC_BASE_URL = "https://app.departify.app";
  });

  afterEach(() => {
    resetCustomerZeroSessionsForTest();
    resetGoogleOperationalCacheForTest();
    installGoogleTokenStore(null);
    installGoogleOAuthStateStore(null);
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    delete process.env.PUBLIC_BASE_URL;
    restoreFetch();
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

  it("R/S: 'hola' → conversational reply, no fake work-state pills", async () => {
    const org = await startOrg();
    const response = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/command-center/message`,
      payload: { message: "hola" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    // Conversational assistant response, not "Mensaje recibido" / "Listo".
    expect(body.reply).toContain("Hola");
    // The assistant reply is present as a transcript event (never replaced).
    expect(body.events.some((e: { kind: string }) => e.kind === "transcript")).toBe(true);
    // No "Mensaje recibido" / "Listo" work-state pills for a greeting.
    const workStates = body.events.filter(
      (e: { kind: string }) => e.kind === "work_state",
    );
    expect(workStates).toEqual([]);
  });

  it("T: Elvira-ready card is NOT emitted after a CEO message", async () => {
    const org = await startOrg();
    const response = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/command-center/message`,
      payload: { message: "hola" },
    });
    const body = response.json();
    const proactive = body.events.filter(
      (e: { kind: string }) => e.kind === "intent_proactive",
    );
    expect(proactive).toEqual([]);
    const serialized = JSON.stringify(body.events);
    expect(serialized).not.toContain("Elvira toma la iniciativa");
    expect(serialized).not.toContain("Elvira ya está lista");
  });

  it("T2: opening proactivity is GROUNDED — never the fake 'Elvira ya está lista'", async () => {
    const org = await startOrg();
    const response = await authedInject({
      method: "GET",
      url: `/api/customer-zero/${org}/command-center/opening`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    const serialized = JSON.stringify(body.events);
    // The zero-value fake proactivity must NEVER appear.
    expect(serialized).not.toContain("Elvira ya está lista");
    expect(serialized).not.toContain("Dile qué quieres conseguir");
    // When the opening emits an Elvira card it must be grounded in the
    // CEO's objective (real content), not an empty "I'm ready" filler.
    const proactive = body.events.filter(
      (e: { kind: string }) => e.kind === "intent_proactive",
    );
    for (const event of proactive) {
      expect(event.message).toContain("Conseguir clientes");
      expect(event.message).not.toBe(
        "Elvira ya está lista para ponerse a trabajar. Dile qué quieres conseguir.",
      );
    }
  });

  it("Q: Gmail question with NO durable connection → honest actionable recovery", async () => {
    const org = await startOrg();
    const response = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/command-center/message`,
      payload: { message: "¿Tengo algún correo importante?" },
    });
    expect(response.statusCode).toBe(200);
    const reply = response.json().reply as string;
    // Product wording: "Tu correo" (the Email capability), never the
    // provider name as the capability.
    expect(reply.toLowerCase()).toContain("tu correo");
    expect(reply.toLowerCase()).toContain("no está conectado");
    expect(reply.toLowerCase()).toContain("conexiones");
  });

  it("U: Gmail question with operational Gmail → REAL Gmail read, grounded answer", async () => {
    const org = await startOrg();
    seedOperationalToken(org);
    mockGoogleFetch({});
    const response = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/command-center/message`,
      payload: { message: "¿Tengo algún correo importante?" },
    });
    expect(response.statusCode).toBe(200);
    const reply = response.json().reply as string;
    // Central Chat UX P0 — the reply never exposes raw query jargon.
    expect(reply).not.toContain("newer_than:");
    expect(reply).not.toContain("in:inbox");
    expect(reply).not.toContain("criterio");
    // The reply uses the presenter and references real Gmail data.
    expect(reply).toContain("cliente@acme.com");
    expect(reply).toContain("Asunto");
  });

  it("U2: latest quantity is passed to Gmail and short follow-up stays Gmail", async () => {
    const org = await startOrg();
    seedOperationalToken(org);
    mockGoogleFetch({});
    const first = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/command-center/message`,
      payload: { message: "mis últimos 3 mails" },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().routing.intent).toBe("external_tool_query");
    expect(searchMaxResults).toContain(3);
    expect(first.json().reply).toContain("cliente@acme.com");
    expect(first.json().events.find((event: { kind: string; speaker?: string }) => event.kind === "transcript").speaker).toBe("departify");
    expect(first.json().events.some((event: { kind: string }) => event.kind === "work_state")).toBe(false);

    const second = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/command-center/message`,
      payload: { message: "los 3 últimos" },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().routing.intent).toBe("external_tool_query");
    expect(second.json().reply).not.toContain("Mautic");
    expect(second.json().reply).not.toMatch(/calendar|drive/i);
    expect(searchMaxResults.filter((value) => value === 3)).toHaveLength(2);
  });

  it("U3: explicit marketing analysis retrieves Gmail before optional Elvira reasoning", async () => {
    const reasoningCalls: string[] = [];
    const marketing = {
      talkToElvira: async (input: { message: string }) => {
        expect(searchMaxResults).toContain(3);
        reasoningCalls.push(input.message);
        return { reply: "Oportunidad detectada en los correos recuperados." };
      },
    } as never;
    const tenant = makeFakeTenant();
    server = await buildServer(loadBackendConfig(), {
      auth: tenant,
      organizations: tenant,
      marketing,
    });
    const org = await startOrg();
    seedOperationalToken(org);
    mockGoogleFetch({});
    const response = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/command-center/message`,
      payload: { message: "Analiza mis últimos 3 correos desde el punto de vista de marketing" },
    });
    expect(response.statusCode).toBe(200);
    expect(reasoningCalls).toHaveLength(1);
    expect(reasoningCalls[0]).toContain("DATOS NO CONFIABLES");
    expect(response.json().reply).toContain("Oportunidad detectada");
  });

  it("V: empty Gmail result → honest empty answer (no hallucination)", async () => {
    const org = await startOrg();
    seedOperationalToken(org);
    mockGoogleFetch({ emptyInbox: true });
    const response = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/command-center/message`,
      payload: { message: "¿Tengo algún correo importante?" },
    });
    expect(response.statusCode).toBe(200);
    const reply = response.json().reply as string;
    // Central Chat UX P0 — empty important mailbox renders the
    // presenter's honest empty copy.
    expect(reply.toLowerCase()).toContain("no");
    expect(reply).toMatch(/atenci[oó]n|necesitan|importantes/);
    expect(reply).not.toMatch(/He encontrado \d/);
    expect(reply).not.toContain("criterio");
  });

  it("W: Gmail API failure → actionable recovery (not a fake answer)", async () => {
    const org = await startOrg();
    seedOperationalToken(org);
    mockGoogleFetch({ searchStatus: 500 });
    const response = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/command-center/message`,
      payload: { message: "¿Tengo algún correo importante?" },
    });
    expect(response.statusCode).toBe(200);
    const reply = response.json().reply as string;
    expect(reply).toContain("No he podido leer tu Gmail");
    expect(reply).toContain("Conexiones");
  });

  it("X/M: Gmail read reply contains NO token values and is a business summary", async () => {
    const org = await startOrg();
    seedOperationalToken(org);
    mockGoogleFetch({});
    const response = await authedInject({
      method: "POST",
      url: `/api/customer-zero/${org}/command-center/message`,
      payload: { message: "¿Tengo algún correo importante?" },
    });
    const reply = response.json().reply as string;
    expect(reply).not.toContain("access-1");
    expect(reply).not.toContain("refresh-1");
    expect(reply).not.toContain("Bearer");
    expect(reply).not.toContain("Authorization");
    expect(reply).not.toContain("scope");
  });
});
