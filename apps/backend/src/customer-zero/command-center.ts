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
import { isEmailSendRequest } from "./pending-email.js";
import {
  hasWorkingConnector,
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
  | { kind: "transcript"; role: "user" | "assistant"; content: string; speaker?: "departify" | "elvira" }
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
    }
  | {
      kind: "work_state";
      state:
        | "received"
        | "retrieving_context"
        | "delegated"
        | "working"
        | "analyzing"
        | "tool_started"
        | "tool_completed"
        | "preparing_result"
        | "streaming"
        | "completed"
        | "blocked"
        | "error";
      message: string;
      /** Department currently doing the work (drives the accent). */
      departmentId?: string;
      /** Optional capability id currently in use (drives micro-copy). */
      capability?: string;
      /** When the activity was emitted (epoch ms). Lets the portal compute
       *  the time between activities for honest timing display. */
      at?: number;
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
  readonly resultUrl?: string;
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
    | "delegate_seo"
    | "email_action"
    | "calendar_read"
    | "calendar_create"
    | "drive_query"
    | "multi_capability"
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
    | "external_tool_query"
    | "capability_status"
    | "meta_product_question"
    | "department_request"
    | "system_help_question";
  /** Departments that acted or were considered. Today only `marketing`. */
  readonly departments: readonly string[];
  /** Why this decision was made. */
  readonly rationale: string;
}

export type DeliverableRequestKind =
  | "contacts_scoring"
  | "contacts_summary"
  | "unknown";

export interface DeliverableRequest {
  readonly requested: boolean;
  readonly kind: DeliverableRequestKind;
}

/**
 * Classifies the business shape of a requested deliverable. This is a
 * control-plane guard, not a provider/tool selector: native OpenClaw still
 * owns native tool selection, while Departify decides whether a plain
 * capability acknowledgement is allowed to end an actionable request.
 */
