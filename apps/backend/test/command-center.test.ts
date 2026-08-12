/**
 * Command Center — Sprint 58 routing & integration tests.
 *
 * These tests cover the CEO Command Center behaviour:
 *
 *   - Greeting detection does not consume a routing decision.
 *   - Approval verbs with a pending approval route to a work item.
 *   - Tool mentions (Mautic, HubSpot, Gmail …) trigger integration discovery.
 *   - Existing tools that the CEO mentions already get a connection need.
 *   - Secrets NEVER appear in the Command Center output.
 *   - Multi-department requests are representable but not simulated.
 *   - The proactive opening surfaces the team, work and connection needs.
 *   - Existing Marketing Director V1 capabilities are reused (no duplicate).
 *   - Mautic is recognised as a meaningful CRM connector, not a wall.
 *
 * No live HTTP. The router is a pure function; the surrounding modules are
 * composed from the real runtime.
 */
import { describe, expect, it } from "vitest";

import {
  buildCommandCenterInput,
  buildProactiveOpening,
  isEmailReadFollowUp,
  discoverConnection,
  isEmailReadQuestion,
  isCalendarReadRequest,
  normalizeOperationalLanguage,
  routeCommandCenter,
  type CommandCenterInput,
} from "../src/customer-zero/command-center.js";
import { extractObjective, isEmailReplyRequest, isEmailSendRequest } from "../src/customer-zero/pending-email.js";
import {
  buildConnectionState,
  TOOL_CATALOG,
} from "../src/customer-zero/connections.js";
import { getCustomerZeroSession, getOrCreateCustomerZeroSession } from "../src/customer-zero/customer-zero-session.js";

function makeInput(overrides: Partial<CommandCenterInput> = {}): CommandCenterInput {
  return {
    organizationId: "org_moon",
    message: "",
    locale: "es",
    pendingApprovals: [],
    unreadResults: [],
    inflight: [],
    connections: [],
    unmappedTools: [],
    history: [],
    ...overrides,
  };
}

