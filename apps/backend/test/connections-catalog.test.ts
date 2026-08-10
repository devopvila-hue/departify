/**
 * Phase P-B production fix — /conexiones as a catalog + state surface.
 *
 * A. Catalog tools appear even when org state contains only Mautic.
 * B. Connected Mautic remains CONNECTED.
 * C. An unselected Gmail appears AVAILABLE but is never falsely CONNECTED.
 * D. Selecting Gmail creates durable org-scoped state.
 * E. Another organization does not inherit that selection.
 * F. Restart/hydration preserves selected tools.
 * G. No catalog entry becomes CONNECTED merely from environment configuration.
 * I. Chat does not claim Gmail is connected when no connector exists.
 * J. /connections does not duplicate Mautic.
 */
import { describe, expect, it, beforeAll, afterEach } from "vitest";
import { buildServer } from "../src/server/server.js";
import { loadBackendConfig } from "@departify/config";
import type { FastifyInstance } from "fastify";
import { makeFakeTenant } from "./helpers/fake-tenant.js";
import { InMemoryToolStateStore } from "../src/customer-zero/tool-state.js";
import { InMemoryConversationStore } from "../src/customer-zero/conversation-store.js";
import { TOOL_CATALOG, buildConnectionStateWithLifecycle } from "../src/customer-zero/connections.js";
import {
  getOrCreateCustomerZeroSession,
  resetCustomerZeroSessionsForTest,
} from "../src/customer-zero/customer-zero-session.js";
import type { ToolConnectionView } from "../src/server/routes/customer-zero-v2.js";

const AUTH_A = { authorization: "Bearer token-a" };
const AUTH_B = { authorization: "Bearer token-b" };

const MAUTIC_TOOL = TOOL_CATALOG.find((tool) => tool.id === "mautic")!;

