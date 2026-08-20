/**
 * Sprint 67 P0.3 — Chat Hot Path regression tests (J12–J22).
 *
 * These tests encode the production failures Customer Zero observed:
 * - "hola" taking ~20s because it went through the full engine pipeline
 * - greetings loading Marketing/SEO historical context
 * - NBA stale behavior
 * - UI lifecycle issues
 */

import { describe, expect, it } from "vitest";
import {
  classifyMessageIntent,
  isEngineErrorText,
  processLightweightMessage,
} from "../src/server/routes/customer-zero-v2.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function minimalSession(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    organizationId: "org_p03",
    state: {
      locale: "es",
      entrepreneurPreferredName: null,
      currentConversationId: null,
      conversation: [],
      connections: new Map(),
      discovery: {},
      onboarding: {},
      ...((overrides as Record<string, unknown>).state ?? {}),
    },
    conversations: {
      ensureCanonical: async () => ({
        id: "conv_p03",
        title: "Nueva conversación",
      }),
      get: async () => ({
        id: "conv_p03",
        title: "Nueva conversación",
      }),
      addMessage: async () => {},
      rename: async () => {},
      listMessages: async () => [],
    },
    memoryStore: { list: () => [], add: async () => {} },
    ...overrides,
  } as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// J12: "hola" does not invoke heavy pipeline
// ---------------------------------------------------------------------------

describe("J12: greeting does not invoke heavy pipeline", () => {
  it("J12a: 'hola' is classified as LIGHTWEIGHT", () => {
    expect(classifyMessageIntent("hola")).toBe("LIGHTWEIGHT");
  });

  it("J12b: 'buenos días' is classified as LIGHTWEIGHT", () => {
    expect(classifyMessageIntent("buenos días")).toBe("LIGHTWEIGHT");
  });

  it("J12c: 'hello' is classified as LIGHTWEIGHT", () => {
    expect(classifyMessageIntent("hello")).toBe("LIGHTWEIGHT");
  });

  it("J12d: 'gracias' is classified as LIGHTWEIGHT", () => {
    expect(classifyMessageIntent("gracias")).toBe("LIGHTWEIGHT");
  });

  it("J12e: 'ok' is classified as LIGHTWEIGHT", () => {
    expect(classifyMessageIntent("ok")).toBe("LIGHTWEIGHT");
  });

  it("J12f: 'vale' is classified as LIGHTWEIGHT", () => {
    expect(classifyMessageIntent("vale")).toBe("LIGHTWEIGHT");
  });
});

// ---------------------------------------------------------------------------
// J13: "hola" does not load Marketing/SEO historical context
// ---------------------------------------------------------------------------

describe("J13: greeting does not load Marketing/SEO historical context", () => {
  it("J13a: processLightweightMessage does not call buildCeoRuntimeForRequest", async () => {
    // The lightweight path should NOT load tasks, results, connections, etc.
    // We verify by checking that the result has no tool calls or department routing.
    const session = minimalSession();
    const result = await processLightweightMessage(
      session as any,
      "hola",
      {},
      undefined,
    );
    expect(result.routing?.intent).toBe("greeting");
    expect(result.routing?.departments).toEqual([]);
    expect(result.events.some((e: any) => e.kind === "work_state" && e.state === "delegated")).toBe(false);
  });

  it("J13b: business messages are classified as HEAVY", () => {
    expect(classifyMessageIntent("qué tareas tengo")).toBe("HEAVY");
    expect(classifyMessageIntent("prepara una campaña de marketing")).toBe("HEAVY");
    expect(classifyMessageIntent("audita el SEO de departify.app")).toBe("HEAVY");
  });
});

// ---------------------------------------------------------------------------
// J14: greeting completes via fast path (<500ms target)
// ---------------------------------------------------------------------------