export function classifyDeliverableRequest(message: string): DeliverableRequest {
  const asksForDeliverable =
    /\b(haz(?:me)?|crea(?:me|r)?|genera(?:me|r)?|prepara(?:me|r)?|analiza(?:r)?|construye|dame|muestra(?:me)?|ens[eé]ña(?:me)?|make|create|generate|prepare|analy[sz]e)\b/i.test(message) &&
    /\b(dashboard|panel|informe|report(?:e)?|gr[aá]fic(?:o|a)|chart|visualizaci[oó]n|resultados?|entregable)\b/i.test(message);

  if (!asksForDeliverable) return { requested: false, kind: "unknown" };

  const mentionsContacts = /\b(mautic|crm|contact(?:o|os)?|lead(?:s)?|clientes?)\b/i.test(message);
  const asksForScoring = /\b(scoring|score|puntuaci[oó]n|puntuar|priorizaci[oó]n|priorizar|ranking|rank(?:ing)?)\b/i.test(message);
  if (mentionsContacts && asksForScoring) {
    return { requested: true, kind: "contacts_scoring" };
  }
  if (mentionsContacts) return { requested: true, kind: "contacts_summary" };
  return { requested: true, kind: "unknown" };
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
    // Meta questions about Departify itself (model used, how it works,
    // what departments exist, who Elvira is). They must NOT be
    // delegated to Marketing — they are answered locally.
    intent: "meta_product_question",
    rationale:
      "The CEO is asking about Departify as a product, not delegating work. Answer locally.",
    match: (input) =>
      META_PATTERNS.test(input.message) && !HAS_BUSINESS_CONTEXT(input.message),
  },
  {
    // Help with how to use Departify. Also answered locally.
    intent: "system_help_question",
    rationale: "The CEO is asking how to use Departify; help is local.",
    match: (input) =>
      SYSTEM_HELP_PATTERNS.test(input.message) && !HAS_BUSINESS_CONTEXT(input.message),
  },
  {
    // "Háblame de Marketing" / "qué puede hacer Marketing" / "tell me
    // about Marketing" — return a structured department answer, not a
    // generic delegation to Elvira.
    intent: "department_request",
    rationale:
      "The CEO is asking for a description of an active department; respond locally with the department card.",
    match: (input) =>
      DEPARTMENT_REQUEST_PATTERNS.test(input.message) && !HAS_BUSINESS_CONTEXT(input.message),
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
    intent: "email_action",
    rationale:
      "The CEO is asking to send/compose an email — an email capability action, never a generic marketing chat turn.",
    match: (input) => isEmailSendRequest(input.message),
  },
  {
    intent: "multi_capability",
    rationale:
      "The request combines Google business information sources or a source lookup with a follow-up action.",
    match: (input) => isMultiCapabilityRequest(input.message),
  },
  {
    intent: "calendar_create",
    rationale: "The CEO is asking to create a calendar event; this is an approval-gated Google action.",
    match: (input) => isCalendarCreateRequest(input.message),
  },
  {
    intent: "calendar_read",
    rationale: "The CEO is asking about meetings, calendar entries, or availability.",
    match: (input) => isCalendarReadRequest(input.message),
  },
  {
    intent: "drive_query",
    rationale: "The CEO is asking to find or read a Drive document.",
    match: (input) => isDriveRequest(input.message),
  },
  {
    intent: "external_tool_query",
    rationale:
      "The CEO is asking a business data question about an already-connected external tool (Mautic, CRM, etc.).",
    match: (input) => {
      // Email / Gmail read questions ("¿Tengo algún correo
      // importante?", "¿Cuáles debería contestar primero?") route to
      // the SAME external-tool dispatch. Whether Gmail is really
      // operational is resolved inside `processCeoMessage` from the
      // durable token store — never from the session connection map —
      // so this rule stays purely message-based and keeps working
      // after a backend restart.
      if (isEmailReadQuestion(input.message) || isEmailReadFollowUp(input.message)) return true;
      const isDataQuery =
        /\b(cu[áa]ntos\s+contactos?|cu[áa]ntas?\s+personas?|how many contacts|lista de contactos|busca\s+(en\s+mautic\s+)?(contactos?|clientes?)|search\s+contacts|qu[ée]\s+(hay|tenemos|tiene|cu[aá]ntos)\s+(en\s+)?mautic)\b/i.test(
          input.message,
        );
      const isTikTokQuery = /tiktok|tik\s+tok/i.test(input.message) &&
        !/publica|publicar|crear|crea|pausa|reanuda|presupuesto|audiencia|modifica|gestiona|write|create|pause|resume|budget/i.test(input.message) &&
        /(campa[ñn]a|anuncio|ads|publicidad|rendimiento|resultado|gasto|gastado|impresiones|clics|ctr|v[ií]deo|contenido|publicaci[oó]n|post|cu[aá]ntos|qu[eé])/i.test(input.message);
      if (isTikTokQuery) {
        return input.connections.some(
          (connection) =>
            connection.status === "connected" &&
            (connection.toolId === "tiktok" || connection.toolId === "tiktok_ads"),
        );
      }
      const deliverable = classifyDeliverableRequest(input.message);
      const asksForConnectedMauticWork =
        deliverable.requested &&
        /\b(mautic|crm|contact(?:o|os)?|lead(?:s)?|clientes?)\b/i.test(input.message);
      if (!isDataQuery && !asksForConnectedMauticWork) return false;
      // Only route to a real query when the relevant external tool is already
      // connected. A connected Mautic answers contact questions; otherwise the
      // message falls through to `request_connection`.
      const mautic = input.connections.find(
        (c) => c.toolId === "mautic",
      );
      if (mautic?.status === "connected") return true;
      return input.connections.some(
        (c) =>
          c.status === "connected" &&
          (input.message.toLowerCase().includes(c.toolId) ||
            input.message.toLowerCase().includes(c.label.toLowerCase())),
      );
    },
  },
  {
    intent: "capability_status",
    rationale:
      "The CEO asserts/asks about access to a tool that is ALREADY connected — operational state outranks conversational inference.",
    match: (input) => {
      const lower = input.message.toLowerCase();
      const mentionsConnectedTool = input.connections.some(
        (connection) =>
          connection.status === "connected" &&
          (lower.includes(connection.toolId) ||
            lower.includes(connection.label.toLowerCase())),
      );
      if (!mentionsConnectedTool) return false;
      // Only status-assertion phrasings: "ya tienes acceso a X", "pero tienes
      // acceso a X", "do you have access to X". A connect verb explicitly
      // asking to connect stays a request_connection.
      const isStatusAssertion =
        /\b(ya\s+tienes|ya\s+ten[ée]is|tienes\s+acceso|ten[ée]is\s+acceso|do\s+you\s+have\s+access|have\s+access|acceso\s+a|t[ée]n\s+acceso|tengo\s+acceso)\b/i.test(
          input.message,
        );
      return isStatusAssertion;
    },
  },
  {
    intent: "request_connection",
    rationale:
      "A tool name or capability is mentioned. Departify will check whether it can connect it.",
    match: (input) => /\b(mautic|hubspot|salesforce|mailchimp|gmail|outlook|whatsapp|telegram|slack|notion|zoho|pipedrive| veinti twenty|veinte)\b/i.test(
      input.message,
    ) || /\b(conecta|conectar|reconecta|reconectar|integraci[óo]n|integrate|connect|reconnect)\b/i.test(input.message),
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
    // SEO-specific intent — Sprint Customer Zero Golden Image.
    //
    // Before this rule existed, an SEO request like "Analiza el SEO de mi
    // web y dime cuáles son los problemas prioritarios" fell through every
    // other pattern and was delegated to Marketing as a generic message.
    // The Marketing roster has no SEO specialist and no SEO capability, so
    // the LLM produced generic text with no real audit, no real data, and
    // no persisted DepartmentTask / DepartmentResult.
    //
    // This rule routes the request to `delegate_seo`, which the chat
    // pipeline executes by calling `auditWebsite()` against the company's
    // website (from Company DNA) and persisting a real task + result.
    intent: "delegate_seo",
    rationale:
      "The CEO is asking for SEO analysis or improvements — route to the SEO audit pipeline that reads the real website and persists a real task + result.",
    match: (input) => SEO_REQUEST_PATTERN.test(input.message),
  },
];