describe("P-B production fix — connections catalog", () => {
  let server: FastifyInstance;
  let toolState: InMemoryToolStateStore;

  beforeAll(async () => {
    const tenant = makeFakeTenant();
    toolState = new InMemoryToolStateStore();
    server = await buildServer(loadBackendConfig(), {
      auth: tenant,
      organizations: tenant,
      toolState,
      conversations: new InMemoryConversationStore(),
    });
  });

  afterEach(() => {
    resetCustomerZeroSessionsForTest();
    delete process.env.MAUTIC_BASE_URL;
    delete process.env.MAUTIC_CLIENT_ID;
    delete process.env.MAUTIC_CLIENT_SECRET;
  });

  async function start(auth = AUTH_A): Promise<string> {
    const response = await server.inject({
      method: "POST",
      url: "/api/customer-zero/start",
      headers: auth,
      payload: {
        companyName: "MoOn",
        hasWebsite: false,
        description: "Plataforma de vivienda compartida.",
        goal: "Conseguir clientes",
      },
    });
    expect(response.statusCode).toBe(200);
    return response.json().organizationId as string;
  }

  async function connections(org: string, auth = AUTH_A): Promise<ToolConnectionView[]> {
    const response = await server.inject({
      method: "GET",
      url: `/api/customer-zero/${org}/connections`,
      headers: auth,
    });
    expect(response.statusCode).toBe(200);
    return response.json().connections as ToolConnectionView[];
  }

  it("A. catalog tools appear even when org state contains only Mautic", async () => {
    const org = await start();
    const views = await connections(org);
    // The full catalog is present, not only rows stored in org state.
    expect(views.length).toBe(TOOL_CATALOG.length);
    expect(views.some((view) => view.toolId === "gmail")).toBe(true);
    expect(views.some((view) => view.toolId === "mautic")).toBe(true);
    expect(views.some((view) => view.toolId === "slack")).toBe(true);
  });

  it("B. connected Mautic remains CONNECTED", async () => {
    const org = await start();
    const session = getOrCreateCustomerZeroSession(org);
    session.state.connections.set(
      "mautic",
      buildConnectionStateWithLifecycle(MAUTIC_TOOL, "es", "connected", {
        configSource: "env:mautic",
        verifiedAt: "2026-08-09T00:00:00.000Z",
      }),
    );
    const views = await connections(org);
    const mautic = views.find((view) => view.toolId === "mautic");
    expect(mautic?.state).toBe("connected");
    expect(mautic?.humanLabel).toBe("Conectado");
  });

  it("C. an unselected Gmail appears AVAILABLE, never falsely CONNECTED", async () => {
    const org = await start();
    const views = await connections(org);
    const gmail = views.find((view) => view.toolId === "gmail");
    expect(gmail?.state).toBe("available");
    expect(gmail?.hasState).toBe(false);
    expect(gmail?.state).not.toBe("connected");
    expect(gmail?.action).toBe("prepare");
  });

  it("D. selecting Gmail creates durable org-scoped state", async () => {
    const org = await start();
    const declared = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${org}/connections/gmail/declare`,
      headers: AUTH_A,
    });
    expect(declared.statusCode).toBe(200);
    const durable = await toolState.get(org, "gmail");
    expect(durable?.declared).toBe(true);
    // P0 — Gmail now has a real connector (OAuth handshake). Declaring
    // Gmail without OAuth places it in needs_connection (CEO can act
    // via /conexiones), NEVER in "connected".
    expect(durable?.status).toBe("needs_connection");
    expect(durable?.status).not.toBe("connected");

    const views = await connections(org);
    const gmail = views.find((view) => view.toolId === "gmail");
    expect(gmail?.state).toBe("needs_connection");
    expect(gmail?.state).not.toBe("connected");
  });

  it("E. another organization does not inherit the selection", async () => {
    const orgA = await start(AUTH_A);
    await server.inject({
      method: "POST",
      url: `/api/customer-zero/${orgA}/connections/gmail/declare`,
      headers: AUTH_A,
    });
    const orgB = await start(AUTH_B);
    const viewsB = await connections(orgB, AUTH_B);
    expect(viewsB.find((view) => view.toolId === "gmail")?.state).toBe("available");
    expect(await toolState.get(orgB, "gmail")).toBeNull();
  });

  it("F. restart/hydration preserves Gmail's needs_connection state", async () => {
    const org = await start();
    await server.inject({
      method: "POST",
      url: `/api/customer-zero/${org}/connections/gmail/declare`,
      headers: AUTH_A,
    });
    // Simulate a restart: the process session registry is cleared but the
    // durable store (same instance in deps) survives.
    resetCustomerZeroSessionsForTest();
    const views = await connections(org);
    // P0 — Gmail has a real connector (OAuth handshake) so its durable
    // lifecycle on declare is needs_connection, not the legacy "selected".
    expect(views.find((view) => view.toolId === "gmail")?.state).toBe("needs_connection");
  });

  it("G. environment configuration alone never makes a catalog entry CONNECTED", async () => {
    process.env.MAUTIC_BASE_URL = "https://mautic.test";
    process.env.MAUTIC_CLIENT_ID = "id";
    process.env.MAUTIC_CLIENT_SECRET = "secret";
    const org = await start();
    const views = await connections(org);
    const mautic = views.find((view) => view.toolId === "mautic");
    // Bootstrapped as CONFIGURED (credentials present), never auto-CONNECTED.
    expect(mautic?.state).toBe("configured");
    expect(mautic?.state).not.toBe("connected");
  });

  it("I. chat does not claim Gmail is connected without durable token evidence", async () => {
    const org = await start();
    const response = await server.inject({
      method: "POST",
      url: `/api/customer-zero/${org}/command-center/message`,
      headers: AUTH_A,
      payload: { message: "conecta gmail" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      reply: string;
      connectionSuggestion: { connectable: boolean } | null;
    };
    // P0 — Gmail now has a real OAuth connector. The chat says the
    // connector exists and instructs the CEO to connect it. It MUST
    // NOT claim "conectado y operativo" because no durable Google
    // token row exists for this org yet.
    expect(body.reply.toLowerCase()).not.toContain("conectado y operativo");
    expect(body.connectionSuggestion?.connectable).toBe(true);
  });

  it("J. /connections does not duplicate Mautic across domains", async () => {
    const org = await start();
    const views = await connections(org);
    const mauticEntries = views.filter((view) => view.toolId === "mautic");
    expect(mauticEntries.length).toBe(1);
    expect(mauticEntries[0]?.domains).toContain("crm");
    expect(mauticEntries[0]?.domains).toContain("marketing");
  });
});