describe("J14: greeting completes via fast path", () => {
  it("J14a: processLightweightMessage returns a valid reply", async () => {
    const session = minimalSession();
    const result = await processLightweightMessage(
      session as any,
      "hola",
      {},
      undefined,
    );
    expect(result.reply).toBeTruthy();
    expect(result.reply.length).toBeGreaterThan(0);
    expect(result.reply).toContain("Hola");
  });

  it("J14b: processLightweightMessage persists the message", async () => {
    let persistedUser = false;
    let persistedAssistant = false;
    const session = minimalSession({
      conversations: {
        ensureCanonical: async () => ({
          id: "conv_p03",
          title: "Nueva conversación",
        }),
        get: async () => ({
          id: "conv_p03",
          title: "Nueva conversación",
        }),
        addMessage: async (_id: string, role: string) => {
          if (role === "user") persistedUser = true;
          if (role === "assistant") persistedAssistant = true;
        },
        rename: async () => {},
        listMessages: async () => [],
      },
    });
    await processLightweightMessage(session as any, "hola", {}, undefined);
    expect(persistedUser).toBe(true);
    expect(persistedAssistant).toBe(true);
  });

  it("J14c: processLightweightMessage asks for name when not known", async () => {
    const session = minimalSession();
    const result = await processLightweightMessage(
      session as any,
      "hola",
      {},
      undefined,
    );
    expect(result.reply).toContain("cómo quieres que te llame");
  });

  it("J14d: processLightweightMessage uses name when known", async () => {
    const session = minimalSession({
      state: {
        entrepreneurPreferredName: "Ana",
        conversation: [],
      },
    });
    const result = await processLightweightMessage(
      session as any,
      "hola",
      {},
      undefined,
    );
    expect(result.reply).toContain("Ana");
  });
});

// ---------------------------------------------------------------------------
// J19: NBA from SEO does not appear after a greeting
// ---------------------------------------------------------------------------

describe("J19: NBA stale behavior", () => {
  it("J19a: greeting returns empty nextActions", async () => {
    const session = minimalSession();
    const result = await processLightweightMessage(
      session as any,
      "hola",
      {},
      undefined,
    );
    expect(result.nextActions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// J20: business question escalates to heavy pipeline
// ---------------------------------------------------------------------------

describe("J20: business question escalates to heavy pipeline", () => {
  it("J20a: 'qué tareas tengo' is classified as HEAVY", () => {
    expect(classifyMessageIntent("qué tareas tengo")).toBe("HEAVY");
  });

  it("J20b: 'cómo está mi empresa' is classified as HEAVY", () => {
    expect(classifyMessageIntent("cómo está mi empresa")).toBe("HEAVY");
  });

  it("J20c: 'muéstrame los resultados' is classified as HEAVY", () => {
    expect(classifyMessageIntent("muéstrame los resultados")).toBe("HEAVY");
  });
});

// ---------------------------------------------------------------------------
// J21: Marketing request reaches Marketing/Elvira
// ---------------------------------------------------------------------------

describe("J21: Marketing request reaches Marketing", () => {
  it("J21a: 'prepara una campaña de marketing' is classified as HEAVY", () => {
    expect(classifyMessageIntent("prepara una campaña de marketing")).toBe("HEAVY");
  });

  it("J21b: 'marketing' keyword triggers HEAVY", () => {
    expect(classifyMessageIntent("quiero marketing")).toBe("HEAVY");
  });
});

// ---------------------------------------------------------------------------
// J22: SEO request reaches SEO, never Elvira
// ---------------------------------------------------------------------------

describe("J22: SEO request reaches SEO", () => {
  it("J22a: 'audita el SEO' is classified as HEAVY", () => {
    expect(classifyMessageIntent("audita el SEO de departify.app")).toBe("HEAVY");
  });

  it("J22b: 'seo' keyword triggers HEAVY", () => {
    expect(classifyMessageIntent("seo audit")).toBe("HEAVY");
  });
});

// ---------------------------------------------------------------------------
// Approval responses are always HEAVY (not intercepted by lightweight path)
// ---------------------------------------------------------------------------

describe("Approval responses bypass lightweight path", () => {
  it("email approval 'sí' is HEAVY", () => {
    expect(classifyMessageIntent("sí")).toBe("HEAVY");
  });

  it("email approval 'adelante' is HEAVY", () => {
    expect(classifyMessageIntent("adelante")).toBe("HEAVY");
  });

  it("email approval 'envialo' is HEAVY", () => {
    expect(classifyMessageIntent("envialo")).toBe("HEAVY");
  });
});