/**
 * Recognises SEO requests in either Spanish or English. The pattern is
 * broad enough to cover "Analiza el SEO", "auditoría SEO", "mejoras SEO",
 * "indexación", "sitemap", "meta description", "search console",
 * "audit my SEO", "SEO plan", "first improvements".
 */
const SEO_REQUEST_PATTERN =
  /\b(seo|search\s+engine|semrush|ahrefs|search\s+console|sitemap|meta\s*description|meta\s*title|encabezados?|cabeceras?|indexaci[oó]n|posicionamiento|audit\s+(my|the)\s+seo|seo\s+audit|seo\s+plan|primeras\s+mejoras|priorida(?:d|des)|an[áa]lisis\s+seo|auditor[ií]a\s+seo)\b/i;

const APPROVAL_VERBS =
  /\b(aprobar|aprueba|apruebo|aprueb[a-záàäeéèíìöüñ]*lo|apruebe|approved?|approve|si[,\s]+hazlo|dale|hazlo|hazlo ya|go ahead|adelante|confirma|confirmar|de acuerdo|ok\s*hazlo)\b/i;
const RESULT_VERBS =
  /\b(resultados?|result|entregable|lo que (han|hizo|tienen)|what did|show me|muestra|ver resultado)\b/i;
const STATUS_VERBS =
  /\b(qu[ée] hace|qu[ée] est[áa]n|estado|status|progreso|progress|working on|trabajando|c[óo]mo vamos|c[óo]mo va)\b/i;

/**
 * Patterns that indicate the CEO is asking about Departify itself
 * ("qué modelo usas", "cómo funciona", "qué es Departify"). These
 * must NEVER delegate to Marketing.
 */
const META_PATTERNS =
  /\b(qu[ée]\s+modelo|qu[ée]\s+motor|qu[ée]\s+ia|qu[ée]\s+inteligencia|qu[ée]\s+modelo\s+de\s+lenguaje|qu[ée]\s+llm|qu[ée]\s+gpt|qu[ée]\s+gemini|qu[ée]\s+claude|qu[ée]\s+departamentos?\s+tengo|qu[ée]\s+departamentos?\s+hay|qui[ée]n\s+es\s+elvira|qu[ée]\s+es\s+elvira|qu[ée]\s+es\s+departify|c[óo]mo\s+funciona|c[óo]mo\s+est[áa]\s+hecho|qu[ée]\s+tecnolog[íi]a|what\s+model|what\s+llm|what\s+ai|how\s+does\s+departify\s+work|what\s+is\s+departify|who\s+is\s+elvira|what\s+departments|which\s+departments)\b/i;

/**
 * Patterns that indicate the CEO is asking how to use the product.
 * Answered locally with a pointer to the relevant page.
 */
const SYSTEM_HELP_PATTERNS =
  /\b(c[óo]mo\s+(uso|utilizo)|c[óo]mo\s+se\s+usa|c[óo]mo\s+funciona\s+esto|c[óo]mo\s+empezar|c[óo]mo\s+comienzo|por\s+d[óo]nde\s+empiezo|help|ayuda|how\s+(do\s+I|to)\s+use|how\s+do\s+I\s+start|where\s+do\s+I\s+start)\b/i;

/**
 * "Háblame de X" / "tell me about X" — describe an active department.
 * Does NOT delegate to Marketing as a request; surfaces structured info.
 */
const DEPARTMENT_REQUEST_PATTERNS =
  /\b(h[áa]blame\s+de|hablame\s+de|h[áa]blame\s+sobre|h[áa]blame\s+acerca\s+de|cu[ée]ntame\s+sobre|cu[ée]ntame\s+de|qu[ée]\s+(?:est[áa]\s+haciendo|hace)\s+(marketing|ventas|finanzas|operaciones)|tell\s+me\s+about|what\s+does\s+(marketing|sales|finance|operations)\s+do)\b/i;

/**
 * True when the CEO's message also contains a clear business intent
 * (analysis, campaign, contact query, Mautic…) — overrides meta
 * rules. A "qué modelo" within "qué modelo usas para revisar
 * Mautic" is still a business request.
 */