describe("Command Center routing", () => {
  it("normalizes near-miss operational words without a typo dictionary", () => {
    expect(normalizeOperationalLanguage("consulta mi mail y el calndario")).toBe(
      "consulta mi mail y el calendario",
    );
    expect(normalizeOperationalLanguage("respone al ultimo mail con ok")).toBe(
      "responde al ultimo mail con ok",
    );
    expect(normalizeOperationalLanguage("cea un evento en 10 mintos con hola")).toBe(
      "crea un evento en 10 minutos con hola",
    );
  });

  it("keeps Calendar create ownership through human typos and preserves Marketing objectives", () => {
    for (const message of [
      "crea un evento en 10 minutos con hola",
      "cea un evento en 10 mintos con hola",
      "pon una reunión mañana a las 11",
      "agenda una reunión mañana a las 11",
      "añade un evento mañana",
    ]) {
      const normalized = normalizeOperationalLanguage(message);
      const decision = routeCommandCenter(makeInput({ message: normalized }));
      expect(decision.decision.intent, message).toBe("calendar_create");
      expect(decision.decision.departments, message).toEqual([]);
    }

    expect(routeCommandCenter(makeInput({ message: "quiero conseguir más clientes este mes" })).decision).toMatchObject({
      intent: "delegate_marketing",
      departments: ["marketing"],
    });
  });

  it("keeps the Founder multi-intent request in operational routing", () => {
    const decision = routeCommandCenter(makeInput({
      message: normalizeOperationalLanguage("consulta mi ultimo mail y el calndario"),
    }));
    expect(decision.decision.intent).toBe("multi_capability");
    expect(decision.decision.departments).toEqual([]);
  });

  it("recognizes semantic multi-capability variants beyond email plus Calendar", () => {
    expect(routeCommandCenter(makeInput({
      message: "qué correos nuevos tengo y qué tareas están pendientes",
    })).decision.intent).toBe("multi_capability");
    expect(routeCommandCenter(makeInput({
      message: "consulta el calendario y las tareas pendientes",
    })).decision.intent).toBe("multi_capability");
  });

  it("routes a bare events follow-up to Calendar, never Marketing", () => {
    expect(isCalendarReadRequest("y eventos?")).toBe(true);
    const decision = routeCommandCenter(makeInput({ message: "y eventos?" }));
    expect(decision.decision.intent).toBe("calendar_read");
    expect(decision.decision.departments).toEqual([]);
  });

  it("preserves reply action, latest-email reference and body after typo normalization", () => {
    const normalized = normalizeOperationalLanguage("respone al ultimo mail con ok");
    expect(isEmailSendRequest(normalized)).toBe(true);
    expect(isEmailReplyRequest(normalized)).toBe(true);
    expect(extractObjective(normalized)).toBe("ok");
    expect(normalized).toContain("ok");
  });

  it("routes a quantity-only inbox follow-up to Gmail", () => {
    expect(isEmailReadFollowUp("los 3 últimos")).toBe(true);
    const decision = routeCommandCenter(makeInput({ message: "los 3 últimos" }));
    expect(decision.decision.intent).toBe("external_tool_query");
  });

  it("does not ask to reconnect an operational Gmail connection", () => {
    const decision = routeCommandCenter(makeInput({
      message: "reconecta",
      connections: [{
        ...buildConnectionState(TOOL_CATALOG.find((tool) => tool.id === "gmail")!, "es"),
        status: "connected",
      }],
    }));
    expect(decision.decision.intent).toBe("capability_status");
    expect(decision.reply.toLowerCase()).toContain("operativo");
    expect(decision.connectionSuggestion).toBeUndefined();
  });

  it("turns a genuine reconnect request into the contextual Gmail action", () => {
    const decision = routeCommandCenter(makeInput({ message: "reconecta" }));
    expect(decision.decision.intent).toBe("request_connection");
    expect(decision.connectionSuggestion?.toolId).toBe("gmail");
    expect(decision.connectionSuggestion?.connectable).toBe(true);
    expect(decision.reply.toLowerCase()).not.toContain("inicia sesión");
  });
  it("routes greetings without delegating to Marketing", () => {    const decision = routeCommandCenter(makeInput({ message: "Hola" }));
    expect(decision.decision.intent).toBe("greeting");
    expect(decision.decision.departments).toEqual([]);
  });

  it("routes 'cómo vamos' to a summary that surfaces work in progress", () => {
    const decision = routeCommandCenter(
      makeInput({
        message: "¿Cómo vamos?",
        inflight: [
          {
            id: "item_1",
            title: "Análisis de mercado",
            description: "Buscar las oportunidades más rápidas.",
            status: "running",
            kind: "analysis",
          },
        ],
      }),
    );
    expect(decision.decision.intent).toBe("explain_work");
    expect(decision.decision.departments).toContain("marketing");
    expect(decision.reply).toContain("Análisis de mercado");
  });

  it("routes approval verbs to a pending approval when there is one", () => {
    const decision = routeCommandCenter(
      makeInput({
        message: "Aprueba la propuesta",
        pendingApprovals: [
          {
            id: "item_3",
            title: "Lanzar la campaña de captación",
            description: "Campaña en redes para jóvenes profesionales.",
            status: "needs_approval",
            kind: "external_action",
          },
        ],
      }),
    );
    expect(decision.decision.intent).toBe("request_approval");
    expect(decision.pendingToolId).toBe("item_3");
  });

  it("does NOT route by keyword 'marketing' alone — it uses context", () => {
    const decision = routeCommandCenter(
      makeInput({
        message: "Quiero una campaña de marketing en LinkedIn.",
      }),
    );
    // Without pending approvals / results / inflight, the default is
    // delegate_marketing. The test asserts that the keyword "marketing"
    // alone does NOT set up a hallucinated approval path.
    expect(decision.decision.intent).toBe("delegate_marketing");
    expect(decision.decision.departments).toEqual(["marketing"]);
    expect(decision.pendingToolId).toBeUndefined();
  });

  it("rejects finance / invoices / payroll as 'unknown_department' without simulating", () => {
    const decision = routeCommandCenter(
      makeInput({ message: "Tengo facturas pendientes de cobro." }),
    );
    expect(decision.decision.intent).toBe("unknown_department");
    expect(decision.decision.departments).toContain("finance");
    expect(decision.reply).toContain("Marketing");
  });

  it("rejects Ventas / sales as 'unknown_department' without simulating", () => {
    const decision = routeCommandCenter(
      makeInput({ message: "Necesito un equipo de ventas para cerrar deals." }),
    );
    expect(decision.decision.intent).toBe("unknown_department");
    expect(decision.decision.departments).toContain("sales");
  });

  it("routes a contact-count question to external_tool_query when Mautic is connected", () => {
    const decision = routeCommandCenter(
      makeInput({
        message: "¿Cuántos contactos tenemos en Mautic?",
        connections: [
          {
            toolId: "mautic",
            label: "Mautic",
            capability: "crm.contacts",
            category: "CRM",
            status: "connected",
          },
        ],
      }),
    );
    expect(decision.decision.intent).toBe("external_tool_query");
  });

  it("routes a contact-count question to request_connection when Mautic is NOT connected", () => {
    const decision = routeCommandCenter(
      makeInput({ message: "¿Cuántos contactos tenemos en Mautic?" }),
    );
    expect(decision.decision.intent).toBe("request_connection");
  });

  it("P0 — ¿puedes leer mi último mail recibido? routes to external_tool_query (Gmail, not Mautic)", () => {
    // Regression for the routing bug: the bare English word "mail" was
    // missing from the email vocabulary regex, so "¿puedes leer mi último
    // mail recibido?" fell through to delegate_marketing → Elvira →
    // Mautic → "no ha podido acceder a Mautic en este momento" even
    // when Gmail was operationally connected.
    const decision = routeCommandCenter(
      makeInput({ message: "¿puedes leer mi último mail recibido?" }),
    );
    expect(decision.decision.intent).toBe("external_tool_query");
  });

  it("P0 — ¿tengo correos importantes? routes to external_tool_query (Gmail)", () => {
    const decision = routeCommandCenter(
      makeInput({ message: "¿tengo correos importantes?" }),
    );
    expect(decision.decision.intent).toBe("external_tool_query");
  });

  it("P0 — isEmailReadQuestion recognizes 'mail' as email vocabulary", () => {
    // Regression: bare "mail" was previously not in the alternation.
    expect(isEmailReadQuestion("¿puedes leer mi último mail recibido?")).toBe(true);
    expect(isEmailReadQuestion("lee mi último mail")).toBe(true);
    expect(isEmailReadQuestion("busca en mi mail")).toBe(true);
    // mailchimp must still NOT match (one word, no boundary).
    expect(isEmailReadQuestion("configura mailchimp")).toBe(false);
    // Non-email messages stay non-email.
    expect(isEmailReadQuestion("¿cuántos contactos tenemos?")).toBe(false);
  });

  it("routes 'pero ya tienes acceso al mautic' to capability_status with operational truth", () => {
    const decision = routeCommandCenter(
      makeInput({
        message: "pero ya tienes acceso al mautic",
        connections: [
          {
            toolId: "mautic",
            label: "Mautic",
            capability: "crm.contacts",
            category: "CRM",
            status: "connected",
          },
        ],
      }),
    );
    expect(decision.decision.intent).toBe("capability_status");
    expect(decision.reply).toContain("conectado y operativo");
    // Operational truth: never a reconnection instruction.
    expect(decision.reply).not.toContain("necesito conectarlo");
    expect(decision.reply).not.toContain("para conectarlo");
  });

  it("routeCommandCenter answer survives the outcome builder for capability_status", () => {
    const decision = routeCommandCenter(
      makeInput({
        message: "¿tienes acceso a Mautic?",
        connections: [
          {
            toolId: "mautic",
            label: "Mautic",
            capability: "crm.contacts",
            category: "CRM",
            status: "connected",
          },
        ],
      }),
    );
    expect(decision.decision.intent).toBe("capability_status");
    expect(decision.reply).toContain("conectado");
  });

  it("infrastructure commands are NEVER execution intents — 'Instala n8n' is a business need", () => {
    // The CEO chat is a business interface, not shell access. "Instala n8n"
    // must not route to any infra/execution intent and must not carry
    // install/exec phrasing in the reply. It falls back to the Marketing
    // Director (business interpretation), and the engine has no exec/install
    // capability surface.
    const decision = routeCommandCenter(
      makeInput({ message: "Instala n8n en el servidor." }),
    );
    expect(decision.decision.intent).not.toMatch(/install|exec|shell|system\./i);
    expect(decision.reply).not.toMatch(/apt\b|npm\s+install|docker\s+run|curl\s+\||systemctl/);
    // Business interpretation: it does not pretend to install software.
    expect(decision.reply.toLowerCase()).not.toContain("voy a instalarlo");
  });
});

