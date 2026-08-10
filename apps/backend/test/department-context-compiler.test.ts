/**
 * Customer Zero 01 — Context Readiness tests.
 *
 * Covers the three user shapes:
 *
 *   A) new user with completed onboarding (current V2)
 *   B) legacy user with incomplete onboarding (the bug we are fixing)
 *   C) already-complete user (must not be re-interrogated)
 *
 * Plus the post-sync functional assertions:
 *
 *   - "Háblame de Marketing" with a complete context produces a
 *     context-aware reply (not a generic one).
 *   - "¿Qué deberíamos hacer ahora?" uses DNA + objective + tools.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  compileDepartmentContext,
  detectContextGaps,
  isLegacyContextIncomplete,
  renderCompiledContextForEngine,
  syncCompiledContext,
  type CompiledDepartmentContext,
} from "../src/customer-zero/department-context-compiler.js";
import {
  InMemoryCapabilityEventPublisher,
} from "@departify/capability-engine";
import type { CustomerZeroSession } from "../src/customer-zero/customer-zero-session.js";
import { createInMemoryMemoryRecordStore } from "@departify/memory";

/* ----------------------------------------------------------------------------
 * Test session factories.
 * --------------------------------------------------------------------------*/

function makeSession(
  overrides: Partial<{
    organizationId: string;
    onboarding: CustomerZeroSession["state"]["onboarding"];
    discoveryTranscript: CustomerZeroSession["state"]["discoveryTranscript"];
    marketingWork: CustomerZeroSession["state"]["marketingWork"];
    connections: CustomerZeroSession["state"]["connections"];
    locale: CustomerZeroSession["state"]["locale"];
  }> = {},
): CustomerZeroSession {
  const memoryStore = createInMemoryMemoryRecordStore();
  return {
    organizationId: overrides.organizationId ?? "org_legacy",
    memoryStore,
    state: {
      locale: overrides.locale ?? "es",
      onboarding: overrides.onboarding,
      discovery: {} as CustomerZeroSession["state"]["discovery"],
      discoveryTranscript: overrides.discoveryTranscript ?? [],
      marketingWork: overrides.marketingWork,
      connections: overrides.connections ?? new Map(),
      unmappedTools: [],
      conversation: [],
      memoryStore,
      rawData: {},
    },
    // unused fields; typed as `never` for test brevity.
  } as unknown as CustomerZeroSession;
}

/* ----------------------------------------------------------------------------
 * Helpers.
 * --------------------------------------------------------------------------*/

function completeOnboarding() {
  return {
    companyName: "Acme Cloud SL",
    hasWebsite: true,
    url: "https://acme.cloud",
    description: "Plataforma SaaS B2B de automatización para PYMEs en España",
    country: "España",
    companySize: "10-50",
    goal: "Acelerar el pipeline MQL→SQL y reducir el CAC en 25% durante el próximo trimestre",
  };
}

function richDiscovery(): CustomerZeroSession["state"]["discoveryTranscript"] {
  return [
    {
      questionId: "q1",
      question: "¿Cuál es vuestro ICP principal?",
      answer: "PYMEs españolas con 10-100 empleados, sector industrial y servicios profesionales.",
    },
    {
      questionId: "q2",
      question: "¿Qué canales de adquisición usáis?",
      answer: "Inbound (blog + SEO), outbound puntual y eventos sectoriales.",
    },
    {
      questionId: "q3",
      question: "¿Quién es el buyer persona?",
      answer: "Director de operaciones o CTO de PYMEs; busca ROI en 6 meses.",
    },
  ];
}

/* ----------------------------------------------------------------------------
 * A) New user with completed onboarding.
 * --------------------------------------------------------------------------*/

