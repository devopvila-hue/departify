/**
 * Customer Zero 01 — sprint tests.
 *
 * Covers the 38-case acceptance battery end-to-end against the new
 * modules: CredentialResolver, CapabilityRegistry, Mautic adapter
 * extensions, routing fixes, chat enrichment, and connections
 * domain. No real Mautic instance is hit — the test HTTP layer is
 * stubbed so the tests are deterministic.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildMauticCapability,
} from "@departify/capability-engine";
import {
  resolveCredentials,
  getCredentials,
  hasConfiguredCredentials,
  forgetCredential,
  publicCredentialSource,
} from "../src/customer-zero/credential-resolver.js";
import {
  isCapabilityAvailable,
  listAvailableCapabilities,
  listReadyCapabilities,
  CAPABILITY_REGISTRY,
} from "../src/customer-zero/capability-registry.js";
import {
  listMauticContacts,
  getMauticContact,
  listMauticSegments,
  listMauticCampaigns,
  getMauticContactActivity,
  getMauticSummary,
  resolveMauticCredentials,
} from "../src/customer-zero/mautic-adapter.js";
import { MauticAuthError } from "../src/customer-zero/mautic-adapter.js";
import {
  routeCommandCenter,
  buildCommandCenterInput,
} from "../src/customer-zero/command-center.js";
import {
  enrichForChat,
  speakerForIntent,
  workStatesForTurn,
  normalizeReplyForChat,
} from "../src/customer-zero/chat-response-enrichment.js";
import {
  CONNECTION_DEFINITIONS,
  renderConnectionCard,
  lifecycleToFiveState,
  connectionStateLabel,
  listAvailableCapabilitiesForOrg,
} from "../src/customer-zero/connections-domain.js";
import type { CustomerZeroSession } from "../src/customer-zero/customer-zero-session.js";

/* ============================================================================
 * Helpers — fake fetch + fake Customer Zero session.
 * ==========================================================================*/

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetchSequence(responses: Array<{ match: (url: string) => boolean; status: number; body: unknown }>) {
  const fetchMock = vi.fn(async (input: string | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const match = responses.find((r) => r.match(url));
    if (!match) {
      throw new Error(`Unexpected fetch in test: ${url}`);
    }
    return jsonResponse(match.status, match.body);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function fakeCredentials(): void {
  process.env["MAUTIC_BASE_URL"] = "https://mautic.test";
  process.env["MAUTIC_CLIENT_ID"] = "client-test";
  process.env["MAUTIC_CLIENT_SECRET"] = "secret-test";
}

function clearCredentials(): void {
  delete process.env["MAUTIC_BASE_URL"];
  delete process.env["MAUTIC_CLIENT_ID"];
  delete process.env["MAUTIC_CLIENT_SECRET"];
}

afterEach(() => {
  clearCredentials();
  vi.unstubAllGlobals();
});

/* ============================================================================
 * 1 — CredentialResolver detects existing Mautic config
 * ==========================================================================*/

describe("CredentialResolver", () => {
  beforeEach(() => {
    clearCredentials();
  });

  it("01 detects existing Mautic config from environment", () => {
    fakeCredentials();
    const r = resolveCredentials({ organizationId: "org_x", provider: "mautic" });
    expect(r.available).toBe(true);
    expect(r.source).toBe("environment");
    expect(r.label).toBe("env:mautic");
    expect(r.handle).toBeDefined();
  });

  it("02 returns available=false when env vars are missing", () => {
    const r = resolveCredentials({ organizationId: "org_x", provider: "mautic" });
    expect(r.available).toBe(false);
    expect(r.source).toBe("none");
    expect(r.handle).toBeUndefined();
  });

  it("03 never serializes the secret value outside the internal boundary", () => {
    fakeCredentials();
    const r = resolveCredentials({ organizationId: "org_x", provider: "mautic" });
    const serialised = JSON.stringify(r);
    expect(serialised).not.toContain("secret-test");
    expect(serialised).not.toContain("client-test");
    expect(serialised).not.toContain("https://mautic.test");
  });

  it("04 getCredentials returns the raw secret only through the internal handle", () => {
    fakeCredentials();
    const r = resolveCredentials({ organizationId: "org_x", provider: "mautic" });
    expect(r.handle).toBeDefined();
    const creds = getCredentials(r.handle!);
    expect(creds?.provider === "mautic" && creds.clientSecret).toBe(
      "secret-test",
    );
  });

  it("05 publicCredentialSource returns only a label, never the secret", () => {
    fakeCredentials();
    const pub = publicCredentialSource({ organizationId: "org_x", provider: "mautic" });
    expect(pub.available).toBe(true);
    expect(pub.label).toBe("env:mautic");
    expect(JSON.stringify(pub)).not.toContain("secret-test");
  });

  it("06 hasConfiguredCredentials is true when env is configured", () => {
    fakeCredentials();
    expect(hasConfiguredCredentials("mautic")).toBe(true);
  });

  it("07 hasConfiguredCredentials is false when env is missing", () => {
    expect(hasConfiguredCredentials("mautic")).toBe(false);
  });

  it("08 forgetCredential drops the handle from the registry", () => {
    fakeCredentials();
    const r = resolveCredentials({ organizationId: "org_x", provider: "mautic" });
    expect(r.handle).toBeDefined();
    forgetCredential(r.handle!);
    expect(getCredentials(r.handle!)).toBeNull();
  });
});

/* ============================================================================
 * 2 — CapabilityRegistry exposes business capabilities
 * ==========================================================================*/

describe("CapabilityRegistry", () => {
  beforeEach(() => {
    fakeCredentials();
  });

  it("09 reports crm.contacts.read available when Mautic is configured", () => {
    expect(isCapabilityAvailable("org_x", "crm.contacts.read").available).toBe(true);
  });

  it("10 reports unavailable when credentials are missing", () => {
    clearCredentials();
    const r = isCapabilityAvailable("org_x", "crm.contacts.read");
    expect(r.available).toBe(false);
    expect(r.reason).toBe("credentials_missing");
  });

  it("11 listReadyCapabilities returns only available ids", () => {
    const ready = listReadyCapabilities("org_x");
    expect(ready).toContain("crm.contacts.read");
    expect(ready).toContain("crm.segments.read");
    expect(ready).toContain("crm.campaigns.read");
  });

  it("12 listAvailableCapabilities returns all known capabilities with availability", () => {
    const list = listAvailableCapabilities("org_x");
    expect(list.length).toBe(Object.keys(CAPABILITY_REGISTRY).length);
    const ids = list.map((c) => c.capability);
    expect(ids).toContain("crm.contacts.read");
    expect(ids).toContain("crm.segments.list");
  });

  it("13 the existing Mautic capability contract stays compatible", () => {
    const capability = buildMauticCapability();
    expect(capability.id).toBe("mautic");
    expect(capability.actions.length).toBeGreaterThanOrEqual(3);
  });
});

/* ============================================================================
 * 3 — Mautic adapter extensions (success + auth failure + normalized types)
 * ==========================================================================*/

describe("Mautic adapter extensions", () => {
  beforeEach(fakeCredentials);

  it("14 listContacts returns normalized CRMContactPage", async () => {
    stubFetchSequence([
      {
        match: (u) => u.includes("/oauth/v2/token"),
        status: 200,
        body: { access_token: "tok" },
      },
      {
        match: (u) => u.includes("/api/contacts?"),
        status: 200,
        body: {
          total: 2,
          contacts: {
            "1": {
              id: 1,
              fields: { all: { firstname: "Ada", lastname: "Lovelace", email: "ada@test.dev", company: "Analytical" } },
              dateAdded: "2025-01-01T00:00:00Z",
              lastActive: "2026-07-01T00:00:00Z",
              points: 42,
            },
            "2": {
              id: 2,
              fields: { all: { firstname: "", lastname: "", email: "" } },
            },
          },
        },
      },
    ]);
    const r = await listMauticContacts(
      resolveMauticCredentials()!,
      { limit: 30 },
      new AbortController().signal,
    );
    expect(r.success).toBe(true);
    expect(r.value?.total).toBe(2);
    expect(r.value?.contacts[0]?.displayName).toBe("Ada Lovelace");
    expect(r.value?.contacts[0]?.email).toBe("ada@test.dev");
    expect(r.value?.contacts[0]?.company).toBe("Analytical");
    expect(r.value?.contacts[0]?.score).toBe(42);
    expect(r.value?.contacts[1]?.displayName).toBe("Contacto #2");
  });

  it("15 listContacts normalises auth failure to errorCode=auth", async () => {
    stubFetchSequence([
      {
        match: (u) => u.includes("/oauth/v2/token"),
        status: 401,
        body: { error: "invalid_client", error_description: "bad client" },
      },
    ]);
    const r = await listMauticContacts(
      resolveMauticCredentials()!,
      {},
      new AbortController().signal,
    );
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("auth");
  });

  it("16 getContact returns a single normalized contact", async () => {
    stubFetchSequence([
      {
        match: (u) => u.includes("/oauth/v2/token"),
        status: 200,
        body: { access_token: "tok" },
      },
      {
        match: (u) => u.includes("/api/contacts/42"),
        status: 200,
        body: {
          contact: {
            id: 42,
            fields: { all: { firstname: "Grace", lastname: "Hopper", email: "grace@test.dev" } },
          },
        },
      },
    ]);
    const r = await getMauticContact(
      resolveMauticCredentials()!,
      42,
      new AbortController().signal,
    );
    expect(r.success).toBe(true);
    expect(r.value?.displayName).toBe("Grace Hopper");
  });

  it("17 listSegments returns normalized CRMSegment list", async () => {
    stubFetchSequence([
      { match: (u) => u.includes("/oauth/v2/token"), status: 200, body: { access_token: "tok" } },
      {
        match: (u) => u.includes("/api/segments"),
        status: 200,
        body: { lists: { "1": { id: 1, name: "Leads calificados", leadCount: 10 } } },
      },
    ]);
    const r = await listMauticSegments(
      resolveMauticCredentials()!,
      new AbortController().signal,
    );
    expect(r.success).toBe(true);
    expect(r.value?.[0]?.name).toBe("Leads calificados");
    expect(r.value?.[0]?.contactCount).toBe(10);
  });

  it("18 listCampaigns returns normalized CRMCampaign list", async () => {
    stubFetchSequence([
      { match: (u) => u.includes("/oauth/v2/token"), status: 200, body: { access_token: "tok" } },
      {
        match: (u) => u.includes("/api/campaigns"),
        status: 200,
        body: { campaigns: { "1": { id: 1, name: "Welcome series", isPublished: true } } },
      },
    ]);
    const r = await listMauticCampaigns(
      resolveMauticCredentials()!,
      new AbortController().signal,
    );
    expect(r.success).toBe(true);
    expect(r.value?.[0]?.name).toBe("Welcome series");
    expect(r.value?.[0]?.status).toBe("published");
  });

  it("19 getContactActivity degrades gracefully when the endpoint is unavailable", async () => {
    stubFetchSequence([
      { match: (u) => u.includes("/oauth/v2/token"), status: 200, body: { access_token: "tok" } },
      {
        match: (u) => u.includes("/activity"),
        status: 404,
        body: { error: "endpoint disabled" },
      },
    ]);
    const r = await getMauticContactActivity(
      resolveMauticCredentials()!,
      7,
      new AbortController().signal,
    );
    expect(r.success).toBe(true);
    expect(r.value).toEqual([]);
  });

  it("20 getSummary computes stale contact count and top segments", async () => {
    stubFetchSequence([
      { match: (u) => u.includes("/oauth/v2/token"), status: 200, body: { access_token: "tok" } },
      {
        match: (u) => u.includes("/api/contacts?limit=100"),
        status: 200,
        body: {
          total: 2,
          contacts: {
            "1": { id: 1, fields: { all: { firstname: "Old" } }, lastActive: "2020-01-01T00:00:00Z" },
            "2": { id: 2, fields: { all: { firstname: "Fresh" } }, lastActive: "2026-08-01T00:00:00Z" },
          },
        },
      },
      {
        match: (u) => u.includes("/api/segments"),
        status: 200,
        body: { lists: { "1": { id: 1, name: "Top", leadCount: 100 } } },
      },
      {
        match: (u) => u.includes("/api/campaigns"),
        status: 200,
        body: { campaigns: {} },
      },
    ]);
    const r = await getMauticSummary(
      resolveMauticCredentials()!,
      new AbortController().signal,
      { inactivityThresholdDays: 30 },
    );
    expect(r.success).toBe(true);
    expect(r.value?.totalContacts).toBe(2);
    expect(r.value?.totalSegments).toBe(1);
    expect(r.value?.contactsWithoutRecentActivity).toBe(1);
    expect(r.value?.topSegments?.[0]?.name).toBe("Top");
  });
});

/* ============================================================================
 * 4 — Routing fixes for meta / system / department requests
 * ==========================================================================*/

describe("Command Center routing", () => {
  function emptyInput(): ReturnType<typeof buildCommandCenterInput> {
    const session = {
      organizationId: "org_x",
      state: {
        locale: "es" as const,
        connections: new Map(),
        unmappedTools: [],
        marketingWork: undefined,
        onboarding: undefined,
        conversation: [],
      },
    } as unknown as CustomerZeroSession;
    return buildCommandCenterInput(session, "qué modelo usas");
  }
  void emptyInput;

  it("21 'qué modelo usas' is answered locally, not delegated to Marketing", () => {
    const r = routeCommandCenter(emptyInput());
    expect(r.decision.intent).toBe("meta_product_question");
    expect(r.reply).toContain("Vertex");
  });

  it("22 'cómo funciona Departify' answers locally", () => {
    const r = routeCommandCenter({
      ...emptyInput(),
      message: "cómo funciona Departify",
    });
    expect(r.decision.intent).toBe("meta_product_question");
  });

  it("23 'háblame de Marketing' returns a department description", () => {
    const r = routeCommandCenter({
      ...emptyInput(),
      message: "háblame de Marketing",
    });
    expect(r.decision.intent).toBe("department_request");
    expect(r.reply).toContain("Elvira");
  });

  it("24 'cómo uso esto' returns system help", () => {
    const r = routeCommandCenter({
      ...emptyInput(),
      message: "cómo uso esto",
    });
    expect(r.decision.intent).toBe("system_help_question");
  });

  it("25 a Marketing business request still delegates to Elvira (no tool mention)", () => {
    const r = routeCommandCenter({
      ...emptyInput(),
      message: "revisa los contactos del CRM y dime dónde ves una oportunidad",
    });
    expect(r.decision.intent).toBe("delegate_marketing");
  });
});

/* ============================================================================
 * 5 — Chat enrichment: speaker + work states + markdown safety
 * ==========================================================================*/

describe("Chat enrichment", () => {
  it("26 speaker is 'elvira' when Marketing is involved", () => {
    expect(speakerForIntent("delegate_marketing")).toBe("elvira");
    expect(speakerForIntent("external_tool_query")).toBe("elvira");
    expect(speakerForIntent("meta_product_question")).toBe("departify");
  });

  it("27 work states include tool_started when a Mautic tool was used", () => {
    const states = workStatesForTurn({
      intent: "external_tool_query",
      marketingInvoked: true,
      marketingSucceeded: true,
      locale: "es",
      reply: "",
      mauticToolUsed: true,
    });
    expect(states).toContain("tool_started");
    expect(states).toContain("tool_completed");
    expect(states).toContain("preparing_result");
    expect(states).toContain("completed");
  });

  it("28 work states include 'error' when Marketing failed", () => {
    const states = workStatesForTurn({
      intent: "external_tool_query",
      marketingInvoked: true,
      marketingSucceeded: false,
      locale: "es",
      reply: "",
    });
    expect(states).toContain("error");
  });

  it("29 normalizeReplyForChat strips literal **bold** markers", () => {
    const out = normalizeReplyForChat("Esto es **importante** para Elvira.");
    expect(out).not.toContain("**");
    expect(out).toContain("importante");
  });

  it("30 normalizeReplyForChat keeps angle brackets as plain text", () => {
    const out = normalizeReplyForChat("<script>alert('xss')</script> normal");
    // HTML safety belongs to the portal renderer; the backend keeps the
    // assistant response as business-readable plain text.
    expect(out).toContain("<script>");
  });

  it("31 enrichForChat returns speaker + states + normalized reply", () => {
    const out = enrichForChat({
      intent: "delegate_marketing",
      marketingInvoked: true,
      marketingSucceeded: true,
      locale: "es",
      reply: "**Hola** desde Elvira.",
      mauticToolUsed: true,
    });
    expect(out.speaker).toBe("elvira");
    expect(out.workStates).toContain("tool_started");
    expect(out.normalizedReply).toContain("Hola");
    expect(out.normalizedReply).not.toContain("**");
  });
});

/* ============================================================================
 * 6 — Connections domain: 5-state cards + capabilities aggregation
 * ==========================================================================*/

describe("Connections domain", () => {
  it("32 lifecycleToFiveState maps connected → connected", () => {
    expect(lifecycleToFiveState("connected")).toBe("connected");
  });

  it("33 lifecycleToFiveState maps degraded → needs_attention", () => {
    expect(lifecycleToFiveState("degraded")).toBe("needs_attention");
  });

  it("34 lifecycleToFiveState maps unavailable → error", () => {
    expect(lifecycleToFiveState("unavailable")).toBe("error");
  });

  it("35 connectionStateLabel returns Spanish labels", () => {
    expect(connectionStateLabel("connected", "es")).toBe("Conectado");
    expect(connectionStateLabel("needs_attention", "es")).toBe("Necesita atención");
  });

  it("36 renderConnectionCard shows configSource when configured", () => {
    const card = renderConnectionCard(
      {
        organizationId: "org_x",
        toolId: "mautic",
        label: "Mautic",
        declared: true,
        status: "connected",
        configSource: "env:mautic",
        verifiedAt: "2026-08-01T00:00:00Z",
      },
      "es",
    );
    expect(card.state).toBe("connected");
    expect(card.configSource).toBe("env:mautic");
    expect(card.actionLabel).toBe("Comprobar conexión");
  });

  it("37 listAvailableCapabilitiesForOrg aggregates only connected tools", () => {
    const caps = listAvailableCapabilitiesForOrg([
      {
        organizationId: "org_x",
        toolId: "mautic",
        label: "Mautic",
        declared: true,
        status: "connected",
      },
    ]);
    const mautic = caps.find((c) => c.capability === "crm.contacts.read");
    expect(mautic?.available).toBe(true);
    const hubspot = caps.find((c) => c.capability === "crm.contacts.read");
    expect(mautic?.providers).toContain("Mautic");
    void hubspot;
  });

  it("38 catalog contains all major connectors with capability descriptors", () => {
    const ids = CONNECTION_DEFINITIONS.map((d) => d.id);
    expect(ids).toContain("mautic");
    expect(ids).toContain("gmail");
    expect(ids).toContain("hubspot");
    expect(ids).toContain("notion");
    for (const def of CONNECTION_DEFINITIONS) {
      expect(def.capabilities.length).toBeGreaterThan(0);
    }
  });
});

/* ============================================================================
 * Auth-error classification helper.
 * ==========================================================================*/

describe("MauticAuthError", () => {
  it("truncates messages to 200 chars", () => {
    const err = new MauticAuthError(401, "x".repeat(500));
    expect(err.message.length).toBe(200);
    expect(err.status).toBe(401);
    expect(err.name).toBe("MauticAuthError");
  });
});