describe("Integration discovery", () => {
  it("identifies Mautic as a CRM connector with the documented credential shape", () => {
    const suggestion = discoverConnection(
      makeInput({ message: "Ya te dije que usamos Mautic." }),
    );
    expect(suggestion.toolId).toBe("mautic");
    expect(suggestion.capability).toBe("crm.contacts");
    expect(suggestion.label).toBe("Mautic");
    // The required credentials are exposed as a list (NAMES), never VALUES.
    expect(suggestion.requiredCredentials).toContain("MAUTIC_BASE_URL");
    expect(suggestion.requiredCredentials).toContain("MAUTIC_CLIENT_ID");
    expect(suggestion.requiredCredentials).toContain("MAUTIC_CLIENT_SECRET");
    // The suggestion MUST NOT contain a credential value.
    expect(JSON.stringify(suggestion)).not.toContain("Bearer ");
    expect(JSON.stringify(suggestion)).not.toMatch(/secret\s*[:=]\s*['"]?[^'",}\s]+/);
  });

  it("respects the CEO's existing CRM — does not recommend HubSpot", () => {
    const suggestion = discoverConnection(
      makeInput({ message: "También usamos Mautic." }),
    );
    expect(suggestion.toolId).toBe("mautic");
    expect(JSON.stringify(suggestion)).not.toContain("HubSpot");
  });

  it("honestly explains the connection NEED with a why — never 'no soportado'", () => {
    const suggestion = discoverConnection(
      makeInput({ message: "Necesito Mautic conectado." }),
    );
    expect(suggestion.why.length).toBeGreaterThan(20);
    expect(suggestion.why).not.toMatch(/no soportado/i);
    expect(suggestion.why).not.toMatch(/not supported/i);
  });

  it("never returns a secret or credential value in the suggestion", () => {
    const suggestion = discoverConnection(
      makeInput({ message: "Conecta Mautic con token abc123" }),
    );
    // The structured fields (toolId, label, capability, why, requiredCredentials,
    // connectable) MUST NOT pick up a token the CEO typed by mistake. The
    // rawInput is the CEO's own message echo and is intentionally not part
    // of the structured payload sent to the LLM / transcript.
    const structured = {
      toolId: suggestion.toolId,
      label: suggestion.label,
      capability: suggestion.capability,
      why: suggestion.why,
      connectable: suggestion.connectable,
      requiredCredentials: suggestion.requiredCredentials,
    };
    expect(JSON.stringify(structured)).not.toContain("abc123");
  });

  it("Mentions of 'conectar' / 'integrate' without a tool name produce a clarification, not a fake", () => {
    const suggestion = discoverConnection(
      makeInput({ message: "Necesito integrar algo." }),
    );
    expect(suggestion.toolId).toBeNull();
    expect(suggestion.connectable).toBe(false);
    expect(suggestion.why.toLowerCase()).toContain("necesito saber");
  });

  it("the existing CRM tools (HubSpot, Salesforce, Pipedrive, Zoho) are recognised", () => {
    for (const id of ["hubspot", "salesforce", "pipedrive", "zoho"]) {
      const suggestion = discoverConnection(makeInput({ message: `Usamos ${id}.` }));
      expect(suggestion.toolId).toBe(id);
      expect(suggestion.capability).toBe("crm.contacts");
    }
  });

  it("the TOOL_CATALOG includes Mautic so it stops being unmapped", () => {
    const mautic = TOOL_CATALOG.find((tool) => tool.id === "mautic");
    expect(mautic).toBeTruthy();
    expect(mautic?.capability).toBe("crm.contacts");
  });
});

describe("Command Center input builder", () => {
  it("captures pending approvals, unread results and inflight work from the session", () => {
    const session = getOrCreateCustomerZeroSession("org_moon_test");
    session.state.marketingWork = {
      goal: "Conseguir los primeros 20 clientes",
      summary: "Plan para captar los primeros clientes.",
      items: [
        {
          id: "item_1",
          title: "Analizar el mercado",
          description: "Buscar las oportunidades más rápidas.",
          kind: "analysis",
          status: "running",
        },
        {
          id: "item_2",
          title: "Lanzar la campaña",
          description: "Campaña en redes.",
          kind: "external_action",
          status: "needs_approval",
        },
        {
          id: "item_3",
          title: "Análisis de competidores",
          description: "Lo que hace la competencia.",
          kind: "analysis",
          status: "completed",
          result: "Hay tres competidores principales en Barcelona.",
        },
      ],
    };
    const input = buildCommandCenterInput(session, "¿Cómo vamos?");
    expect(input.pendingApprovals).toHaveLength(1);
    expect(input.pendingApprovals[0]?.id).toBe("item_2");
    expect(input.unreadResults).toHaveLength(1);
    expect(input.unreadResults[0]?.id).toBe("item_3");
    expect(input.inflight).toHaveLength(1);
    expect(input.inflight[0]?.id).toBe("item_1");
  });

  it("preserves the session's locale", () => {
    const session = getOrCreateCustomerZeroSession("org_moon_locale", {
      locale: "en",
    });
    const input = buildCommandCenterInput(session, "How are we?");
    expect(input.locale).toBe("en");
  });
});

describe("Proactive opening", () => {
  it("surfaces Elvira, the team directory, work items and any connection needs", () => {
    const session = getOrCreateCustomerZeroSession("org_moon_proactive");
    session.state.marketingWork = {
      goal: "Conseguir los primeros 20 clientes",
      summary: "Plan para captar los primeros clientes.",
      items: [
        {
          id: "item_2",
          title: "Lanzar la campaña",
          description: "Campaña en redes.",
          kind: "external_action",
          status: "needs_approval",
        },
      ],
    };
    const mautic = buildConnectionState(
      TOOL_CATALOG.find((tool) => tool.id === "mautic")!,
      "es",
    );
    session.state.connections.set("mautic", mautic);
    const events = buildProactiveOpening(session);
    const kinds = events.map((event) => event.kind);
    expect(kinds).toContain("intent_proactive");
    expect(kinds).toContain("department_active");
    expect(kinds).toContain("approval_request");
    expect(kinds).toContain("multiple_departments_note");
    // Central Chat UX P0 — connection_need cards are NOT emitted from
    // the proactive opening. They render only when the CEO mentions
    // the tool, when the current task needs it, or when the current
    // task is blocked by it. The full catalog stays in /conexiones.
    expect(kinds).not.toContain("connection_need");
    // Multi-department note is honest: only Marketing is active.
    const multi = events.find((event) => event.kind === "multiple_departments_note");
    if (multi?.kind === "multiple_departments_note") {
      const active = multi.departments.find((d) => d.id === "marketing");
      const future = multi.departments.find((d) => d.id === "sales");
      expect(active?.status).toBe("active");
      expect(future?.status).toBe("future");
    }
  });

  it("does not fabricate work for departments that aren't active", () => {
    const session = getOrCreateCustomerZeroSession("org_moon_no_work");
    const events = buildProactiveOpening(session);
    for (const event of events) {
      if (event.kind === "work_update" || event.kind === "approval_request") {
        // No work has been done yet, so no work events should be emitted.
        throw new Error(`Unexpected work event: ${event.kind}`);
      }
    }
  });
});

describe("Marketing Director V1 reuse", () => {
  it("the routing pipeline routes free-form messages to the existing marketing.chat tool", () => {
    const decision = routeCommandCenter(
      makeInput({ message: "No sé mucho de marketing. ¿Qué harías tú?" }),
    );
    expect(decision.decision.intent).toBe("delegate_marketing");
    expect(decision.decision.departments).toEqual(["marketing"]);
  });

  it("the Command Center does NOT instantiate a new Director or Tool — it composes the existing one", () => {
    // The function is pure; it has no constructor/state. The runtime is
    // composed by the existing Customer Zero session when the route is hit.
    // This test simply documents that constraint.
    const decision = routeCommandCenter(makeInput({ message: "Idea creativa." }));
    expect(decision.decision.rationale).toBeTruthy();
  });
});

describe("Session continuity", () => {
  it("the Command Center looks up the same session used by Customer Zero", () => {
    const session = getOrCreateCustomerZeroSession("org_moon_continuity");
    expect(getCustomerZeroSession(session.organizationId)).toBe(session);
  });
});
