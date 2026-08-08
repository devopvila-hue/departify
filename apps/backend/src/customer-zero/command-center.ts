/**
 * Command Center — Sprint 58.
 *
 * The CEO's single conversational surface. The CEO talks to DEPARTIFY, not to
 * a specific department or agent. This module decides what to do with a free
 * form CEO message and produces a structured `CommandCenterOutcome` that the
 * portal can render as a chat transcript.
 *
 * It does NOT duplicate the Marketing Director, the Executive Director, the
 * Executive Orchestrator, the Tool Runtime, the Agent Tool Bridge or any
 * other existing abstraction. It composes them through their existing public
 * contracts:
 *
 *   - Reuses `marketing.chat` (from Core Tool Catalog) as the Marketing sink.
 *   - Reuses session state (work items, pending approvals, connections,
 *     unmapped tools, discovery reports) to make decisions.
 *   - Emits business events (work, approval, connection need, result) as
 *     messages in the transcript; the portal renders them as cards.
 *
 * Routing is deterministic when the message maps to a known business event
 * ("approve", "redo", "connect maútic/marketing", etc.) and falls back to
 * Marketing Director V1 for free-form strategy / reasoning questions. We do
 * NOT pattern-match on keywords like "marketing" — we use the session state
 * (objective, current department, work in progress, unmapped tools,
 * connections) to decide what the user actually wants.
 *
 * Multiple departments are representable: `RoutingDecision.departments` is a
 * list. Today the only active department is Marketing. When the CEO writes
 * something that clearly belongs to a future department we return an honest
 * "no activo" message instead of simulating work.
 *
 * SECURITY: secrets never enter this module. Connection needs are represented
 * as `kind: "needs_connection"` with a `ConnectionSuggestion` payload. The
 * surface that opens a secure credential input lives in the portal; the
 * backend only knows `connectionStatus` (connected / not_connected /
 * blocked) and a machine-readable `requiredCredentials` list.
 */
import { t, type SupportedLocale } from "./locale.js";
import {
  resolveTool,
  type ToolDescriptor,
  type ConnectionState,
} from "./connections.js";
import {
  getMarketingHead,
  headRole,
} from "./department-identity.js";
import {
  buildDnaSuggestion,
  listDepartmentMemory,
  type DnaSuggestion,
} from "./department-memory.js";
import type {
  CustomerZeroSession,
  MarketingWorkItemState,
} from "./customer-zero-session.js";

/** A single transcript event. The portal renders business events as cards. */
export type CommandCenterEvent =
  | { kind: "transcript"; role: "user" | "assistant"; content: string }
  | { kind: "intent_proactive"; intent: string; title: string; message: string }
  | {
      kind: "department_active";
      departmentId: string;
      departmentName: string;
      directorName: string;
      directorRole: string;
      directorInitials: string;
      team?: {
        director: { name: string; role: string; initials: string };
        specialists: { id: string; name: string; role: string; status: string }[];
      };
    }
  | { kind: "connection_need"; suggestion: ConnectionSuggestion }
  | { kind: "work_update"; item: WorkItemView }
  | {
      kind: "approval_request";
      item: WorkItemView;
      proposal: string;
      detail: string;
    }
  | { kind: "result"; item: WorkItemView }
  | {
      kind: "multiple_departments_note";
      departments: { id: string; name: string; status: "active" | "future" }[];
    }
  | {
      kind: "process_event";
      stage: string;
      status: "started" | "done" | "blocked";
      message: string;
    }
  | {
      kind: "department_memory";
      departmentId: string;
      departmentName: string;
      entries: { id: string; title: string; kind: string; importance: number }[];
    }
  | {
      kind: "dna_suggestion";
      suggestion: { title: string; content: string; fromDepartment: string; confidence: number };
    };

/** A work item projected for the CEO. */
export interface WorkItemView {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly result?: string;
  readonly capability?: string;
  readonly kind: string;
}

/** Connection need represented as a structured card. No credentials. */
export interface ConnectionSuggestion {
  /** Tool id, when the input resolved to a known ToolDescriptor. */
  readonly toolId: string | null;
  /** The label the CEO sees (e.g. "Mautic"). */
  readonly label: string;
  /** Capability the company needs from this connector. */
  readonly capability: string;
  /** Business reason for the connection — phrased in CEO language. */
  readonly why: string;
  /** Whether Departify can connect it today. */
  readonly connectable: boolean;
  /** What Departify needs from the CEO to connect it. */
  readonly requiredCredentials: readonly string[];
  /** Free-form text the CEO used (for context). */
  readonly rawInput: string;
}