function HAS_BUSINESS_CONTEXT(message: string): boolean {
  return /\b(revisa|analiza|analizar|contactos?|clientes?|leads?|campañ?a|segmento|crm|mautic|hubspot|salesforce|enviar?|email|publicar?|publicidad|inversion|presupuesto|m[ée]tricas?|analytics|reactivar|reactivaci[óo]n)\b/i.test(
    message,
  );
}

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
    case "delegate_seo":
      return {
        decision: {
          intent: "delegate_seo",
          departments: ["seo"],
          rationale: rule.rationale,
        },
        reply: t(
          input.locale,
          "Voy a revisar tu web ahora mismo. En un momento te traigo los problemas prioritarios y un plan de acciones.",
          "I'll audit your website right now. I'll come back with the priority issues and an action plan in a moment.",
        ),
      };
    case "meta_product_question":
      return buildMetaProductOutcome(input);
    case "system_help_question":
      return buildSystemHelpOutcome(input);
    case "department_request":
      return buildDepartmentRequestOutcome(input);
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
    case "capability_status":
      return buildCapabilityStatusOutcome(input);
    case "email_action":
      // The orchestrator (processCeoMessage) runs the email pipeline:
      // parse recipient/objective → draft → approval → send. This is a
      // pass-through so the intent reaches the handler intact with a
      // neutral opening line.
      return {
        decision: {
          intent: "email_action",
          departments: ["marketing"],
          rationale: rule.rationale,
        },
        reply: t(
          input.locale,
          "Voy a preparar el correo. Dame un momento.",
          "I'll prepare the email. Give me a moment.",
        ),
      };
    case "calendar_read":
    case "calendar_create":
    case "drive_query":
    case "multi_capability":
      return {
        decision: {
          intent: rule.intent,
          departments: [],
          rationale: rule.rationale,
        },
        reply: t(
          input.locale,
          "Voy a consultar tus herramientas de Google.",
          "I’ll check your Google tools.",
        ),
      };
    case "external_tool_query":
      // The orchestrator resolves the connected external tool and produces
      // the real answer through the Tool Runtime; this is a pass-through so
      // the intent reaches the handler intact.
      return {
        decision: {
          intent: "external_tool_query",
          departments: ["marketing"],
          rationale: rule.rationale,
        },
        reply: t(
          input.locale,
          "Voy a consultarlo en el sistema conectado.",
          "Let me query the connected system.",
        ),
      };
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
  const reconnectRequested = /\b(reconecta|reconectar|reconnect)\b/i.test(input.message);
  const operationalEmail = input.connections.find(
    (connection) =>
      connection.status === "connected" &&
      (connection.toolId === "gmail" || connection.capability?.startsWith("email.")),
  );
  if (reconnectRequested && operationalEmail) {
    return {
      decision: {
        intent: "capability_status",
        departments: [],
        rationale: `${operationalEmail.label} is already connected; no reconnect action is required.`,
      },
      reply: t(
        input.locale,
        `Tu ${operationalEmail.label} ya está conectado y operativo. No necesitas volver a autorizarlo.`,
        `Your ${operationalEmail.label} connection is already operational. You do not need to authorize it again.`,
      ),
    };
  }
  if (reconnectRequested) {
    const known = input.connections.find(
      (connection) => connection.toolId === "gmail" || connection.capability?.startsWith("email."),
    );
    const suggestion: ConnectionSuggestion = known
      ? {
          toolId: known.toolId,
          label: known.label,
          capability: known.capability,
          why: whyForCapability(known.capability, input.locale),
          connectable: true,
          requiredCredentials: [],
          rawInput: input.message,
        }
      : {
          toolId: "gmail",
          label: "Gmail",
          capability: "email.read",
          why: t(input.locale, "Para volver a consultar tu correo, necesito restablecer el acceso a Gmail.", "To query your email again, I need to restore Gmail access."),
          connectable: true,
          requiredCredentials: [],
          rawInput: input.message,
        };
    return {
      decision: {
        intent: "request_connection",
        departments: [],
        rationale: "Gmail is not operational; return the bounded connection action instead of manual OAuth instructions.",
      },
      reply: t(input.locale, "Puedo restablecer el acceso a Gmail desde Conexiones.", "I can restore Gmail access from Connections."),
      connectionSuggestion: suggestion,
    };
  }
  // Operational truth first: if the CEO mentions a tool that is ALREADY
  // connected, the connection does not need to be re-established. Answer from
  // the operational state, never a reconnection instruction.
  const mentionedConnected = input.connections.find(
    (connection) =>
      connection.status === "connected" &&
      (input.message.toLowerCase().includes(connection.toolId) ||
        input.message.toLowerCase().includes(connection.label.toLowerCase())),
  );
  if (mentionedConnected) {
    return {
      decision: {
        intent: "capability_status",
        departments: ["marketing"],
        rationale: `${mentionedConnected.label} is already connected; operational state confirms it.`,
      },
      reply: t(
        input.locale,
        `Sí. ${mentionedConnected.label} está conectado y operativo. Ya tengo acceso y puedo trabajar con ello.`,
        `Yes. ${mentionedConnected.label} is connected and operational. I already have access and can work with it.`,
      ),
    };
  }

  const suggestion = discoverConnection(input);
  // Honest product direction: only tools with a REAL connector are promised as
  // connectable. Everything else points the CEO to /conexiones to prepare the
  // access — never claims a connection that cannot be established.
  const working = hasWorkingConnector(suggestion.toolId ?? "");
  return {
    decision: {
      intent: "request_connection",
      departments: ["marketing"],
      rationale: working
        ? `Integration discovery identified ${suggestion.label} as a connectable capability.`
        : `Integration discovery identified ${suggestion.label} but it cannot be connected today.`,
    },
    reply: working
      ? t(
          input.locale,
          `${suggestion.label} puede entrar en tu empresa. ${suggestion.why} Te indico qué necesito para conectarlo.`,
          `${suggestion.label} can join your company. ${suggestion.why} I'll tell you what I need to connect it.`,
        )
      : t(
          input.locale,
          `${suggestion.label} todavía no está conectado. Lo encontrarás en Conexiones para preparar el acceso.`,
          `${suggestion.label} is not connected yet. You will find it in Connections to prepare access.`,
        ),
    connectionSuggestion: { ...suggestion, connectable: working },
  };
}

