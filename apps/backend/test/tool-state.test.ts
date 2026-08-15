/**
 * Phase P-B — durable connection lifecycle tests (A–H, J).
 *
 * A. Selecting a tool is SELECTED, never CONNECTED.
 * B. Bootstrap config ⇒ CONFIGURED, never auto-CONNECTED.
 * C. Successful verification ⇒ CONNECTED + verifiedAt persisted.
 * D. Failed verification ⇒ never CONNECTED.
 * E. Session recreation (restart) restores persisted state.
 * F. Organization A state is never visible to Organization B.
 * G. Operational context distinguishes selected/configured/connected.
 * H. Connected + operational Mautic ⇒ capability READY.
 * J. Mautic appears in CRM and marketing discovery options.
 */
import { describe, expect, it, afterEach } from "vitest";

import {
  buildCrmQuestion,
  buildMarketingQuestion,
} from "../src/customer-zero/progressive-discovery.js";
import { TOOL_CATALOG, buildConnectionStateWithLifecycle } from "../src/customer-zero/connections.js";
import {
  getOrCreateCustomerZeroSession,
  hydrateSessionToolState,
  resetCustomerZeroSessionsForTest,
  buildMauticBootstrapRecord,
} from "../src/customer-zero/customer-zero-session.js";
import { buildSessionOperationalContext } from "../src/customer-zero/operational-context.js";
import {
  buildDeclaredToolState,
  humanLifecycleLabel,
  InMemoryToolStateStore,
  lifecycleToConnectionStatus,
  refineDeclaredStatus,
  type OrganizationToolState,
} from "../src/customer-zero/tool-state.js";
import {
  installExternalOAuthTokenStoreForTest,
  type ExternalOAuthTokenSummary,
} from "../src/customer-zero/external-oauth-tokens.js";

const MAUTIC_TOOL = TOOL_CATALOG.find((tool) => tool.id === "mautic")!;
const GMAIL_TOOL = TOOL_CATALOG.find((tool) => tool.id === "gmail")!;
const HUBSPOT_TOOL = TOOL_CATALOG.find((tool) => tool.id === "hubspot")!;

function withMauticEnv(fn: () => void) {
  const prev = {
    base: process.env.MAUTIC_BASE_URL,
    id: process.env.MAUTIC_CLIENT_ID,
    secret: process.env.MAUTIC_CLIENT_SECRET,
  };
  process.env.MAUTIC_BASE_URL = "https://mautic.test";
  process.env.MAUTIC_CLIENT_ID = "client";
  process.env.MAUTIC_CLIENT_SECRET = "secret";
  try {
    fn();
  } finally {
    restoreEnv(prev);
  }
}

function restoreEnv(prev: {
  base: string | undefined;
  id: string | undefined;
  secret: string | undefined;
}) {
  setOrDelete("MAUTIC_BASE_URL", prev.base);
  setOrDelete("MAUTIC_CLIENT_ID", prev.id);
  setOrDelete("MAUTIC_CLIENT_SECRET", prev.secret);
}

function setOrDelete(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  resetCustomerZeroSessionsForTest();
  installExternalOAuthTokenStoreForTest(null);
  delete process.env.MAUTIC_BASE_URL;
  delete process.env.MAUTIC_CLIENT_ID;
  delete process.env.MAUTIC_CLIENT_SECRET;
});

describe("A. selection never means connected", () => {
  it("declares the tool as selected/needs_connection, never connected", () => {
    const declared = buildDeclaredToolState("org", "mautic", "Mautic", "crm.contacts");
    expect(declared.declared).toBe(true);
    expect(declared.status).not.toBe("connected");
    expect(declared.status).toBe("needs_connection");
  });

  it("declares Gmail as NEEDS_CONNECTION (OAuth handshake is the real connector), never a fake CONNECTED", () => {
    // P0 — Gmail now has a real connector (the OAuth handshake + Gmail
    // operational probe). Declaring Gmail therefore places it in
    // needs_connection (CEO can act via /conexiones) — NOT in "selected",
    // and absolutely NOT in "connected" until the probe succeeds.
    const declared = buildDeclaredToolState("org", "gmail", "Gmail", "email.send");
    expect(declared.declared).toBe(true);
    expect(declared.status).toBe("needs_connection");
    expect(declared.status).not.toBe("connected");
  });

  it("with bootstrap config present it becomes CONFIGURED, still not connected", () => {
    withMauticEnv(() => {
      const declared = buildDeclaredToolState("org", "mautic", "Mautic", "crm.contacts");
      expect(declared.status).toBe("configured");
      expect(declared.configSource).toBe("env:mautic");
      expect(declared.status).not.toBe("connected");
    });
  });
});