export interface CommandCenterInput {
  readonly organizationId: string;
  readonly message: string;
  readonly locale: SupportedLocale;
  /** Pending CEO approval requests keyed by work item id. */
  readonly pendingApprovals: readonly WorkItemView[];
  /** Result items that have completed but the CEO hasn't read yet. */
  readonly unreadResults: readonly WorkItemView[];
  /** In-progress work items. */
  readonly inflight: readonly WorkItemView[];
  /** Connections (Mautic, HubSpot, Gmail, etc.) — connected or not. */
  readonly connections: readonly ConnectionState[];
  /** Tools the CEO mentioned that Departify has no connector for. */
  readonly unmappedTools: readonly string[];
  /** Recent history from the same conversation. */
  readonly history: readonly { role: "user" | "assistant"; content: string }[];
}

export interface CommandCenterOutcome {
  /** Reply that reflects the CEO's intent. Always present. */
  readonly reply: string;
  /** Structured events appended to the transcript. */
  readonly events: readonly CommandCenterEvent[];
  /** Routing decision — what departments / actions were considered. */
  readonly routing: RoutingDecision;
  /** Surface attachment: a transient tool id the CEO can act on. */
  readonly pendingToolId?: string;
  /** Connection need, if the message triggered integration discovery. */
  readonly connectionSuggestion?: ConnectionSuggestion;
}

export interface RoutingDecision {
  /** Identified intent (machine label, not a strict category). */
  readonly intent:
    | "direct_response"
    | "delegate_marketing"
    | "request_approval"
    | "request_connection"
    | "explain_work"
    | "explain_existing_result"
    | "summarize_company"
    | "needs_clarification"
    | "unknown_department"
    | "greeting"
    | "knowledge_query"
    | "remember_fact"
    | "external_tool_query";
  /** Departments that acted or were considered. Today only `marketing`. */
  readonly departments: readonly string[];
  /** Why this decision was made. */
  readonly rationale: string;
}

/* -------------------------------------------------------------------------
 * Deterministic routing rules.
 *
 * Routing is NOT keyword-based; it uses business context. A message routing
 * decision depends on:
 *
 *   - the current objective (if any)
 *   - the company's existing connections and unmapped tools
 *   - whether there are pending approvals, results, or work in progress
 *   - the explicit verb/intent structure of the message
 *
 * The router is a pure function of (message, input). It does NOT call the
 * Marketing Director itself; the orchestrator (post-routing) calls
 * `marketing.chat` when the decision is `delegate_marketing`.
 * -------------------------------------------------------------------------*/

interface RoutingRule {
  readonly intent: RoutingDecision["intent"];
  readonly rationale: string;
  match(input: CommandCenterInput): boolean;
}