describe("Context readiness — new user (V2)", () => {
  let session: CustomerZeroSession;
  beforeEach(() => {
    session = makeSession({
      onboarding: completeOnboarding(),
      discoveryTranscript: richDiscovery(),
      marketingWork: {
        goal: "Acelerar el pipeline MQL→SQL",
        summary: "Plan trimestral de activación de leads",
        items: [
          {
            id: "obj_1",
            kind: "analysis",
            title: "Reducir CAC 25%",
            description: "Acelerar el pipeline MQL→SQL y reducir el CAC en 25%",
            status: "running",
          },
        ],
      },
      connections: new Map(),
    });
  });

  it("A1 detects the user as ready (no blocking + no important gaps)", () => {
    const gaps = detectContextGaps(session);
    expect(gaps.find((g) => g.id === "company_identity")).toBeUndefined();
    expect(gaps.find((g) => g.id === "primary_goal")).toBeUndefined();
  });

  it("A2 compiled context is ready=true", () => {
    const ctx = compileDepartmentContext(session);
    expect(ctx.ready).toBe(true);
    expect(ctx.gaps).toEqual([]);
  });

  it("A3 compiled context contains the company DNA", () => {
    const ctx = compileDepartmentContext(session);
    expect(ctx.companyDNA.companyName).toBe("Acme Cloud SL");
    expect(ctx.companyDNA.goal).toContain("MQL→SQL");
  });

  it("A4 compiled context contains the active objective", () => {
    const ctx = compileDepartmentContext(session);
    expect(ctx.objectives.length).toBeGreaterThan(0);
  });

  it("A5 not legacy — onboarding V2 is complete", () => {
    expect(isLegacyContextIncomplete(session)).toBe(false);
  });

  it("A6 rendered engine context mentions company, goal, audience", () => {
    const ctx = compileDepartmentContext(session);
    const text = renderCompiledContextForEngine(ctx);
    expect(text).toContain("Acme Cloud SL");
    expect(text).toContain("PYMEs");
    expect(text).toContain("MQL");
  });
});

/* ----------------------------------------------------------------------------
 * B) Legacy user with incomplete onboarding.
 * --------------------------------------------------------------------------*/

describe("Context readiness — legacy incomplete user", () => {
  it("B1 detects legacy user with empty onboarding", () => {
    const session = makeSession({
      onboarding: undefined,
      discoveryTranscript: [],
      marketingWork: undefined,
    });
    expect(isLegacyContextIncomplete(session)).toBe(true);
  });

  it("B2 detects legacy user with goal but no Company DNA", () => {
    const session = makeSession({
      onboarding: undefined,
      discoveryTranscript: [],
      marketingWork: {
        goal: "Crecer en LATAM",
        summary: "Plan LATAM",
        items: [],
      },
    });
    expect(isLegacyContextIncomplete(session)).toBe(true);
  });

  it("B3 reports gaps when onboarding is missing", () => {
    const session = makeSession({
      onboarding: undefined,
      discoveryTranscript: [],
      marketingWork: undefined,
    });
    const gaps = detectContextGaps(session);
    expect(gaps.length).toBeGreaterThanOrEqual(2);
    const ids = gaps.map((g) => g.id);
    expect(ids).toContain("company_identity");
    expect(ids).toContain("primary_goal");
  });

  it("B4 reports ready=false when gaps exist", () => {
    const session = makeSession({
      onboarding: undefined,
      discoveryTranscript: [],
      marketingWork: undefined,
    });
    const ctx = compileDepartmentContext(session);
    expect(ctx.ready).toBe(false);
    expect(ctx.gaps.length).toBeGreaterThan(0);
  });

  it("B5 legacy user is NOT re-interrogated for already-known facts", () => {
    const session = makeSession({
      organizationId: "org_partial",
      onboarding: {
        companyName: "Acme",
        hasWebsite: false,
        goal: "Crecer rápido",
      },
      discoveryTranscript: [],
    });
    // The user already has the company name and goal — only the
    // discovery transcript is missing. This should be the ONLY gap.
    const gaps = detectContextGaps(session);
    const ids = gaps.map((g) => g.id);
    expect(ids).not.toContain("company_identity");
    expect(ids).not.toContain("primary_goal");
    expect(ids).toContain("audience");
    expect(ids).toContain("market");
  });

  it("B6 syncCompiledContext records ready state and byte count", () => {
    const session = makeSession({
      onboarding: undefined,
      discoveryTranscript: [],
      marketingWork: undefined,
    });
    const ctx = compileDepartmentContext(session);
    const result = syncCompiledContext(ctx);
    expect(result.ready).toBe(false);
    expect(result.gaps.length).toBeGreaterThan(0);
    expect(result.payloadBytes).toBeGreaterThan(0);
    expect(typeof result.syncedAt).toBe("string");
  });
});