describe("B. bootstrap configuration is CONFIGURED, never auto-connected", () => {
  it("builds a CONFIGURED record from env and never CONNECTED", () => {
    withMauticEnv(() => {
      const bootstrap = buildMauticBootstrapRecord("org");
      expect(bootstrap?.status).toBe("configured");
      expect(bootstrap?.configSource).toBe("env:mautic");
      expect(bootstrap?.declared).toBe(true);
      expect(bootstrap?.status).not.toBe("connected");
    });
  });

  it("returns null when the required env is absent", () => {
    expect(buildMauticBootstrapRecord("org")).toBeNull();
  });
});

describe("C. successful verification ⇒ CONNECTED + verifiedAt persisted", () => {
  it("round-trips a connected record with its verification timestamp", async () => {
    const store = new InMemoryToolStateStore();
    const state: OrganizationToolState = {
      organizationId: "org",
      toolId: "mautic",
      label: "Mautic",
      capability: "crm.contacts",
      declared: true,
      status: "connected",
      configSource: "env:mautic",
      verifiedAt: "2026-08-09T00:00:00.000Z",
      health: "operational",
    };
    await store.upsert(state);
    const read = await store.get("org", "mautic");
    expect(read?.status).toBe("connected");
    expect(read?.verifiedAt).toBe("2026-08-09T00:00:00.000Z");
    expect(read?.health).toBe("operational");
    expect(lifecycleToConnectionStatus("connected")).toBe("connected");
  });
});

describe("D. failed verification never produces CONNECTED", () => {
  it("maps failures to unavailable/degraded, never connected", () => {
    expect(refineDeclaredStatus(true, null, false)).toBe("selected");
    expect(refineDeclaredStatus(true, null, true)).toBe("needs_connection");
    expect(refineDeclaredStatus(true, "env:mautic", true)).toBe("configured");
    expect(lifecycleToConnectionStatus("unavailable")).toBe("blocked");
    expect(lifecycleToConnectionStatus("degraded")).toBe("blocked");
    expect(lifecycleToConnectionStatus("configured")).toBe("not_connected");
  });
});

describe("E. restart/session recreation restores persisted connection state", () => {
  it("a verified Mautic connection survives a session re-hydration", async () => {
    const store = new InMemoryToolStateStore();
    resetCustomerZeroSessionsForTest();
    await getOrCreateCustomerZeroSession("org_restart", { toolState: store });

    await store.upsert({
      organizationId: "org_restart",
      toolId: "mautic",
      label: "Mautic",
      capability: "crm.contacts",
      declared: true,
      status: "connected",
      configSource: "env:mautic",
      verifiedAt: "2026-08-09T00:00:00.000Z",
      health: "operational",
    });

    // "Restart": the process session registry is cleared, but the durable
    // store is the same Supabase-backed truth.
    resetCustomerZeroSessionsForTest();
    const session = getOrCreateCustomerZeroSession("org_restart", { toolState: store });
    await hydrateSessionToolState(session);

    const connection = session.state.connections.get("mautic");
    expect(connection?.lifecycle).toBe("connected");
    expect(connection?.verifiedAt).toBe("2026-08-09T00:00:00.000Z");
    expect(connection?.status).toBe("connected");
  });

  it("replaces a stale in-memory connection when durable state changes", async () => {
    const store = new InMemoryToolStateStore();
    const session = getOrCreateCustomerZeroSession("org_fresh_state", { toolState: store });

    await store.upsert({
      organizationId: "org_fresh_state",
      toolId: "mautic",
      label: "Mautic",
      capability: "crm.contacts",
      declared: true,
      status: "connected",
      verifiedAt: "2026-08-09T00:00:00.000Z",
      health: "operational",
    });
    await hydrateSessionToolState(session);
    expect(session.state.connections.get("mautic")?.lifecycle).toBe("connected");

    await store.upsert({
      organizationId: "org_fresh_state",
      toolId: "mautic",
      label: "Mautic",
      capability: "crm.contacts",
      declared: true,
      status: "needs_connection",
      health: "down",
    });
    await hydrateSessionToolState(session);

    expect(session.state.connections.get("mautic")?.lifecycle).toBe("needs_connection");
    expect(session.state.connections.get("mautic")?.status).toBe("not_connected");
  });

  it("drops Meta capabilities when the durable OAuth token expires", async () => {
    let summary: ExternalOAuthTokenSummary = {
      organizationId: "org_meta_freshness",
      userId: "user_meta",
      provider: "meta_business",
      hasAccessToken: true,
      hasRefreshToken: false,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      scopes: ["pages_read_engagement"],
      accountLabel: "Facebook Pages",
      operationalVerifiedAt: new Date().toISOString(),
      operationalProbeError: null,
    };
    installExternalOAuthTokenStoreForTest({
      put: async () => {},
      get: async () => null,
      listForOrg: async () => [summary],
      remove: async () => {},
    });

    const store = new InMemoryToolStateStore();
    const session = getOrCreateCustomerZeroSession("org_meta_freshness", { toolState: store });
    await store.upsert({
      organizationId: "org_meta_freshness",
      toolId: "meta_business",
      label: "Meta Business",
      declared: true,
      status: "connected",
      configSource: "oauth:meta_business",
      health: "operational",
    });

    await hydrateSessionToolState(session);
    expect(session.state.connections.get("meta_business")?.lifecycle).toBe("connected");

    summary = { ...summary, expiresAt: new Date(Date.now() - 1_000).toISOString() };
    await hydrateSessionToolState(session);
    expect(session.state.connections.get("meta_business")?.lifecycle).toBe("needs_connection");
  });
});