const ROUTING_RULES: readonly RoutingRule[] = [
  {
    intent: "greeting",
    rationale: "The CEO is greeting or thanking; no action required.",
    match: (input) =>
      /^\s*(hola|buenos[ ]?días|buenas|gracias|muchas gracias|hello|hi|thanks|thank you)\s*[.!?]?\s*$/i.test(
        input.message,
      ),
  },
  {
    intent: "request_approval",
    rationale: "Approval verb detected and at least one item is awaiting approval.",
    match: (input) =>
      APPROVAL_VERBS.test(input.message) && input.pendingApprovals.length > 0,
  },
  {
    intent: "explain_existing_result",
    rationale: "Result-orientation verb detected and there are unread results.",
    match: (input) =>
      RESULT_VERBS.test(input.message) && input.unreadResults.length > 0,
  },
  {
    intent: "explain_work",
    rationale: "Status verb detected and work is in progress.",
    match: (input) =>
      STATUS_VERBS.test(input.message) && input.inflight.length > 0,
  },
  {
    intent: "summarize_company",
    rationale:
      "The CEO is asking how the company is doing — summary is the right action.",
    match: (input) =>
      /\b(como vamos|cómo vamos|c[óo]mo va|estado|situaci[óo]n|resumen|summary|how (are|is) (we|the company|things)|overview)\b/i.test(
        input.message,
      ),
  },
  {
    intent: "request_connection",
    rationale:
      "A tool name or capability is mentioned. Departify will check whether it can connect it.",
    match: (input) => /\b(mautic|hubspot|salesforce|mailchimp|gmail|outlook|whatsapp|telegram|slack|notion|zoho|pipedrive| veinti twenty|veinte)\b/i.test(
      input.message,
    ) || /\b(conecta|conectar|integraci[óo]n|integrate|connect)\b/i.test(input.message),
  },
  {
    intent: "unknown_department",
    rationale:
      "Message clearly references a capability that is not part of an active department today.",
    match: (input) =>
      /\b(facturas|invoice|facturaci[óo]n|n[óo]minas|payroll|contabilidad|accounting|finanzas|finance|cobros|pagos|equipo de ventas|deal|deals|cerrar tratos|comercial|sales)\b/i.test(
        input.message,
      ),
  },
  {
    intent: "remember_fact",
    rationale:
      "The CEO wants Marketing to remember something.",
    match: (input) =>
      /\b(recuerda|acuérdate|ap[úu]nta(te|me)?|guarda|anota|recuerdas|recuerdas de|no olvides|remember|note this|make a note)\b.{4,}/i.test(
        input.message,
      ),
  },
  {
    intent: "knowledge_query",
    rationale:
      "The CEO is asking what Marketing has learned or remembers.",
    match: (input) =>
      /\b(qu[ée]\s+(has|hemos|hab[ée]is)\s+aprendido|qu[ée]\s+(sabes|sab[ée]is|recuerdas|recuerdas de|conoces|conocemos)\b|what\s+(have|do)\s+(we|you)\s+(learned|know|remember)|aprendizaje|lo aprendido|hemos aprendido|has aprendido)\b/i.test(
        input.message,
      ),
  },
  {
    intent: "external_tool_query",
    rationale:
      "The CEO is asking a business question that requires querying a connected external tool (Mautic, CRM, etc.).",
    match: (input) =>
      /\b(mautic|contactos?|contacts?|cu[áa]ntos\s+contactos?|cu[áa]ntas?\s+personas?|how many contacts|lista de contactos|busca\s+en\s+mautic|busca\s+contactos|search\s+contacts)\b/i.test(
        input.message,
      ),
  },
];

const APPROVAL_VERBS =
  /\b(aprobar|aprueba|apruebo|aprueb[a-záàäeéèíìöüñ]*lo|apruebe|approved?|approve|si[,\s]+hazlo|dale|hazlo|hazlo ya|go ahead|adelante|confirma|confirmar|de acuerdo|ok\s*hazlo)\b/i;
const RESULT_VERBS =
  /\b(resultados?|result|entregable|lo que (han|hizo|tienen)|what did|show me|muestra|ver resultado)\b/i;
const STATUS_VERBS =
  /\b(qu[ée] hace|qu[ée] est[áa]n|estado|status|progreso|progress|working on|trabajando|c[óo]mo vamos|c[óo]mo va)\b/i;

/**
 * Route a CEO message. Pure function. Returns a structured intent that the
 * caller can act on: build a reply, append events, call Marketing when
 * delegating, surface a connection card when needed.
 */
export function routeCommandCenter(input: CommandCenterInput): {
  decision: RoutingDecision;
  reply: string;
  pendingToolId?: string;
  connectionSuggestion?: ConnectionSuggestion;
} {
  for (const rule of ROUTING_RULES) {
    if (rule.match(input)) {
      return buildRuleOutcome(input, rule);
    }
  }
  // Default: delegate to Marketing Director V1, which already knows the
  // company DNA and can answer strategy questions grounded in evidence.
  return {
    decision: {
      intent: "delegate_marketing",
      departments: ["marketing"],
      rationale:
        "Free-form message — Marketing Director is the right conversational sink today.",
    },
    reply: t(
      input.locale,
      "Lo paso a Elvira, tu jefa de Marketing. Te cuento en un momento.",
      "I'll pass it to Elvira, your Head of Marketing. I'll get back to you in a moment.",
    ),
  };
}