/* ----------------------------------------------------------------------------
 * C) Already-complete user must not be re-interrogated.
 * --------------------------------------------------------------------------*/

describe("Context readiness — already-complete user (no re-interrogation)", () => {
  let session: CustomerZeroSession;
  beforeEach(() => {
    session = makeSession({
      organizationId: "org_already_complete",
      onboarding: completeOnboarding(),
      discoveryTranscript: richDiscovery(),
      marketingWork: {
        goal: "Acelerar MQL→SQL",
        summary: "Plan trimestral",
        items: [
          {
            id: "obj_1",
            kind: "analysis",
            title: "Plan trimestral",
            description: "Plan completo",
            status: "completed",
          },
        ],
      },
      connections: new Map(),
    });
  });

  it("C1 second compile does not introduce new gaps", () => {
    const first = compileDepartmentContext(session);
    const second = compileDepartmentContext(session);
    expect(first.ready).toBe(true);
    expect(second.ready).toBe(true);
    expect(second.gaps).toEqual([]);
  });

  it("C2 syncCompiledContext reports ready=true and zero gaps", () => {
    const ctx = compileDepartmentContext(session);
    const result = syncCompiledContext(ctx);
    expect(result.ready).toBe(true);
    expect(result.gaps).toEqual([]);
  });

  it("C3 the compiled context payload does NOT contain secret values", () => {
    process.env["MAUTIC_BASE_URL"] = "https://secret-mautic.example.com";
    process.env["MAUTIC_CLIENT_ID"] = "SECRET_CLIENT_ID";
    process.env["MAUTIC_CLIENT_SECRET"] = "SECRET_CLIENT_SECRET";
    try {
      const ctx = compileDepartmentContext(session);
      const text = renderCompiledContextForEngine(ctx);
      const json = JSON.stringify(ctx);
      expect(text).not.toContain("SECRET_CLIENT_SECRET");
      expect(text).not.toContain("SECRET_CLIENT_ID");
      expect(json).not.toContain("SECRET_CLIENT_SECRET");
      expect(json).not.toContain("SECRET_CLIENT_ID");
    } finally {
      delete process.env["MAUTIC_BASE_URL"];
      delete process.env["MAUTIC_CLIENT_ID"];
      delete process.env["MAUTIC_CLIENT_SECRET"];
    }
  });
});

/* ----------------------------------------------------------------------------
 * Post-sync functional assertions.
 * --------------------------------------------------------------------------*/