describe("F. organization isolation of connection state", () => {
  it("Organization A's records are never visible to Organization B", async () => {
    const store = new InMemoryToolStateStore();
    await store.upsert({
      organizationId: "orgA",
      toolId: "mautic",
      label: "Mautic",
      declared: true,
      status: "connected",
      verifiedAt: "2026-08-09T00:00:00.000Z",
    });
    expect((await store.listForOrg("orgA")).length).toBe(1);
    expect(await store.listForOrg("orgB")).toEqual([]);
    expect(await store.get("orgB", "mautic")).toBeNull();
  });
});

describe("G. operational context distinguishes lifecycle states", () => {
  it("prompt view separates CONFIGURADA / SELECCIONADA / CONECTADA", () => {
    const session = getOrCreateCustomerZeroSession("org_ctx");
    session.state.connections.set(
      "mautic",
      buildConnectionStateWithLifecycle(MAUTIC_TOOL, "es", "configured", { configSource: "env:mautic" }),
    );
    session.state.connections.set(
      "gmail",
      buildConnectionStateWithLifecycle(GMAIL_TOOL, "es", "selected"),
    );
    session.state.connections.set(
      "hubspot",
      buildConnectionStateWithLifecycle(HUBSPOT_TOOL, "es", "connected", { verifiedAt: "2026-08-09T00:00:00.000Z" }),
    );
    const context = buildSessionOperationalContext(session);
    expect(context.promptView).toContain("ESTADO DE LAS HERRAMIENTAS");
    expect(context.promptView).toContain("CONFIGURADA");
    expect(context.promptView).toContain("SELECCIONADA");
    expect(context.promptView).toContain("CONECTADA");
  });
});

describe("H. connected + operational Mautic ⇒ capability READY", () => {
  it("derives the Mautic capability as ready when the connection is connected", () => {
    const session = getOrCreateCustomerZeroSession("org_ready");
    session.state.connections.set(
      "mautic",
      buildConnectionStateWithLifecycle(MAUTIC_TOOL, "es", "connected", {
        configSource: "env:mautic",
        verifiedAt: "2026-08-09T00:00:00.000Z",
      }),
    );
    const context = buildSessionOperationalContext(session);
    expect(context.capabilities.find((entry) => entry.id === "mautic")?.status).toBe("ready");
    expect(context.promptView).toContain("CONECTADA");
  });
});

describe("J. Mautic appears in appropriate discovery options", () => {
  it("is offered in the CRM and marketing questions", () => {
    const crm = buildCrmQuestion("es");
    expect(crm.options).toContain("Mautic");
    const marketing = buildMarketingQuestion("es");
    expect(marketing.options).toContain("Mautic");
  });

  it("is not re-asked when already declared", () => {
    const marketing = buildMarketingQuestion("es", ["mautic", "hubspot"]);
    expect(marketing.options).not.toContain("Mautic");
    expect(marketing.options).not.toContain("HubSpot");
  });

  it("has human labels without internal jargon", () => {
    expect(humanLifecycleLabel("configured", "es")).toBe("Configurado · Verificar conexión");
    expect(humanLifecycleLabel("connected", "es")).toBe("Conectado");
    expect(humanLifecycleLabel("degraded", "es")).toBe("Problema de conexión");
  });
});