function buildRuleOutcome(
  input: CommandCenterInput,
  rule: RoutingRule,
): {
  decision: RoutingDecision;
  reply: string;
  pendingToolId?: string;
  connectionSuggestion?: ConnectionSuggestion;
} {
  switch (rule.intent) {
    case "greeting":
      return {
        decision: {
          intent: "greeting",
          departments: [],
          rationale: rule.rationale,
        },
        reply: t(
          input.locale,
          "Hola. Estoy aquí. Dime qué necesitas conseguir y pongo al equipo con ello.",
          "Hello. I'm here. Tell me what you want to achieve and I'll put the team on it.",
        ),
      };
    case "request_approval": {
      const target = input.pendingApprovals[0];
      if (!target) {
        return {
          decision: {
            intent: "request_approval",
            departments: ["marketing"],
            rationale: rule.rationale,
          },
          reply: t(
            input.locale,
            "No hay nada pendiente de aprobación ahora mismo.",
            "There's nothing pending approval right now.",
          ),
        };
      }
      return {
        decision: {
          intent: "request_approval",
          departments: ["marketing"],
          rationale: rule.rationale,
        },
        reply: t(
          input.locale,
          "Vamos a aprobarlo. Pulsa Aprobar en la tarjeta para confirmar.",
          "Let's approve it. Press Approve on the card to confirm.",
        ),
        pendingToolId: target.id,
      };
    }
    case "explain_existing_result": {
      const head = getMarketingHead();
      const r = input.unreadResults[0];
      if (!r) {
        return {
          decision: {
            intent: "explain_existing_result",
            departments: ["marketing"],
            rationale: rule.rationale,
          },
          reply: t(
            input.locale,
            "No hay resultados nuevos del equipo todavía.",
            "There are no new results from the team yet.",
          ),
        };
      }
      return {
        decision: {
          intent: "explain_existing_result",
          departments: ["marketing"],
          rationale: rule.rationale,
        },
        reply: t(
          input.locale,
          `${head.name} ya terminó "${r.title}". Te resumo: ${r.result ?? "—"}`,
          `${head.name} has finished "${r.title}". Summary: ${r.result ?? "—"}`,
        ),
      };
    }
    case "explain_work": {
      const head = getMarketingHead();
      const inflight = input.inflight[0];
      if (!inflight) {
        return {
          decision: {
            intent: "explain_work",
            departments: ["marketing"],
            rationale: rule.rationale,
          },
          reply: t(
            input.locale,
            "Marketing no tiene nada en marcha ahora mismo.",
            "Marketing has nothing in progress right now.",
          ),
        };
      }
      return {
        decision: {
          intent: "explain_work",
          departments: ["marketing"],
          rationale: rule.rationale,
        },
        reply: t(
          input.locale,
          `${head.name} está ahora mismo con: ${inflight.title}.`,
          `${head.name} is currently working on: ${inflight.title}.`,
        ),
      };
    }
    case "summarize_company":
      return {
        decision: {
          intent: "summarize_company",
          departments: ["marketing"],
          rationale: rule.rationale,
        },
        reply: t(
          input.locale,
          "Déjame mirar el estado de la empresa y vuelvo en un momento.",
          "Let me check the company state and come back in a moment.",
        ),
      };
    case "request_connection":
      return buildConnectionOutcome(input);
    case "unknown_department":
      return buildUnknownDepartmentOutcome(input);
    default:
      return {
        decision: {
          intent: "direct_response",
          departments: [],
          rationale: rule.rationale,
        },
        reply: t(
          input.locale,
          "No estoy seguro de qué quieres decir. Cuéntamelo con más detalle.",
          "I'm not sure what you mean. Tell me a bit more.",
        ),
      };
  }
}

function buildConnectionOutcome(input: CommandCenterInput): {
  decision: RoutingDecision;
  reply: string;
  connectionSuggestion?: ConnectionSuggestion;
} {
  const suggestion = discoverConnection(input);
  return {
    decision: {
      intent: "request_connection",
      departments: ["marketing"],
      rationale: suggestion.connectable
        ? `Integration discovery identified ${suggestion.label} as a connectable capability.`
        : `Integration discovery identified ${suggestion.label} but it cannot be connected today.`,
    },
    reply: suggestion.connectable
      ? t(
          input.locale,
          `${suggestion.label} puede entrar en tu empresa. ${suggestion.why} Te indico qué necesito para conectarlo.`,
          `${suggestion.label} can join your company. ${suggestion.why} I'll tell you what I need to connect it.`,
        )
      : t(
          input.locale,
          `${suggestion.label} todavía no lo podemos conectar, pero ${suggestion.why} En cuanto esté, Elvira puede seguir con el trabajo que depende de ello.`,
          `${suggestion.label} can't be connected yet, but ${suggestion.why} When it is, Elvira can continue the work that depends on it.`,
        ),
    connectionSuggestion: suggestion,
  };
}