describe("Post-sync functional — CEO questions answered with context", () => {
  it("F1 'Háblame de Marketing' produces a context-aware summary, not generic", () => {
    const session = makeSession({
      onboarding: completeOnboarding(),
      discoveryTranscript: richDiscovery(),
      marketingWork: {
        goal: "Reducir CAC 25%",
        summary: "Plan trimestral",
        items: [
          {
            id: "obj_1",
            kind: "analysis",
            title: "Reducir CAC 25%",
            description: "Plan trimestral",
            status: "running",
          },
        ],
      },
      connections: new Map(),
    });
    const ctx = compileDepartmentContext(session);
    const text = renderCompiledContextForEngine(ctx);
    // The compiled context must reference real company facts.
    expect(text).toContain("Acme Cloud SL");
    expect(text).toContain("MQL");
    expect(text).toContain("PYMEs");
    expect(text).toContain("Directora de Marketing");
    expect(ctx.ready).toBe(true);
  });

  it("F2 '¿Qué deberíamos hacer ahora?' compiles DNA + objective + capabilities + heartbeat", () => {
    process.env["MAUTIC_BASE_URL"] = "https://mautic.test";
    process.env["MAUTIC_CLIENT_ID"] = "client";
    process.env["MAUTIC_CLIENT_SECRET"] = "secret";
    try {
      const session = makeSession({
        onboarding: completeOnboarding(),
        discoveryTranscript: richDiscovery(),
        marketingWork: {
          goal: "Acelerar el pipeline MQL→SQL",
          summary: "Plan trimestral",
          items: [
            {
              id: "obj_1",
              kind: "analysis",
              title: "Reducir CAC 25%",
              description: "Acelerar MQL→SQL y reducir CAC",
              status: "running",
            },
          ],
        },
        connections: new Map(),
      });
      const ctx = compileDepartmentContext(session);
      const text = renderCompiledContextForEngine(ctx);
      // Real company DNA + objective + capabilities + heartbeat are
      // all present, so the answer is grounded in evidence.
      expect(text).toContain("Acme Cloud SL");
      expect(text).toContain("MQL");
      expect(text).toContain("Reducir CAC 25%");
      expect(text).toContain("crm.contacts.read");
      expect(text).toContain("HEARTBEAT");
    } finally {
      delete process.env["MAUTIC_BASE_URL"];
      delete process.env["MAUTIC_CLIENT_ID"];
      delete process.env["MAUTIC_CLIENT_SECRET"];
    }
  });
});

/* ----------------------------------------------------------------------------
 * Heartbeat directives.
 * --------------------------------------------------------------------------*/

describe("Heartbeat — Elvira proactive review directives", () => {
  it("H1 includes every required review area", () => {
    const session = makeSession({
      onboarding: completeOnboarding(),
      discoveryTranscript: richDiscovery(),
    });
    const ctx = compileDepartmentContext(session);
    const ids = ctx.heartbeat.map((h) => h.id);
    expect(ids).toContain("active_objectives");
    expect(ids).toContain("pending_approvals");
    expect(ids).toContain("tool_changes");
    expect(ids).toContain("opportunities");
    expect(ids).toContain("results");
  });

  it("H2 heartbeat directives carry non-zero cadence", () => {
    const session = makeSession({
      onboarding: completeOnboarding(),
      discoveryTranscript: richDiscovery(),
    });
    const ctx = compileDepartmentContext(session);
    for (const h of ctx.heartbeat) {
      expect(h.cadenceMinutes).toBeGreaterThan(0);
      expect(h.check.length).toBeGreaterThan(0);
    }
  });
});

/* ----------------------------------------------------------------------------
 * Identity separation.
 * --------------------------------------------------------------------------*/

describe("Identity / instructions / DNA / memory / heartbeat are separated", () => {
  it("I1 the compiled context has explicit sections for each layer", () => {
    const session = makeSession({
      onboarding: completeOnboarding(),
      discoveryTranscript: richDiscovery(),
    });
    const ctx: CompiledDepartmentContext = compileDepartmentContext(session);
    // All five required sections are present and non-empty.
    expect(ctx.identity).toBeDefined();
    expect(ctx.identity.standingInstructions.length).toBeGreaterThan(0);
    expect(ctx.companyDNA).toBeDefined();
    expect(ctx.marketingMemory).toBeDefined();
    expect(ctx.objectives).toBeDefined();
    expect(ctx.decisions).toBeDefined();
    expect(ctx.capabilities).toBeDefined();
    expect(ctx.connections).toBeDefined();
    expect(ctx.heartbeat).toBeDefined();
    expect(ctx.heartbeat.length).toBeGreaterThan(0);
  });

  it("I2 the rendered engine text marks each section", () => {
    const session = makeSession({
      onboarding: completeOnboarding(),
      discoveryTranscript: richDiscovery(),
    });
    const ctx = compileDepartmentContext(session);
    const text = renderCompiledContextForEngine(ctx);
    expect(text).toContain("INSTRUCCIONES PERMANENTES");
    expect(text).toContain("IDENTIDAD DE LA EMPRESA");
    expect(text).toContain("HEARTBEAT");
  });
});

// Silence unused-import warning for InMemoryCapabilityEventPublisher.
void InMemoryCapabilityEventPublisher;
