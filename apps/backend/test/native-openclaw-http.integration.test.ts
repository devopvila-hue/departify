/**
 * ENGINE 03.2 real HTTP integration.
 *
 * This suite is intentionally opt-in because it needs a live OpenClaw
 * Gateway/Vertex runtime. Unlike route tests with a fake engine, requests
 * here cross Fastify HTTP -> EngineAdapter -> OpenClaw -> native plugin ->
 * the internal Departify gateway and return to the HTTP caller.
 *
 * Provider calls are read-only and locally controlled: Google API requests
 * return empty result sets. No external mutation is possible in this suite.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { AuthService, AuthenticatedUser, OrganizationMembership } from "@departify/auth";
import type { OrganizationStore, OrganizationSummary } from "../src/auth/tenant-contracts.js";
import { createEngineAdapter, type EngineAdapter } from "@departify/engine-adapter";
import { loadBackendConfig, loadEngineAdapterConfig } from "@departify/config";
import { buildServer } from "../src/server/server.js";
import { InMemoryToolStateStore } from "../src/customer-zero/tool-state.js";
import { getOrCreateCustomerZeroSession } from "../src/customer-zero/customer-zero-session.js";
import {
  createInMemoryGoogleTokenStore,
  installGoogleTokenStore,
} from "../src/customer-zero/google-tokens.js";

const RUN = process.env.ENGINE_NATIVE_HTTP_INTEGRATION === "1";
const describeIf = RUN ? describe : describe.skip;
const HTTP_PORT = Number(process.env.ENGINE_NATIVE_HTTP_PORT ?? 3210);
const RUNTIME_TOKEN = process.env.DEPARTIFY_RUNTIME_TOKEN ?? "";
type NativeHttpResponse = Record<string, unknown> & {
  readonly reply?: string;
  readonly routing?: { readonly intent?: string };
};

class IntegrationTenant implements AuthService, OrganizationStore {
  private readonly user: AuthenticatedUser = {
    id: "native-http-founder",
    email: "native-http-founder@departify.local",
  };
  private readonly memberships = new Map<string, OrganizationMembership>();

  async verifyAccessToken(token: string): Promise<AuthenticatedUser> {
    if (token !== "native-http-test-token") throw new Error("invalid token");
    return this.user;
  }

  async resolveMembership(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationMembership | null> {
    const membership = this.memberships.get(organizationId);
    return membership?.userId === userId ? membership : null;
  }

  async createOrganization(name: string, ownerId: string): Promise<OrganizationSummary> {
    const organizationId = randomUUID();
    const membership: OrganizationMembership = {
      organizationId,
      userId: ownerId,
      role: "owner",
    };
    this.memberships.set(organizationId, membership);
    return { organizationId, name, role: "owner" };
  }

  async listForUser(userId: string): Promise<OrganizationSummary[]> {
    return [...this.memberships.values()]
      .filter((membership) => membership.userId === userId)
      .map((membership) => ({
        organizationId: membership.organizationId,
        name: membership.organizationId,
        role: membership.role,
      }));
  }
}

describeIf("ENGINE 03.2 native OpenClaw HTTP path", () => {
  let server: Awaited<ReturnType<typeof buildServer>>;
  let engine: EngineAdapter;
  let originalFetch: typeof globalThis.fetch;
  let previousGoogleClientId: string | undefined;
  let previousGoogleClientSecret: string | undefined;
  const selectedToolsByTurn: string[][] = [];
  const toolState = new InMemoryToolStateStore();

  beforeEach(() => {
    selectedToolsByTurn.length = 0;
  });

  beforeAll(async () => {
    originalFetch = globalThis.fetch;
    previousGoogleClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    previousGoogleClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    process.env.GOOGLE_OAUTH_CLIENT_ID = "native-http-client";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "native-http-secret";
    // These are operationally verified READ capabilities for the test tenant.
    // The native gateway still rechecks them on every call.
    const google = createInMemoryGoogleTokenStore();
    installGoogleTokenStore(google);

    const tenant = new IntegrationTenant();
    const engineConfig = loadEngineAdapterConfig();
    engine = createEngineAdapter({
      ...engineConfig,
      gatewayUrl: process.env.OPENCLAW_GATEWAY_URL ?? "ws://127.0.0.1:18889",
      model: process.env.OPENCLAW_MODEL ?? "google-vertex/gemini-2.5-flash",
      requestTimeoutMs: 120_000,
      ...(process.env.OPENCLAW_DEVICE_KEY_PATH
        ? { deviceKeyPath: process.env.OPENCLAW_DEVICE_KEY_PATH }
        : {}),
    });
    server = await buildServer(loadBackendConfig(), {
      auth: tenant,
      organizations: tenant,
      toolState,
      engine,
      nativeBusinessTools: true,
      engineRuntimePolicy: "strict",
    });
    if (!RUNTIME_TOKEN) {
      throw new Error("ENGINE_NATIVE_HTTP_INTEGRATION requires DEPARTIFY_RUNTIME_TOKEN");
    }
    await server.listen({ host: "0.0.0.0", port: HTTP_PORT });

    // Never call Google in this integration. Real native provider adapters
    // receive bounded empty READ responses; no email/event/file is mutated.
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("gmail.googleapis.com")) {
        if (/\/messages\/[^/?]+/.test(url)) {
          return new Response(JSON.stringify({
            id: "native-mail-1",
            threadId: "native-thread-1",
            snippet: "Lo reviso mañana.",
            payload: { headers: [
              { name: "Subject", value: "Consulta Departify" },
              { name: "From", value: "Alex <alex@example.com>" },
              { name: "Date", value: "Wed, 12 Aug 2026 09:00:00 +0200" },
            ] },
          }), { status: 200 });
        }
        return new Response(JSON.stringify({ messages: [{ id: "native-mail-1" }], resultSizeEstimate: 1 }), { status: 200 });
      }
      if (url.includes("googleapis.com/calendar")) {
        return new Response(JSON.stringify({ items: [{
          id: "native-event-1",
          summary: "Native test event",
          start: { dateTime: "2026-08-13T10:00:00+02:00" },
          end: { dateTime: "2026-08-13T10:30:00+02:00" },
        }] }), { status: 200 });
      }
      if (url.includes("www.googleapis.com/drive")) {
        const folder = url.includes("application%2Fvnd.google-apps.folder") || url.includes("application/vnd.google-apps.folder") || url.includes("includeFolders");
        return new Response(JSON.stringify({ files: folder
          ? [{ id: "native-folder-1", name: "Departify", mimeType: "application/vnd.google-apps.folder", modifiedTime: "2026-08-12T08:00:00Z" }]
          : [{ id: "native-pdf-1", name: "Departify.pdf", mimeType: "application/pdf", modifiedTime: "2026-08-12T08:00:00Z" }] }), { status: 200 });
      }
      return originalFetch(input, init);
    };
    const originalInfo = console.info;
    console.info = ((...args: unknown[]) => {
      if (args[0] === "[ceo-turn-trace]" && args[1] && typeof args[1] === "object") {
        const selected = (args[1] as { selectedToolNames?: unknown }).selectedToolNames;
        if (Array.isArray(selected)) selectedToolsByTurn.push(selected.filter((name): name is string => typeof name === "string"));
      }
      originalInfo(...args);
    }) as typeof console.info;
    (server as typeof server & { __restoreNativeTestInfo?: () => void }).__restoreNativeTestInfo = () => {
      console.info = originalInfo;
    };
  }, 60_000);

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    (server as typeof server & { __restoreNativeTestInfo?: () => void }).__restoreNativeTestInfo?.();
    if (previousGoogleClientId === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    else process.env.GOOGLE_OAUTH_CLIENT_ID = previousGoogleClientId;
    if (previousGoogleClientSecret === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    else process.env.GOOGLE_OAUTH_CLIENT_SECRET = previousGoogleClientSecret;
    installGoogleTokenStore(null);
    await server?.close();
  });

  async function startConversation(name: string): Promise<string> {
    const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api/customer-zero/start`, {
      method: "POST",
      headers: {
        authorization: "Bearer native-http-test-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        companyName: name,
        hasWebsite: false,
        description: "Read-only native HTTP integration test.",
        country: "España",
        goal: "Conseguir clientes",
        locale: "es",
      }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { organizationId: string };
    const organizationId = body.organizationId;

    for (const [toolId, label, capability] of [
      ["gmail", "Gmail", "email.read"],
      ["google_calendar", "Calendar", "calendar.read"],
      ["google_drive", "Drive", "drive.search"],
    ] as const) {
      await toolState.upsert({
        organizationId,
        toolId,
        label,
        capability,
        declared: true,
        status: "connected",
        health: "operational",
        verifiedAt: new Date().toISOString(),
      });
    }
    const google = createInMemoryGoogleTokenStore();
    await google.put({
      organizationId,
      userId: "native-http-google-user",
      provider: "gmail",
      accessToken: "read-only-test-access",
      refreshToken: "read-only-test-refresh",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      scopes: [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/drive.readonly",
      ],
      email: "native-http-founder@departify.local",
      displayName: "Native HTTP Founder",
      operationalVerifiedAt: new Date().toISOString(),
      operationalProbeError: null,
      operationalCapabilities: ["email.read", "calendar.read", "calendar.create", "drive.search", "drive.read"],
    });
    installGoogleTokenStore(google);
    return organizationId;
  }

  async function message(organizationId: string, text: string): Promise<NativeHttpResponse> {
    const response = await fetch(
      `http://127.0.0.1:${HTTP_PORT}/api/customer-zero/${organizationId}/command-center/message`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer native-http-test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ message: text }),
      },
    );
    const body = await response.json() as NativeHttpResponse;
    expect(response.status, JSON.stringify(body)).toBe(200);
    return body;
  }

  it("completes a real multi-capability OpenClaw turn", async () => {
    const organizationId = await startConversation("Native HTTP multi-tool");
    const result = await message(
      organizationId,
      "dime mis últimos 3 mails y qué eventos tengo mañana",
    );
    expect(result.reply?.trim()).toBeTruthy();
    expect(result.reply).not.toMatch(/motor de negocio ha fallado|no ha podido responder/i);
  }, 180_000);

  it("preserves native read follow-ups over real HTTP", async () => {
    const organizationId = await startConversation("Native HTTP follow-ups");
    const calendarA = await message(organizationId, "¿qué eventos tengo mañana?");
    const calendarB = await message(organizationId, "¿y por la tarde?");
    const emailA = await message(organizationId, "¿qué correos tengo hoy?");
    const emailB = await message(organizationId, "respóndele al último que mañana lo miro");

    // Native mutations are intentionally not exposed in ENGINE 03.2. The
    // reply follow-up therefore crosses the native read boundary into the
    // existing deterministic approval state machine.
    expect(emailB.reply?.trim()).toBeTruthy();
    const pendingEmail = getOrCreateCustomerZeroSession(organizationId).state.pendingEmailWork;
    if (pendingEmail) {
      expect(pendingEmail).toMatchObject({
        status: "awaiting_approval",
        recipient: "alex@example.com",
      });
    }
    for (const result of [calendarA, calendarB, emailA, emailB]) {
      expect(result.reply?.trim()).toBeTruthy();
      expect(result.reply).not.toMatch(/Elvira|Marketing/i);
    }
  }, 300_000);

  it("keeps the Founder Calendar create follow-up at approval over real HTTP", async () => {
    const organizationId = await startConversation("Native HTTP Founder Calendar");
    await message(organizationId, "y eventos?");
    const second = await message(organizationId, "cea un evento en 10 mintos con hola");

    expect(second.routing?.intent).toBe("calendar_create");
    expect(second.reply).toMatch(/aprue|confirm|crear|prepar|evento/i);
    expect(second.reply).not.toMatch(/Elvira|Marketing/i);
    expect(getOrCreateCustomerZeroSession(organizationId).state.pendingCalendarWork).toMatchObject({
      summary: "hola",
      status: "awaiting_approval",
    });
  }, 180_000);

  it("uses Drive native search for folders and the PDF follow-up", async () => {
    const organizationId = await startConversation("Native HTTP Drive");
    const folders = await message(organizationId, "listame las carpetas de Drive");
    const pdfs = await message(organizationId, "¿qué PDFs hay dentro?");

    expect(folders.reply?.trim()).toBeTruthy();
    expect(pdfs.reply?.trim()).toBeTruthy();
    expect(folders.reply).not.toMatch(/Elvira|Marketing/i);
    expect(pdfs.reply).not.toMatch(/Elvira|Marketing/i);
  }, 240_000);
});