function buildUnknownDepartmentOutcome(input: CommandCenterInput): {
  decision: RoutingDecision;
  reply: string;
} {
  return {
    decision: {
      intent: "unknown_department",
      departments: ["sales", "finance", "operations"],
      rationale:
        "The CEO wrote about a capability (invoicing, payroll, accounting, finance, payments, sales) that today has no active department in Departify.",
    },
    reply: t(
      input.locale,
      "Hoy por hoy Departify solo tiene activo Marketing. La parte que describes (finanzas, facturación, cobros o nóminas) aún no está en marcha. Te lo recuerdo en cuanto la habilitemos.",
      "Right now only Marketing is active in Departify. The area you describe (finance, invoicing, payments or payroll) is not yet up. I'll remind you as soon as we enable it.",
    ),
  };
}

/* -------------------------------------------------------------------------
 * Integration discovery — replace "no soportado" with a real exploration.
 *
 * The CEO's free-form text is parsed and matched against the existing
 * connector catalog. We never force a recommendation that contradicts the
 * CEO's stack — if they already use Mautic, Priority is to integrate Mautic,
 * not to push a different CRM.
 * -------------------------------------------------------------------------*/

const TOOL_KEYWORDS: readonly { keywords: readonly RegExp[]; toolId: string }[] = [
  { keywords: [/\bmautic\b/i], toolId: "mautic" },
  { keywords: [/\bhubspot\b/i], toolId: "hubspot" },
  { keywords: [/\bsalesforce\b/i], toolId: "salesforce" },
  { keywords: [/\bpipedrive\b/i], toolId: "pipedrive" },
  { keywords: [/\bzoho\b/i], toolId: "zoho" },
  { keywords: [/\bmailchimp\b/i], toolId: "mailchimp" },
  { keywords: [/\bgmail\b/i, /google mail/i], toolId: "gmail" },
  { keywords: [/\boutlook\b/i, /hotmail/i, /microsoft 365/i], toolId: "outlook" },
  { keywords: [/\bwhatsapp\b/i], toolId: "whatsapp" },
  { keywords: [/\btelegram\b/i], toolId: "telegram" },
  { keywords: [/\bslack\b/i], toolId: "slack" },
  { keywords: [/\bnotion\b/i], toolId: "notion" },
];

/**
 * Find the connector the CEO mentioned (or wanted) and produce a
 * fully-formed connection suggestion. If the tool is not in the catalog we
 * still produce a suggestion with `toolId: null` so the portal can show an
 * honest "we are preparing this" message.
 */
export function discoverConnection(
  input: CommandCenterInput,
): ConnectionSuggestion {
  const text = input.message;
  const lower = text.toLowerCase();

  // 1. Prefer an existing connection that the CEO mentioned but isn't linked.
  for (const known of input.connections) {
    if (lower.includes(known.toolId) || lower.includes(known.label.toLowerCase())) {
      const why = whyForCapability(known.capability, input.locale);
      return {
        toolId: known.toolId,
        label: known.label,
        capability: known.capability,
        why,
        connectable: known.status === "connected",
        requiredCredentials: [],
        rawInput: text,
      };
    }
  }

  // 2. Match CEO's free text to a known tool descriptor.
  for (const entry of TOOL_KEYWORDS) {
    if (entry.keywords.some((re) => re.test(text))) {
      const tool = resolveTool(entry.toolId);
      if (tool) {
        return toolToSuggestion(tool, input, text);
      }
      // Tool alias matched but the catalog has no entry — still produce a
      // honest suggestion for the portal.
      return {
        toolId: entry.toolId,
        label: humanizeToolId(entry.toolId),
        capability: inferCapability(entry.toolId),
        why: t(
          input.locale,
          `Tu equipo necesita ${inferCapability(entry.toolId)} para trabajar con ${humanizeToolId(entry.toolId)}.`,
          `Your team needs ${inferCapability(entry.toolId)} to work with ${humanizeToolId(entry.toolId)}.`,
        ),
        connectable: false,
        requiredCredentials: [],
        rawInput: text,
      };
    }
  }

  // 3. The CEO wrote "integrar" / "conectar" but didn't name a tool — ask
  // for clarification but keep things grounded.
  return {
    toolId: null,
    label: t(input.locale, "Una herramienta nueva", "A new tool"),
    capability: "unspecified",
    why: t(
      input.locale,
      "Necesito saber qué herramienta usas para ayudarte a decidir si la integramos.",
      "I need to know which tool you use so I can decide whether to integrate it.",
    ),
    connectable: false,
    requiredCredentials: [],
    rawInput: text,
  };
}