function buildCapabilityStatusOutcome(input: CommandCenterInput): {
  decision: RoutingDecision;
  reply: string;
  connectionSuggestion?: ConnectionSuggestion;
} {
  const mentioned = input.connections.find(
    (connection) =>
      connection.status === "connected" &&
      (input.message.toLowerCase().includes(connection.toolId) ||
        input.message.toLowerCase().includes(connection.label.toLowerCase())),
  );
  if (mentioned) {
    return {
      decision: {
        intent: "capability_status",
        departments: ["marketing"],
        rationale: `${mentioned.label} is connected; operational state answers the CEO.`,
      },
      reply: t(
        input.locale,
        `Sí. ${mentioned.label} está conectado y operativo.`,
        `Yes. ${mentioned.label} is connected and operational.`,
      ),
    };
  }
  return {
    decision: {
      intent: "capability_status",
      departments: ["marketing"],
      rationale: "The CEO asked about access to a tool; there is no connected tool to report.",
    },
    reply: t(
      input.locale,
      "Todavía no hay ninguna herramienta externa conectada. Puedo ayudarte a conectarla en Conexiones.",
      "No external tool is connected yet. I can help you connect one in Connections.",
    ),
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

/**
 * "Qué modelo usas" / "qué IA hay detrás" / "cómo funciona Departify".
 * Answered from Departify-owned knowledge — NEVER delegated to
 * Marketing.
 */
function buildMetaProductOutcome(input: CommandCenterInput): {
  decision: RoutingDecision;
  reply: string;
} {
  const text = input.message.toLowerCase();
  // Specific common question: "qué modelo usas" / "what model do you use"
  const isModelQuestion =
    /\b(qu[ée]\s+modelo|qu[ée]\s+motor|qu[ée]\s+llm|qu[ée]\s+gpt|qu[ée]\s+gemini|qu[ée]\s+claude|what\s+model|which\s+model|what\s+llm)\b/i.test(
      text,
    );
  const isDepartmentsQuestion =
    /\b(qu[ée]\s+departamentos?\s+(tengo|hay|existen|activos?)|what\s+departments|which\s+departments)\b/i.test(
      text,
    );
  const isElviraQuestion = /\b(qui[ée]n\s+es\s+elvira|qu[ée]\s+es\s+elvira|who\s+is\s+elvira)\b/i.test(
    text,
  );

  if (isModelQuestion) {
    return {
      decision: {
        intent: "meta_product_question",
        departments: [],
        rationale: "Model question answered locally without delegation.",
      },
      reply: t(
        input.locale,
        "Trabajo con modelos de IA de primer nivel (Google Vertex AI para el razonamiento del equipo). Lo importante es que tu empresa funciona con datos reales y no inventa respuestas — tú decides qué se ejecuta.",
        "I work with top-tier AI models (Google Vertex AI for the team's reasoning). The important thing is that your company runs on real data and never invents answers — you decide what gets executed.",
      ),
    };
  }

  if (isDepartmentsQuestion) {
    return {
      decision: {
        intent: "meta_product_question",
        departments: [],
        rationale: "Departments list answered locally without delegation.",
      },
      reply: t(
        input.locale,
        "Hoy Departify tiene un departamento activo: Marketing, con Elvira como Directora. Muy pronto se sumarán Ventas, Finanzas y Operaciones. Cuando estén operativos, los verás aquí mismo.",
        "Right now Departify has one active department: Marketing, with Elvira as its Director. Sales, Finance and Operations are coming soon. When they're live you'll see them here.",
      ),
    };
  }

  if (isElviraQuestion) {
    return {
      decision: {
        intent: "meta_product_question",
        departments: [],
        rationale: "Elvira identity answered locally without delegation.",
      },
      reply: t(
        input.locale,
        "Elvira es tu Directora de Marketing. Es quien organiza al equipo, prepara planes, solicita aprobaciones y trabaja con las herramientas que la empresa tiene autorizadas (Mautic, Gmail, etc.). No es un chatbot: es una ejecutiva con memoria, contexto y resultados.",
        "Elvira is your Head of Marketing. She organises the team, prepares plans, requests approvals, and works with the tools the company has authorised (Mautic, Gmail, etc.). She is not a chatbot — she is an executive with memory, context, and results.",
      ),
    };
  }

  // Generic "cómo funciona Departify".
  return {
    decision: {
      intent: "meta_product_question",
      departments: [],
      rationale: "Departify overview answered locally without delegation.",
    },
    reply: t(
      input.locale,
      "Departify funciona como una empresa digital: tú hablas con un Director de área (hoy, Elvira en Marketing), ella prepara un plan, lo ejecuta con las herramientas autorizadas, te pide aprobaciones cuando hace falta y registra la actividad. Tú nunca gestionas claves técnicas ni credenciales: solo pides resultados.",
      "Departify works like a digital company: you talk to a Department Head (today, Elvira in Marketing), she prepares a plan, executes it with the authorised tools, requests approvals when needed, and records activity. You never manage technical keys or credentials — you just ask for results.",
    ),
  };
}

/**
 * "Cómo uso Departify" / "ayuda" — short pointer to the relevant
 * surfaces (chat, conexiones, aprobaciones).
 */
function buildSystemHelpOutcome(input: CommandCenterInput): {
  decision: RoutingDecision;
  reply: string;
} {
  return {
    decision: {
      intent: "system_help_question",
      departments: [],
      rationale: "Help question answered locally.",
    },
    reply: t(
      input.locale,
      "Aquí siempre me tienes a mí. Pídeme cosas en lenguaje normal: “revisa los contactos”, “prepara un plan de marketing”, “muéstrame la actividad”. Para conectar herramientas usa Conexiones, y para aprobar lo que Elvira proponga entra en Aprobaciones.",
      "I'm always here. Just ask in plain language: “review the contacts”, “prepare a marketing plan”, “show me the activity”. Use Connections to connect tools, and Approvals to approve what Elvira proposes.",
    ),
  };
}

/**
 * "Háblame de Marketing" / "qué puede hacer Marketing". Returns a
 * structured, business-language description of the active department
 * without delegating to the engine.
 */
function buildDepartmentRequestOutcome(input: CommandCenterInput): {
  decision: RoutingDecision;
  reply: string;
} {
  // Only Marketing is active today. If the CEO names another department
  // we fall through to unknown_department.
  const head = getMarketingHead();
  const working = input.inflight.length;
  const pending = input.pendingApprovals.length;
  const connected = input.connections.filter((c) => c.status === "connected");
  void head;

  const lines: string[] = [
    t(
      input.locale,
      "Marketing está dirigido por Elvira, tu Directora de Marketing.",
      "Marketing is led by Elvira, your Head of Marketing.",
    ),
    t(
      input.locale,
      "Trabaja con los datos reales de tu empresa: analiza contactos, segmentos y campañas de Mautic, prepara planes, propone acciones y registra resultados.",
      "She works with real company data: she analyses Mautic contacts, segments and campaigns, prepares plans, proposes actions and records results.",
    ),
  ];
  if (working > 0) {
    lines.push(
      t(
        input.locale,
        `Ahora mismo tiene ${working} ${working === 1 ? "trabajo en curso" : "trabajos en curso"}.`,
        `She has ${working} ${working === 1 ? "work item in flight" : "work items in flight"} right now.`,
      ),
    );
  }
  if (pending > 0) {
    lines.push(
      t(
        input.locale,
        `Y ${pending} ${pending === 1 ? "aprobación pendiente" : "aprobaciones pendientes"} para ti.`,
        `And ${pending} ${pending === 1 ? "approval waiting for you" : "approvals waiting for you"}.`,
      ),
    );
  }
  if (connected.length > 0) {
    const names = connected.map((c) => c.label).join(", ");
    lines.push(
      t(
        input.locale,
        `Herramientas conectadas: ${names}.`,
        `Connected tools: ${names}.`,
      ),
    );
  } else {
    lines.push(
      t(
        input.locale,
        "Aún no hay herramientas externas conectadas. Cuando conectes Mautic u otra, Elvira empezará a usarlas.",
        "No external tools are connected yet. When you connect Mautic or others, Elvira will start using them.",
      ),
    );
  }

  return {
    decision: {
      intent: "department_request",
      departments: ["marketing"],
      rationale: "Department description answered locally without engine delegation.",
    },
    reply: lines.join(" "),
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
  { keywords: [/hostinger/i, /correo\s+(?:de|del)\s+empresa/i], toolId: "hostinger_email" },
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
 * True when the CEO's message is asking about their email inbox —
 * "¿Tengo algún correo importante?", "¿Qué correos tengo sin leer?",
 * "¿Cuáles debería contestar primero?".
 *
 * Deliberately message-based (no connection-state dependency): the
 * real Gmail operationality is resolved later from the durable token
 * store, so this keeps working after a backend restart and never
 * fabricates a connection.
 */
export function isEmailReadQuestion(message: string): boolean {
  const lower = message.toLowerCase();
  // P0 — the CEO's email vocabulary must include the bare English word
  // "mail" (e.g. "¿puedes leer mi último mail recibido?"). The previous
  // regex missed it and the message fell through to delegate_marketing,
  // which routed through Elvira → Mautic → "no ha podido acceder a
  // Mautic en este momento" — even though Gmail was operational.
  // `mailchimp` is one word, so the `\b` boundaries keep it out.
  const mentionsEmail =
    /\b(correos?|emails?|mails?|mailbox|inbox|bandeja\s+de\s+entrada|bandeja|buz[oó]n(?: de entrada)?|gmail|google\s+mail|googlemail)\b/i.test(
      lower,
    );
  if (mentionsEmail) {
    // Quantity-qualified inbox reads are explicit capability operations even
    // when the verb is omitted ("mis últimos 3 mails"). Keep this check
    // ahead of the generic intent vocabulary so Unicode plurals and digits
    // cannot fall through to Marketing.
    if (/(?:[úu]ltim(?:o|os|a|as)|recient(?:e|es)|recent(?:e|s)?)\s+(?:\d{1,2}|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/i.test(lower)) {
      return true;
    }
    // An email vocabulary mention combined with an inbox-reading
    // intent. The reading/intent verbs now include "leer" (infinitive)
    // and "recibido" so messages like "¿puedes leer mi último mail
    // recibido?" route here instead of falling through.
    return /\b(important|importantes?|unread|pendientes?|no\s+le[ií]dos?|le[ií]dos?|leer|lee|leeme|le[íi]me|recibido|recibidos?|nuevo|nuevos?|[úu]ltim[oa]s?|ver|mu[eé]strame|ense[ñn]ame|dime|cu[áa]l|revisar|revisa|tengo|hay|alguno|contestar|responder|respuestas?|respu[eé]stame|busca|search|find)\b/i.test(
      lower,
    );
  }
  // Email follow-ups that continue the inbox conversation without
  // repeating the word "correo" ("¿Cuáles debería contestar primero?").
  return /\b(cu[aá]l(?:es)?\s+deber[ií]a(?:mos|s)?\s+(contestar|responder)|contestar(?:los)?\s+primero|responder(?:los)?\s+primero)\b/i.test(
    lower,
  );
}

/** Short inbox continuations keep their email meaning without repeating it. */
export function isEmailReadFollowUp(message: string): boolean {
  return /^\s*(?:mu[eé]strame|ens[eé]ñame|dame|los|las)?\s*(?:\d{1,2}|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s+(?:[úu]ltim(?:o|os|a|as)|recient(?:e|es)|mails?|correos?|emails?)\b/i.test(message)
    || /^\s*(?:los|las)\s+[úu]ltim(?:o|os|a|as)\b/i.test(message);
}

const OPERATIONAL_TERMS = [
  "crea",
  "crear",
  "calendario",
  "calendar",
  "evento",
  "eventos",
  "minuto",
  "minutos",
  "reunion",
  "reuniones",
  "responde",
  "responder",
  "contesta",
  "contestar",
  "mail",
  "mails",
  "correo",
  "correos",
  "email",
  "emails",
  "tarea",
  "tareas",
  "drive",
] as const;

function accentless(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function editDistance(left: string, right: string): number {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = row[0]!;
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const previous = row[j]!;
      row[j] = left[i - 1] === right[j - 1]
        ? diagonal
        : Math.min(diagonal + 1, row[j]! + 1, row[j - 1]! + 1);
      diagonal = previous;
    }
  }
  return row[right.length]!;
}

/**
 * Correct only near-miss spellings in the small operational vocabulary.
 * This is intentionally generic (one edit away), not a growing typo list;
 * company content and email bodies remain untouched by domain classifiers.
 */
export function normalizeOperationalLanguage(message: string): string {
  return message.replace(/[\p{L}\p{N}]+/gu, (token) => {
    const normalized = accentless(token);
    // Short operational verbs such as `crea` still need bounded typo
    // tolerance (`cea`). The vocabulary is deliberately small and the
    // minimum length prevents ordinary function words from being rewritten.
    if (normalized.length < 3) return token;
    const candidates = OPERATIONAL_TERMS.filter((term) =>
      Math.abs(term.length - normalized.length) <= 1 &&
      editDistance(normalized, accentless(term)) <= 1,
    );
    return candidates.length === 1 ? candidates[0]! : token;
  });
}

export function isCalendarReadRequest(message: string): boolean {
  if (/\bqu[eé]\s+tengo\s+(hoy|ma[nñ]ana|esta\s+semana|this\s+week|tomorrow|today)\b/i.test(message)) return true;
  if (/\bqu[eé]\s+(?:eventos?|reuniones?)\s+tengo\b/i.test(message)) return true;
  // Bare agenda requests are explicit Calendar operations; they must not
  // fall through to the generic Marketing/LLM sink.
  if (/\bmis\s+(pr[oó]xim(?:o|os|a|as)|siguientes?)\s+eventos?\b/i.test(message)) return true;
  if (/^\s*(?:y\s+)?(?:mis\s+)?eventos?\s*[?.!]?\s*$/i.test(message)) return true;
  if (/(?:link|enlace|encale|url)\b/i.test(message) && /\b(evento|calendar|calendario)\b/i.test(message)) return true;
  if (/\bno\s+(?:lo\s+)?(?:veo|aparece|me\s+aparece|me\s+sale)\b/i.test(message) && /\b(evento|calendar|calendario)\b/i.test(message)) return true;
  if (/\b(?:en\s+qu[eé]|que)\s+calendari[oa]\b/i.test(message)) return true;
  return /\b(calendar|calendario|reuni[oó]n|reuniones|cita|hueco|disponible|agenda)\b/i.test(message) &&
    /\b(qu[eé]|qu[eé]\s+tengo|hoy|ma[nñ]ana|semana|pr[oó]xim(?:o|a|os|as)|siguiente|hueco|disponible|cu[aá]ndo|when|today|tomorrow|this week|next meeting|eventos?)\b/i.test(message);
}

export function isCalendarCreateRequest(message: string): boolean {
  const createVerb = /\b(agenda|agendar|a[nñ]ade|a[nñ]adir|crea|crear|creas|pon|poner|programa|programar|schedule|book)\b/i.test(message) ||
    /\b(?:queiero|quiero)\s+que\s+cre(?:e|es)\b/i.test(message);
  return createVerb &&
    /\b(reuni[oó]n|evento|cita|meeting|event)\b/i.test(message);
}

export function isDriveRequest(message: string): boolean {
  const hasSource = /\b(drive|documento|documentos|archivo|archivos|pdf|plan\s+de\s+marketing|google\s+docs?)\b/i.test(message);
  const hasAction = /\b(busca|buscar|encuentra|encontrar|lee|leer|dice|dime|tengo|informaci[oó]n|reciente?s?|organiza|organizar|ordena|clasifica|crea|crear|creas|creado|escribe|escribir|actualiza|actualizar|recent|search|find|read|what does|create|write|update)\b/i.test(message);
  return hasSource && hasAction;
}

export function isDriveWriteRequest(message: string): boolean {
  return /\b(drive|google\s+docs?|carpetas?|folder|documentos?|archivos?|file)\b/i.test(message) &&
    /\b(crea|crear|creas|creado|escribe|escribir|actualiza|actualizar|guarda|guardar|create|write|update|save)\b/i.test(message);
}

export function isMultiCapabilityRequest(message: string): boolean {
  const lower = message.toLowerCase();
  if (/\b(convierte|convertir|pasa|pasar|transforma|transformar)\b[\s\S]*\b(correo|correos?|email|emails?|mail)\b[\s\S]*\b(tarea|tareas)\b/i.test(lower)) {
    return false;
  }
  const email = /\b(correos?|emails?|gmail|mail)\b/i.test(lower);
  const calendar = /\b(calendar|calendario|reuni[oó]n|reuniones|cita|meeting)\b/i.test(lower);
  const drive = /\b(drive|documento|documentos|archivo|plan\s+de\s+marketing)\b/i.test(lower);
  const tasks = /\b(tarea|tareas)\b/i.test(lower);
  const domains = [email, calendar, drive, tasks].filter(Boolean).length;
  return domains >= 2;
}

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

  // Honest proactivity trigger: the proactive card only appears when
  // there is something grounded to say — an active work plan (items
  // in motion, waiting on a connection, approvals) or a company
  // objective to advance. P0 Product Consistency — Elvira is the
  // Marketing head, not a global fallback. The proactive card talks
  // as "Departify" for general/transversal context and only mentions
  // Elvira when the work actually belongs to Marketing.
  if (objective || marketingActive) {
    const isMarketingOwned = !!work;
    events.push({
      kind: "intent_proactive",
      intent: "open",
      title: t(
        session.state.locale,
        isMarketingOwned
          ? "Elvira toma la iniciativa"
          : "Departify está organizando el primer plan",
        isMarketingOwned
          ? "Elvira takes the initiative"
          : "Departify is organizing the first plan",
      ),
      message: objective
        ? buildProactiveStrategyMessage(session.state.locale, objective, work)
        : t(
            session.state.locale,
            isMarketingOwned
              ? "Elvira ya está lista para ponerse a trabajar. Dile qué quieres conseguir."
              : "Cuéntanos qué quieres conseguir y prepararemos el primer plan.",
            isMarketingOwned
              ? "Elvira is ready to start working. Tell her what you want to achieve."
              : "Tell us what you want to achieve and we'll prepare the first plan.",
          ),
    });
  }

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

  // Central Chat UX P0 — connection_need cards are NOT emitted from
  // the proactive opening payload. The chat is conversational, not a
  // dashboard. A connection card only renders in chat when:
  //   A. the CEO mentions the tool (handled by buildConnectionOutcome),
  //   B. the current task requires this capability (added per turn), or
  //   C. the current task is blocked by this missing connection.
  // The full catalog stays in /conexiones — never spammed inside chat.
  void session.state.unmappedTools;

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