function toolToSuggestion(
  tool: ToolDescriptor,
  input: CommandCenterInput,
  text: string,
): ConnectionSuggestion {
  const why = whyForCapability(tool.capability, input.locale);
  return {
    toolId: tool.id,
    label: tool.label,
    capability: tool.capability,
    why,
    connectable: tool.connectable,
    requiredCredentials: tool.requiredCredentials,
    rawInput: text,
  };
}

function whyForCapability(capability: string, locale: SupportedLocale): string {
  switch (capability) {
    case "crm.contacts":
      return t(
        locale,
        "Para gestionar tus leads y su seguimiento, Marketing necesita acceso a tu CRM.",
        "To manage your leads and track them, Marketing needs access to your CRM.",
      );
    case "email.send":
      return t(
        locale,
        "Para enviar emails y campañas, Marketing necesita conectarse a tu correo.",
        "To send emails and campaigns, Marketing needs to connect to your email.",
      );
    case "messaging.direct":
      return t(
        locale,
        "Para hablar con tus clientes, Marketing necesita acceso a tu mensajería.",
        "To talk to your customers, Marketing needs access to your messaging.",
      );
    case "workspace.documents":
      return t(
        locale,
        "Para colaborar en documentos, Marketing necesita acceso a tu espacio de trabajo.",
        "To collaborate on documents, Marketing needs access to your workspace.",
      );
    case "ads.manage":
      return t(
        locale,
        "Para gestionar campañas de pago, Marketing necesita conectarse a tu plataforma de ads.",
        "To manage paid campaigns, Marketing needs to connect to your ads platform.",
      );
    case "analytics.web":
      return t(
        locale,
        "Para medir resultados, Marketing necesita tu analítica web.",
        "To measure results, Marketing needs your web analytics.",
      );
    default:
      return t(
        locale,
        "Para hacer este trabajo, Marketing necesita acceder a esta herramienta.",
        "To do this work, Marketing needs access to this tool.",
      );
  }
}

function humanizeToolId(id: string): string {
  return id
    .split(/[_-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function inferCapability(id: string): string {
  if (/(gmail|outlook|mailchimp|smtp|sendgrid|mailgun)/i.test(id)) return "email.send";
  if (/(hubspot|salesforce|pipedrive|zoho|mautic|twenty|intercom)/i.test(id))
    return "crm.contacts";
  if (/(whatsapp|telegram|slack|sms)/i.test(id)) return "messaging.direct";
  if (/(notion|google_workspace|microsoft_365|gdrive)/i.test(id))
    return "workspace.documents";
  if (/(google_ads|meta_ads|facebook|instagram|linkedin)/i.test(id)) return "ads.manage";
  if (/(google_analytics|plausible|posthog|matomo)/i.test(id)) return "analytics.web";
  return "unspecified";
}

/* -------------------------------------------------------------------------
 * Proactive enrichment — when the CEO opens the Command Center we surface
 * who is working, what is happening, and what needs them. This is what makes
 * the chat feel like a Command Center instead of an empty inbox.
 * -------------------------------------------------------------------------*/

export function buildProactiveOpening(
  session: CustomerZeroSession,
): CommandCenterEvent[] {
  const events: CommandCenterEvent[] = [];
  const head = getMarketingHead();
  const work = session.state.marketingWork;

  const marketingActive = !!work;
  const objective = work?.goal ?? session.state.onboarding?.goal ?? null;

  events.push({
    kind: "intent_proactive",
    intent: "open",
    title: t(
      session.state.locale,
      "Elvira toma la iniciativa",
      "Elvira takes the initiative",
    ),
    message: objective
      ? buildProactiveStrategyMessage(session.state.locale, objective, work)
      : t(
          session.state.locale,
          "Elvira ya está lista para ponerse a trabajar. Dile qué quieres conseguir.",
          "Elvira is ready to start working. Tell her what you want to achieve.",
        ),
  });

  if (marketingActive) {
    const team = session.state.marketingTeam;
    events.push({
      kind: "department_active",
      departmentId: "marketing",
      departmentName: "Marketing",
      directorName: head.name,
      directorRole: headRole(head, session.state.locale),
      directorInitials: head.initials,
      ...(team
        ? {
            team: {
              director: team.director,
              specialists: team.specialists.map((s) => ({
                id: s.id,
                name: s.name,
                role: s.role,
                status: s.status,
              })),
            },
          }
        : {}),
    });
  }

  // Surface work items as cards (pending approvals, blocked, in progress).
  if (work) {
    for (const item of work.items) {
      if (item.status === "needs_approval") {
        events.push({
          kind: "approval_request",
          item: projectItem(item),
          proposal: t(
            session.state.locale,
            `Elvira necesita tu aprobación para ${lowerFirst(item.title)}.`,
            `Elvira needs your approval for ${lowerFirst(item.title)}.`,
          ),
          detail: item.description,
        });
      } else if (item.status === "unavailable") {
        events.push({
          kind: "work_update",
          item: projectItem(item),
        });
      } else if (item.status === "completed") {
        events.push({
          kind: "result",
          item: projectItem(item),
        });
      } else if (
        item.status === "running" ||
        item.status === "pending" ||
        item.status === "approved"
      ) {
        events.push({
          kind: "work_update",
          item: projectItem(item),
        });
      }
    }
  }

  // Surface connection needs (Mautic discovery or any declared but unconnected
  // tool). This is the proactive "integration discovery" UX: instead of
  // "no soportado", we say "Vemos que usas X; Marketing necesita Y".
  const connections = [...session.state.connections.values()];
  const unmapped = session.state.unmappedTools ?? [];
  for (const conn of connections) {
    if (conn.status !== "connected") {
      events.push({
        kind: "connection_need",
        suggestion: projectConnectionSuggestion(conn, session.state.locale),
      });
    }
  }
  for (const unmappedName of unmapped) {
    events.push({
      kind: "connection_need",
      suggestion: {
        toolId: resolveTool(unmappedName)?.id ?? null,
        label: humanizeToolId(unmappedName),
        capability: inferCapability(unmappedName),
        why: t(
          session.state.locale,
          `${humanizeToolId(unmappedName)} todavía no está preparado en Departify, pero tu equipo lo necesita.`,
          `${humanizeToolId(unmappedName)} is not ready in Departify yet, but your team needs it.`,
        ),
        connectable: false,
        requiredCredentials: [],
        rawInput: unmappedName,
      },
    });
  }

  // Multi-department future hint, kept honest: Marketing is the only active
  // department today. The CEO doesn't need to manage this — but they need
  // to know why, for example, an invoicing question is not answered.
  events.push({
    kind: "multiple_departments_note",
    departments: [
      { id: "marketing", name: "Marketing", status: "active" },
      { id: "sales", name: "Ventas", status: "future" },
      { id: "finance", name: "Finanzas", status: "future" },
      { id: "operations", name: "Operaciones", status: "future" },
    ],
  });

  // Department memory summary — subtle. Only surfaced if there are entries.
  const marketingMem = listDepartmentMemory(session, "marketing", { limit: 5 });
  if (marketingMem.length > 0) {
    events.push({
      kind: "department_memory",
      departmentId: "marketing",
      departmentName: "Marketing",
      entries: marketingMem.map((entry) => ({
        id: entry.id,
        title: entry.title,
        kind: entry.kind,
        importance: entry.importance,
      })),
    });
  }

  // DNA suggestion — only surfaced when Marketing has discovered something
  // that looks like shared truth. Today the heuristic is intentionally
  // minimal: any department memory tagged "result" with importance >= 0.7
  // becomes a candidate. Marketing NEVER writes the DNA directly; the CEO
  // explicitly approves.
  const suggestions = marketingMem
    .filter((m) => m.kind === "result" && m.importance >= 0.7)
    .map((m) =>
      buildDnaSuggestion({
        fromDepartment: "marketing",
        title: m.title,
        content: m.content,
        kind: m.kind,
        evidence: [m.source ?? m.kind],
        confidence: m.importance,
      }),
    );
  for (const s of suggestions) {
    events.push({ kind: "dna_suggestion", suggestion: dnaView(s) });
  }

  return events;
}

function dnaView(s: DnaSuggestion) {
  return {
    title: s.title,
    content: s.content,
    fromDepartment: s.fromDepartment,
    confidence: s.confidence,
    kind: s.kind,
  };
}

function projectItem(item: MarketingWorkItemState): WorkItemView {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    status: item.status,
    ...(item.result !== undefined ? { result: item.result } : {}),
    ...(item.capability !== undefined ? { capability: item.capability } : {}),
    kind: item.kind,
  };
}

function projectConnectionSuggestion(
  conn: ConnectionState,
  locale: SupportedLocale,
): ConnectionSuggestion {
  const tool = resolveTool(conn.toolId);
  return {
    toolId: conn.toolId,
    label: conn.label,
    capability: conn.capability,
    why: whyForCapability(conn.capability, locale),
    connectable: tool?.connectable ?? false,
    requiredCredentials: tool?.requiredCredentials ?? [],
    rawInput: conn.toolId,
  };
}

function lowerFirst(value: string): string {
  return value.length > 0 ? `${value[0]?.toLowerCase()}${value.slice(1)}` : value;
}

/**
 * Build a substantive, goal-grounded strategy message for the proactive
 * opening. The CEO must feel "Departify knows my company" — not a generic
 * chatbot. The message uses the work items, the typed capabilities, and
 * the company's existing tools to give a concrete first plan.
 *
 * Falls back to a shorter statement for early sessions that have no work
 * yet (the CEO will see the empty state in the chat).
 */
function buildProactiveStrategyMessage(
  locale: SupportedLocale,
  objective: string,
  work: import("./customer-zero-session.js").MarketingWorkState | undefined,
): string {
  const items = work?.items ?? [];
  const ready = items.filter((it) => !["unavailable", "failed"].includes(it.status));
  const blocked = items.filter((it) => it.status === "unavailable");

  if (items.length === 0) {
    return t(
      locale,
      `Para conseguir tu objetivo (${objective}), Elvira está organizando el primer plan. Te aviso en cuanto tenga algo concreto que puedas revisar.`,
      `To achieve your goal (${objective}), Elvira is organising the first plan. I'll notify you as soon as she has something concrete to review.`,
    );
  }

  if (locale === "en") {
    const readyTitles = ready.slice(0, 3).map((it) => it.title).join("; ");
    const blockedTitles = blocked.map((it) => it.title).join("; ");
    let msg = `To achieve your goal (${objective}), here is where we are:`;
    if (readyTitles) {
      msg += `\n\nAlready in motion: ${readyTitles}.`;
    }
    if (blockedTitles) {
      msg += `\n\nWaiting on a connection: ${blockedTitles}. I'll keep working on the rest in the meantime.`;
    }
    msg += `\n\nTell me what to prioritise or ask me anything about the plan.`;
    return msg;
  }

  const readyTitles = ready
    .slice(0, 3)
    .map((it) => lowerFirst(it.title))
    .join("; ");
  const blockedTitles = blocked
    .map((it) => lowerFirst(it.title))
    .join("; ");
  let msg = `Para conseguir tu objetivo (${objective}), esto es lo que hay ahora mismo:`;
  if (readyTitles) {
    msg += `\n\nYa en marcha: ${readyTitles}.`;
  }
  if (blockedTitles) {
    msg += `\n\nEsperando una conexión: ${blockedTitles}. Sigo trabajando en todo lo demás mientras tanto.`;
  }
  msg += `\n\nDime qué quieres priorizar o pregúntame cualquier cosa del plan.`;
  return msg;
}

/* -------------------------------------------------------------------------
 * Helper for the orchestrator: build the input for `routeCommandCenter`
 * from a real session, so the route handler is a single line.
 * -------------------------------------------------------------------------*/

export function buildCommandCenterInput(
  session: CustomerZeroSession,
  message: string,
): CommandCenterInput {
  const work = session.state.marketingWork;
  const items = work?.items ?? [];
  const pendingApprovals: WorkItemView[] = items
    .filter((item) => item.status === "needs_approval")
    .map(projectItem);
  const unreadResults: WorkItemView[] = items
    .filter((item) => item.status === "completed" && item.result)
    .map(projectItem);
  const inflight: WorkItemView[] = items
    .filter(
      (item) =>
        item.status === "running" ||
        item.status === "approved" ||
        item.status === "pending",
    )
    .map(projectItem);

  return {
    organizationId: session.organizationId,
    message,
    locale: session.state.locale,
    pendingApprovals,
    unreadResults,
    inflight,
    connections: [...session.state.connections.values()],
    unmappedTools: session.state.unmappedTools ?? [],
    history: session.state.conversation,
  };
}
