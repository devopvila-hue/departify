/**
 * Thin typed client for the Customer Zero API. The portal never talks about
 * agents, tools or runtimes — only about the company, its department heads,
 * their work and the decisions the CEO has to take.
 */

export interface HeadIdentity {
  departmentId: string;
  department: string;
  name: string;
  initials: string;
  role: string;
}

export interface ConnectionCard {
  toolId: string;
  label: string;
  capability: string;
  category: string;
  status: "not_connected" | "connecting" | "connected" | "blocked";
  blockedReason?: string;
  missingCredentials?: string[];
  authorizationUrl?: string;
}

/** Durable /conexiones view (Phase P-B). */
export type ToolLifecycleStatus =
  | "selected"
  | "needs_connection"
  | "configured"
  | "connected"
  | "degraded"
  | "unavailable";

export type ToolDomain =
  | "crm"
  | "email"
  | "calendar"
  | "documents"
  | "marketing"
  | "team";

export type ConnectionMethod = "oauth" | "manual" | "platform_managed" | "not_configured";
export type CredentialFieldType = "text" | "url" | "password";

export interface CredentialFieldDefinition {
  id: string;
  label: string;
  type: CredentialFieldType;
  placeholder?: string;
  secret?: boolean;
  helpText?: string;
}

export interface CredentialHelpDefinition {
  whatYouNeed: string;
  steps: string[];
  fields: CredentialFieldDefinition[];
  actionLabel: string;
  actionUrl: string;
  docsUrl?: string;
  note?: string;
}

export interface ToolConnectionView {
  toolId: string;
  label: string;
  name: string;
  capability: string;
  capabilities?: string[];
  category: string;
  categoryId: "crm" | "email" | "calendar" | "documents" | "marketing" | "team" | "other";
  logoMark: string;
  brandColor: string;
  description?: string;
  accountLabel?: string;
  configSource?: string;
  userVisible?: boolean;
  /** Business domains this tool belongs to (primary first). */
  domains: ToolDomain[];
  /** "available" when the organization has no state for the tool. */
  state: ToolLifecycleStatus | "available";
  hasState: boolean;
  humanLabel: string;
  action: "prepare" | "connect" | "verify" | "retry" | null;
  verifiedAt?: string;
  blockedReason?: string;
  connectionMethod?: ConnectionMethod;
  credentialHelp?: CredentialHelpDefinition;
}

/** Customer Zero 01 — five-state connection card view. */
export type ConnectionFiveState =
  | "not_connected"
  | "connecting"
  | "connected"
  | "needs_attention"
  | "error";

export interface ConnectionCapabilityView {
  id: string;
  nameEs: string;
  nameEn: string;
}

export interface ConnectionCardView {
  id: string;
  name: string;
  /** Localized human label (e.g. "Correo" / "Email"). */
  category: string;
  /** Canonical category id (e.g. "email"). The portal groups by this. */
  categoryId: "crm" | "email" | "calendar" | "documents" | "marketing" | "team" | "other";
  logoMark: string;
  brandColor: string;
  state: ConnectionFiveState;
  stateLabel: string;
  configSource: string | null;
  verifiedAt: string | null;
  capabilities: ConnectionCapabilityView[];
  actionLabel: string | null;
  /** Short business description; intentional for genuinely unknown tools. */
  description: string | null;
}

export interface ConnectionCardDetailView extends ConnectionCardView {
  organizationId: string;
  provider: string;
}

export interface LlmSettingsView {
  organizationId: string;
  provider: "openai";
  providerName: string;
  model: string;
  modelLabel: string;
  configured: boolean;
  state: "connected" | "needs_attention" | "needs_setup";
  verifiedAt: string | null;
  error: string | null;
  help?: {
    actionUrl: string;
    docsUrl: string;
    steps: string[];
  };
}

export interface DecisionView {
  id: string;
  head: HeadIdentity;
  proposal: string;
  detail: string;
  note?: string;
  status: "pending" | "resolved";
}

export interface ActivityView {
  id: string;
  head: HeadIdentity;
  message: string;
  tone: "working" | "done" | "waiting" | "blocked";
}

export interface ResultView {
  id: string;
  head: HeadIdentity;
  title: string;
  summary: string;
}

/* -------------------------------------------------------------------------
 * Customer Zero 01 P0 — Department Work + Department Result.
 * -----------------------------------------------------------------------*/

export type DepartmentWorkStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed";

export interface DepartmentTask {
  id: string;
  organizationId: string;
  departmentId: string;
  objectiveId: string | null;
  requestedBy: string;
  title: string;
  summary: string;
  capability: string;
  toolId: string;
  status: DepartmentWorkStatus;
  statusMessage: string;
  progress: number;
  requiredCapabilities: string[];
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  resultId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  timeoutMs: number;
  source?: {
    type: "inbox_email";
    inboxItemId: string;
    provider: string;
    providerMessageId: string;
  };
}

export type ChartKind = "bar" | "line" | "donut" | "number" | "table";

export interface ChartSeries {
  name: string;
  values: number[];
  labels?: string[];
}

export interface ChartData {
  kind: ChartKind;
  title: string;
  unit?: string;
  series: ChartSeries[];
  rows?: { label: string; value: string | number }[];
}

export interface DepartmentResult {
  id: string;
  organizationId: string;
  departmentId: string;
  relatedWorkItemId: string | null;
  title: string;
  summary: string;
  content: string;
  data?: Record<string, unknown>;
  chart?: ChartData;
  source: string;
  createdAt: string;
  producedByCapability: string;
}

export type DashboardWidgetKind =
  | "metric" | "line" | "bar" | "area" | "donut" | "table" | "timeline" | "calendar-summary";

export interface DashboardDefinition {
  id: string;
  organizationId: string;
  departmentId: string;
  title: string;
  description: string;
  dateRange: { kind: "relative" | "fixed"; days?: number; from?: string; to?: string };
  metrics: string[];
  widgets: { id: string; kind: DashboardWidgetKind; title: string; source: string; config?: Record<string, unknown> }[];
  filters: string[];
  dataSources: string[];
  layout: Record<string, unknown>;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

export type BusinessCalendarType = "task" | "result" | "approval" | "meeting";
export type BusinessCalendarStatus = "pending" | "needs_approval" | "scheduled" | "completed" | "failed";

export interface BusinessCalendarEntry {
  id: string;
  organizationId: string;
  departmentId: string;
  type: BusinessCalendarType;
  status: BusinessCalendarStatus;
  title: string;
  summary: string;
  startIso: string;
  endIso: string;
  source: "departify" | "google_calendar";
  sourceId: string;
  capability?: string;
}

export interface SeoAuditReport {
  url: string;
  fetchedAt: string;
  page: {
    title: string;
    description: string;
    canonical: string | null;
    robots: string | null;
    headings: { h1: string[]; h2: string[]; h3: string[] };
    internalUrls: string[];
    brokenUrls: string[];
    imagesWithoutAlt: number;
    structuredDataBlocks: number;
    socialMetadata: string[];
    sitemap: "available" | "missing" | "unavailable";
  };
  issues: { id: string; priority: "critical" | "important" | "opportunity"; title: string; impact: string; evidence: string }[];
  source: "website";
}

export interface ExecutionReceipt {
  operationId: string;
  intent: string;
  capability: string;
  provider: string;
  sideEffect: boolean;
  status: "executing" | "succeeded" | "failed" | "ambiguous";
  startedAt: string;
  completedAt?: string;
  providerResourceId?: string;
  providerResourceUrl?: string;
  safeMetadata?: Record<string, string | number | boolean>;
  errorCategory?: string;
}

/* -------------------------------------------------------------------------
 * Customer Zero 03 — Unified Inbox types.
 * -----------------------------------------------------------------------*/

export type InboxCategory =
  | "lead"
  | "customer_question"
  | "campaign_response"
  | "support"
  | "administrative"
  | "unknown";

export type InboxItemState =
  | "received"
  | "classified"
  | "routed"
  | "in_work"
  | "resolved"
  | "archived";

export interface InboxItemView {
  id: string;
  organizationId: string;
  source: string;
  sourceMessageId: string;
  channel: string;
  category: InboxCategory;
  subject: string;
  senderEmail?: string;
  senderName?: string;
  sender?: { email: string; displayName?: string };
  recipients?: { email: string; displayName?: string }[];
  cc?: { email: string; displayName?: string }[];
  preview: string;
  plainText?: string;
  htmlBody?: string;
  attachments?: { filename?: string; mimeType?: string; size?: number }[];
  mailbox?: string;
  folder?: string;
  receivedAt: string;
  unread: boolean;
  importance: number;
  departmentId: string | null;
  isLead: boolean;
  state: InboxItemState;
  relatedWorkItemId: string | null;
  /** Durable DepartmentTask projection for this Inbox item. */
  taskId: string | null;
  convertedToTask: boolean;
  relatedConversationId: string | null;
  provenance?: {
    provider?: string;
    providerMessageUid?: string;
    rawEventId?: string;
  };
}

export interface CeoOverview {
  organizationId: string;
  goal: string;
  companyName: string;
  heads: HeadIdentity[];
  decisions: DecisionView[];
  activity: ActivityView[];
  results: ResultView[];
  connections: { toolId: string; label: string; status: string; category: string }[];
  working: number;
  done: number;
  team?: {
    director: { name: string; role: string; initials: string };
    specialists: { id: string; name: string; role: string; status: string }[];
  };
  company?: CompanyOperatingState;
}

export interface CompanyOperatingState {
  dataStatus: "available" | "partial";
  summary: {
    digitalEmployees: number;
    operationalCapabilities: number;
    workingNow: number;
    connectedTools: number;
    pendingApprovals: number;
    activeObjective: { id: string | null; title: string } | null;
  };
  departments: {
    id: string;
    name: string;
    status: string;
    head: HeadIdentity;
    employees: {
      id: string;
      name: string;
      role: string;
      status: string;
      currentWork?: string;
    }[];
    employeesWorkingNow: number;
    capabilities: {
      id: string;
      label: string;
      description: string;
      state: "disponible" | "necesita_conexion" | "no_disponible";
    }[];
    tools: { toolId: string; label: string; capability: string }[];
    toolsConnected: number;
    activeObjective: { id: string | null; title: string; progress?: number } | null;
  }[];
  employees: {
    id: string;
    name: string;
    role: string;
    departmentId: string;
    status: string;
    currentWork?: string;
  }[];
  capabilities: {
    id: string;
    label: string;
    description: string;
    state: "disponible" | "necesita_conexion" | "no_disponible";
  }[];
  tools: { toolId: string; label: string; capability: string; status: "connected" }[];
  pendingApprovals: {
    id: string;
    from: string;
    title: string;
    detail: string;
    cost?: string;
    status: "pending";
    createdAt: string;
  }[];
  activity: (ActivityView & { createdAt?: string })[];
  results: (ResultView & { createdAt?: string })[];
}

export interface MarketingWorkItem {
  id: string;
  title: string;
  description: string;
  kind: string;
  capability?: string;
  status?: string;
  result?: string;
}

export interface MarketingWorkState {
  goal: string;
  summary: string;
  items: MarketingWorkItem[];
}

export interface CompanyStatus {
  organizationId: string;
  url?: string;
  companyName?: string;
  locale?: string;
  onboarding?: {
    companyName: string;
    hasWebsite: boolean;
    url?: string;
    description?: string;
    country?: string;
    companySize?: string;
    goal: string;
  };
  discoveryTranscript?: { questionId: string; question: string; answer: string }[];
  connections?: ConnectionCard[];
  unmappedTools?: string[];
  department: { id: string; name: string; status: string; employeeAgentIds: string[] } | null;
  marketingWork?: MarketingWorkState | null;
  conversation: { role: string; content: string }[];
  /** Customer Zero readiness — backend gate result. */
  contextReady?: boolean;
  contextMissing?: readonly string[];
  /** Canonical durable onboarding stage: intake|research|discovery|understanding|ready */
  stage?: "intake" | "research" | "discovery" | "understanding" | "ready";
}

/**
 * What Departify understood about the company, for CEO review.
 *
 * Business language only — this view never exposes DNA internals,
 * schemas, provenance jargon or readiness plumbing to the CEO.
 */
export interface UnderstandingView {
  organizationId: string;
  companyName: string;
  description?: string;
  objective?: string;
  geography?: string;
  products: readonly string[];
  customers: readonly string[];
  positioning?: string;
  businessModel?: string;
  declaredTools: readonly string[];
  uncertainties: readonly string[];
  confirmed: boolean;
  missing: readonly string[];
  provenance?: Record<string, "research" | "ceo" | "inferred">;
}

/** The CEO's corrections to the understood company. */
export interface CompanyCorrections {
  companyName?: string;
  description?: string;
  objective?: string;
  geography?: string;
  products?: readonly string[];
  customers?: readonly string[];
}

/* -------------------------------------------------------------------------
 * Command Center — Sprint 58.
 *
 * The CEO's single chat. The transcript is a stream of `CommandCenterEvent`
 * items: free-form messages, business events (approval requests, results,
 * work updates, connection needs), and team visibility cards. The portal
 * renders business events as cards; the chat continues to feel like a chat.
 * -------------------------------------------------------------------------*/

export interface CommandCenterWorkItemView {
  id: string;
  title: string;
  description: string;
  status: string;
  kind: string;
  capability?: string;
  result?: string;
}

export interface CommandCenterConnectionSuggestion {
  toolId: string | null;
  label: string;
  capability: string;
  why: string;
  connectable: boolean;
  requiredCredentials: readonly string[];
  rawInput: string;
}

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
  | { kind: "connection_need"; suggestion: CommandCenterConnectionSuggestion }
  | { kind: "work_update"; item: CommandCenterWorkItemView }
  | {
      kind: "approval_request";
      item: CommandCenterWorkItemView;
      proposal: string;
      detail: string;
    }
  | { kind: "result"; item: CommandCenterWorkItemView }
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
      suggestion: {
        title: string;
        content: string;
        fromDepartment: string;
        confidence: number;
      };
    }
  | {
      kind: "work_state";
      state:
        | "received"
        | "delegated"
        | "analyzing"
        | "tool_started"
        | "tool_completed"
        | "preparing_result"
        | "completed"
        | "blocked"
        | "error";
      message: string;
    };

export interface CommandCenterRouting {
  intent: string;
  departments: readonly string[];
  rationale: string;
}

export interface CommandCenterOpening {
  organizationId: string;
  events: readonly CommandCenterEvent[];
}

export interface CommandCenterMessageResult {
  organizationId: string;
  reply: string;
  events: readonly CommandCenterEvent[];
  routing: CommandCenterRouting;
  connectionSuggestion: CommandCenterConnectionSuggestion | null;
  pendingToolId: string | null;
}

/* -------------------------------------------------------------------------
 * Marketing department API (Sprint ENGINE 03) — business language only.
 * -------------------------------------------------------------------------*/

export interface MarketingDepartmentStatus {
  id: string;
  name: string;
  head: { departmentId: string; department: string; name: string; role: string; initials: string };
  status: string;
  employees: {
    id: string;
    label: string;
    role: string;
    status: string;
    currentWork?: string;
    capabilities: string[];
  }[];
  employeesWorkingNow: number;
  capabilities: {
    id: string;
    label: string;
    description: string;
    state: "disponible" | "necesita_conexion" | "no_disponible";
  }[];
  tools: { toolId: string; label: string; capability: string; status: string; note?: string }[];
  toolsConnected: number;
  activeObjective: {
    id: string;
    title: string;
    description: string;
    desiredOutcome: string;
    constraints: string[];
    status: string;
    progress: number;
    createdAt: string;
    owner: string;
    plan?: string;
  } | null;
  pendingApprovals: {
    id: string;
    from: string;
    title: string;
    detail: string;
    cost?: string;
    status: string;
    createdAt: string;
  }[];
  recentActivity: {
    id: string;
    actor: string;
    kind: string;
    message: string;
    createdAt: string;
  }[];
  activeWork: {
    id: string;
    title: string;
    status: "queued" | "running" | "waiting_approval";
    statusMessage: string;
    progress: number;
    createdAt: string;
    resultId?: string;
  }[];
  results: { id: string; title: string; summary: string }[];
}

export interface MarketingObjective {
  id: string;
  title: string;
  description: string;
  desiredOutcome: string;
  constraints: string[];
  status: string;
  progress: number;
  createdAt: string;
  owner: string;
  plan?: string;
}

/* -------------------------------------------------------------------------
 * Auth + tenant (Phase P0-A).
 * -------------------------------------------------------------------------*/

export interface MeView {
  user: { id: string; email?: string };
  organizations: { organizationId: string; name: string; role: string }[];
}

export interface ResearchStageView {
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "failed";
  finding?: string;
}

export interface ProgressView {
  organizationId: string;
  status: "running" | "completed" | "failed";
  stages: ResearchStageView[];
  estimatedMs: number | null;
  error?: string;
  gapCount?: number;
  understood: Record<string, unknown>;
}

export interface ProgressiveQuestionView {
  id: string;
  kind: string;
  category?: string;
  question: string;
  component: string;
  options?: string[];
  weight: string;
  hint?: string;
}

/** Progressive-discovery conversation (intake phase). Distinct from
 *  the durable chat ConversationView below. */
export interface ProgressiveDiscoveryView {
  organizationId: string;
  question: ProgressiveQuestionView | null;
  ready: boolean;
  gapCount: number;
  connections: ConnectionCard[];
  transcript: { questionId: string; question: string; answer: string }[];
  intro: string;
  handoff?: string;
  gapsResolved?: number;
}

export interface StartView {
  organizationId: string;
  url?: string;
  estimatedMs?: number | null;
  error?: { message: string };
}

/* -------------------------------------------------------------------------
 * Durable conversations (Phase P-B part 15).
 * -------------------------------------------------------------------------*/

export interface ConversationView {
  id: string;
  organizationId: string;
  title: string;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string;
  /** Optional summary persisted by compaction. Surfaced in the portal
   *  only as a hint ("Conversación larga — Departify recuerda el
   *  contexto"). Never editable by the CEO. */
  summary?: string;
  compactedAt?: string;
}

export interface MessageView {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface ConversationListView {
  organizationId: string;
  conversations: ConversationView[];
  activeCount: number;
  maxActive: number;
}

export interface ConversationPageView {
  conversation: ConversationView;
  messages: MessageView[];
  hasMore: boolean;
  nextCursor?: string;
}

export interface MaxActiveConversationsError {
  code: "MAX_ACTIVE_CONVERSATIONS";
  message: string;
  activeCount: number;
  maxActive: number;
}

/**
 * P0 — The portal needs an Authorization header on the FIRST request after
 * a top-level redirect (the Google OAuth callback). The `AuthProvider`
 * hydrates this in-memory token via an async `client.auth.getSession()`,
 * but a synchronous `useEffect` on the callback page can dispatch the
 * exchange POST before the async hydration settles. When that happens the
 * backend auth boundary rejects with `missing_token` and the portal
 * surfaces a generic Spanish "no se pudo conectar" copy — masking the
 * real, recoverable condition: the user IS authenticated, we just lost
 * the race to read the token.
 *
 * supabase-js v2 persists the session in `localStorage` under
 * `sb-<project-ref>-auth-token` (see @supabase/supabase-js
 * DEFAULT_AUTH_OPTIONS + defaultStorageKey). Reading that key at module
 * load time gives us a synchronous fallback for `buildHeaders()` so the
 * callback exchange fires with a valid Bearer token on its very first
 * attempt.
 */
function readPersistedSupabaseAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!url) return null;
  let projectRef: string | undefined;
  try {
    projectRef = new URL(url).hostname.split(".")[0];
  } catch {
    return null;
  }
  if (!projectRef) return null;
  const key = `sb-${projectRef}-auth-token`;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { access_token?: unknown };
    return typeof parsed.access_token === "string" && parsed.access_token.length > 0
      ? parsed.access_token
      : null;
  } catch {
    return null;
  }
}

let accessToken: string | null = readPersistedSupabaseAccessToken();

/** The portal keeps Supabase's session token in memory and attaches it to
 *  every protected API call. Cleared on logout. */
export function setApiAccessToken(token: string | null): void {
  accessToken = token;
}

function buildHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers);
  if (accessToken) {
    headers.set("authorization", `Bearer ${accessToken}`);
  }
  return headers;
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { headers: buildHeaders() });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function postJson<T>(
  url: string,
  body?: unknown,
  options?: { correlationId?: string },
): Promise<T | null> {
  try {
    const headers = buildHeaders();
    if (options?.correlationId) {
      headers.set("x-departify-correlation-id", options.correlationId);
    }
    if (body !== undefined) {
      headers.set("content-type", "application/json");
    }
    const response = await fetch(url, {
      method: "POST",
      ...(body !== undefined
        ? { headers, body: JSON.stringify(body) }
        : { headers }),
    });
    const parsed = (await response.json()) as T;
    return response.ok ? parsed : parsed;
  } catch {
    return null;
  }
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T | null> {
  try {
    const response = await fetch(url, { ...init, headers: buildHeaders(init) });
    const parsed = (await response.json()) as T;
    return response.ok ? parsed : parsed;
  } catch {
    return null;
  }
}

export type GoogleOAuthReturnPath = "/" | "/conexiones" | "/chat";

const GOOGLE_OAUTH_RETURN_CONTEXT_KEY = "departify_google_oauth_return_context";

/** Safe, non-secret browser continuity hint for provider-side cancellation. */
export function rememberGoogleOAuthReturnPath(path: GoogleOAuthReturnPath): void {
  try {
    window.sessionStorage.setItem(GOOGLE_OAUTH_RETURN_CONTEXT_KEY, path);
  } catch {
    /* session storage is an optional UX fallback; server state remains authoritative */
  }
}

export function readGoogleOAuthReturnPath(): GoogleOAuthReturnPath {
  try {
    const value = window.sessionStorage.getItem(GOOGLE_OAUTH_RETURN_CONTEXT_KEY);
    if (value === "/" || value === "/conexiones" || value === "/chat") return value;
  } catch {
    /* fall through to the safe default */
  }
  return "/conexiones";
}

export const api = {
  me: () => getJson<MeView>("/api/auth/me"),
  start: (payload: Record<string, unknown>) =>
    postJson<StartView>("/api/customer-zero/start", payload),
  progress: (org: string) =>
    getJson<ProgressView>(`/api/customer-zero/${org}/progress`),
  nextQuestion: (org: string) =>
    getJson<ProgressiveDiscoveryView>(`/api/customer-zero/${org}/next-question`),
  answer: (org: string, questionId: string, answers: string[]) =>
    postJson<ProgressiveDiscoveryView>(`/api/customer-zero/${org}/answer`, {
      questionId,
      answers,
    }),
  enterMarketing: (org: string) =>
    postJson<{ organizationId: string; error?: { message?: string } }>(
      `/api/customer-zero/${org}/marketing`,
    ),
  /** What Departify understood about the company (CEO review screen). */
  understanding: (org: string) =>
    getJson<UnderstandingView>(`/api/customer-zero/${org}/understanding`),
  /** Resume/retry research for an existing org (never a replacement org). */
  research: (org: string) =>
    postJson<{ organizationId: string; status: string }>(
      `/api/customer-zero/${org}/research`,
      {},
    ),
  /** The CEO corrects and confirms the understanding. */
  confirmCompany: (org: string, corrections: CompanyCorrections) =>
    postJson<{
      organizationId: string;
      confirmed: boolean;
      contextReady: boolean;
      contextMissing: readonly string[];
      error?: { message?: string };
    }>(`/api/customer-zero/${org}/confirm`, corrections),
  /** Resume helper: distinguishes a stale session (404) from a server error. */
  statusDetailed: async (
    org: string,
  ): Promise<{ status: number; data: CompanyStatus | null } | null> => {
    try {
      const response = await fetch(`/api/customer-zero/${org}`, {
        headers: buildHeaders(),
      });
      const data = response.ok
        ? ((await response.json()) as CompanyStatus)
        : null;
      return { status: response.status, data };
    } catch {
      return null;
    }
  },
  overview: (org: string) => getJson<CeoOverview>(`/api/customer-zero/${org}/overview`),
  status: (org: string) => getJson<CompanyStatus>(`/api/customer-zero/${org}`),
  connections: (org: string) =>
    getJson<{
      organizationId: string;
      connections: ToolConnectionView[];
      cards: ConnectionCardView[];
      unmappedTools: string[];
      }>(`/api/customer-zero/${org}/connections`),
  llmSettings: (org: string) =>
    getJson<LlmSettingsView>(`/api/customer-zero/${org}/llm-settings`),
  saveLlmSettings: (org: string, payload: { provider: "openai"; model: string; apiKey: string }) =>
    postJson<LlmSettingsView & { error?: { code?: string; message?: string } }>(
      `/api/customer-zero/${org}/llm-settings`,
      payload,
    ),
  workFeed: (org: string, since?: string) =>
    getJson<{
      organizationId: string;
      tasks: DepartmentTask[];
      results: DepartmentResult[];
      newTasks: DepartmentTask[];
      newResults: DepartmentResult[];
      serverTime: string;
    }>(
      `/api/customer-zero/${org}/work-feed${since ? `?since=${encodeURIComponent(since)}` : ""}`,
    ),
  results: (org: string) =>
    getJson<{
      organizationId: string;
      results: DepartmentResult[];
      dashboardCount?: number;
      dashboardLimit?: number;
    }>(`/api/customer-zero/${org}/results`),
  inbox: (org: string, query?: { category?: string; state?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (query?.category) params.set("category", query.category);
    if (query?.state) params.set("state", query.state);
    if (query?.limit) params.set("limit", String(query.limit));
    const q = params.toString();
    return getJson<{
      organizationId: string;
      items: InboxItemView[];
    }>(`/api/customer-zero/${org}/inbox${q ? `?${q}` : ""}`);
  },
  inboxSync: (org: string, body?: { maxResults?: number }) =>
    postJson<{
      organizationId: string;
      imported: number;
      classified: number;
      highImportance: number;
    }>(
      `/api/customer-zero/${org}/inbox/sync`,
      body ?? {},
    ),
  inboxItem: (org: string, itemId: string) =>
    getJson<{
      organizationId: string;
      item: InboxItemView;
    }>(`/api/customer-zero/${org}/inbox/${itemId}`),
  inboxToWork: (org: string, itemId: string, capability?: string) =>
    postJson<{
      organizationId: string;
      task: { id: string; title: string; status: string };
      item: InboxItemView;
    }>(`/api/customer-zero/${org}/inbox/${itemId}/work`, {
      ...(capability ? { capability } : {}),
    }),
  inboxReplyDraft: (org: string, itemId: string, body: string) =>
    postJson<{
      organizationId: string;
      draftId: string;
      provider: string;
      draft: { to: string; subject: string; body: string };
      status: string;
      error?: string;
    }>(`/api/customer-zero/${org}/inbox/${itemId}/reply/draft`, { body }),
  inboxEmailDraft: (org: string, input: { to: string; subject: string; body: string; provider?: string }) =>
    postJson<{
      organizationId: string;
      draftId: string;
      provider: string;
      draft: { to: string; subject: string; body: string };
      status: string;
      error?: string;
    }>(`/api/customer-zero/${org}/inbox/email/draft`, input),
  inboxEmailApprove: (org: string, draftId: string) =>
    postJson<{
      organizationId: string;
      draftId: string;
      reply: string;
      status: string;
      receipt: ExecutionReceipt | null;
      draft?: { to: string; subject: string; body: string };
      error?: string;
    }>(`/api/customer-zero/${org}/inbox/email/approve`, { draftId }),
  testConnection: (org: string, provider: string) =>
    postJson<{
      provider: string;
      state: ConnectionFiveState;
      message: string;
      available: boolean;
    }>(`/api/customer-zero/${org}/connections/${provider}/test`, {}),
  capabilities: (org: string) =>
    getJson<{
      capabilities: {
        capability: string;
        available: boolean;
        providers: string[];
      }[];
    }>(`/api/customer-zero/${org}/capabilities`),
  declareTool: (org: string, toolId: string) =>
    postJson<{ connection: ToolConnectionView }>(
      `/api/customer-zero/${org}/connections/${toolId}/declare`,
    ),
  connect: (
    org: string,
    toolId: string,
    returnPath?: GoogleOAuthReturnPath,
    reconnect = false,
    channel?: "facebook" | "instagram",
  ) =>
    postJson<{ connection: ConnectionCard }>(
      `/api/customer-zero/${org}/connections/${toolId}/connect`,
      returnPath || reconnect
        ? {
            ...(returnPath ? { returnPath } : {}),
            ...(reconnect ? { reconnect: true } : {}),
            ...(channel ? { channel } : {}),
          }
        : undefined,
    ),
  disconnect: (org: string, toolId: string) =>
    postJson<{
      organizationId: string;
      toolId: string;
      state: "needs_connection";
      providerRevoked: boolean;
    }>(`/api/customer-zero/${org}/connections/${toolId}/disconnect`, {}),
  finishGoogleConnect: (org: string, code: string, state: string) =>
    postJson<
      { connection: ConnectionCard } & {
        identity?: { email: string };
        operational?: boolean;
        returnPath?: GoogleOAuthReturnPath;
        error?: { code?: string; message?: string };
      }
    >(`/api/customer-zero/${org}/connections/google/callback`, {
      code,
      state,
    }),
  finishMetaConnect: (org: string, code: string, state: string) =>
    postJson<
      { connection: ConnectionCard } & {
        operational?: boolean;
        returnPath?: GoogleOAuthReturnPath;
        grantedScopes?: string[];
        accountLabel?: string;
        error?: { code?: string; message?: string };
      }
    >(`/api/customer-zero/${org}/connections/meta_business/callback`, {
      code,
      state,
    }),
  finishExternalConnect: (org: string, toolId: string, code: string, state: string) =>
    postJson<{ connection: ConnectionCard; operational?: boolean; returnPath?: string; error?: { code?: string; message?: string } }>(
      `/api/customer-zero/${org}/connections/${toolId}/callback`, { code, state },
    ),
  configureCorporateEmail: (
    org: string,
    payload: {
      email: string;
      username: string;
      password: string;
      imapHost: string;
      imapPort?: number;
      imapSecure?: boolean;
      smtpHost: string;
      smtpPort?: number;
      smtpSecure?: boolean;
      displayName?: string;
    },
  ) =>
    postJson<{
      organizationId: string;
      email: string;
      operational: boolean;
      probe: { imapOk: boolean; smtpOk: boolean; error: string | null };
    }>(
      `/api/customer-zero/${org}/connections/corporate-email/configure`,
      payload,
    ),
  configureMarketingConnector: (
    org: string,
    toolId: "wordpress" | "shopify",
    payload: Record<string, string>,
  ) =>
    postJson<{
      organizationId: string;
      provider: string;
      accountLabel: string;
      operational: boolean;
      error: string | null;
    }>(`/api/customer-zero/${org}/connections/${toolId}/configure`, payload),
  plan: (org: string, goal: string) =>
    postJson<{ summary: string; items: MarketingWorkItem[]; error?: { message: string } }>(
      `/api/customer-zero/${org}/marketing/work`,
      { goal },
    ),
  itemAction: (org: string, itemId: string, action: "execute" | "approve") =>
    postJson<{ status: string; result: string; error?: { message: string } }>(
      `/api/customer-zero/${org}/marketing/work/${itemId}/${action}`,
    ),
  message: (org: string, message: string) =>
    postJson<{ reply?: string; error?: { message: string } }>(
      `/api/customer-zero/${org}/marketing/messages`,
      { message },
    ),
  handoff: (org: string) =>
    getJson<{ message: string; goal: string; head: HeadIdentity }>(
      `/api/customer-zero/${org}/handoff`,
    ),
  // Command Center — the single chat. The Home route hosts this.
  commandCenterOpening: (org: string) =>
    getJson<CommandCenterOpening>(
      `/api/customer-zero/${org}/command-center/opening`,
    ),
  commandCenterMessage: (
    org: string,
    message: string,
    conversationId?: string,
    correlationId?: string,
  ) =>
    postJson<CommandCenterMessageResult & {
      conversationId?: string;
      error?: MaxActiveConversationsError;
    }>(
      `/api/customer-zero/${org}/command-center/message`,
      conversationId ? { message, conversationId } : { message },
      correlationId ? { correlationId } : undefined,
    ),
  // Durable conversations (Phase P-B part 15 + 26).
  conversations: (org: string) =>
    getJson<ConversationListView>(
      `/api/customer-zero/${org}/conversations`,
    ),
  conversationHistory: (org: string) =>
    getJson<{ conversations: ConversationView[] }>(
      `/api/customer-zero/${org}/conversations/history`,
    ),
  createConversation: (org: string, title?: string) =>
    postJson<{ conversation: ConversationView } & { error?: MaxActiveConversationsError }>(
      `/api/customer-zero/${org}/conversations`,
      title ? { title } : undefined,
    ),
  conversation: (org: string, conversationId: string, before?: string) =>
    getJson<ConversationPageView>(
      `/api/customer-zero/${org}/conversations/${conversationId}${before ? `?before=${encodeURIComponent(before)}` : ""}`,
    ),
  sendConversationMessage: (
    org: string,
    conversationId: string,
    message: string,
    correlationId?: string,
  ) =>
    postJson<CommandCenterMessageResult & { conversationId: string }>(
      `/api/customer-zero/${org}/conversations/${conversationId}/messages`,
      { message },
      correlationId ? { correlationId } : undefined,
    ),
  archiveConversation: (org: string, conversationId: string) =>
    postJson<{ ok: boolean }>(
      `/api/customer-zero/${org}/conversations/${conversationId}/archive`,
    ),
  // Marketing department (ENGINE 03) — business language.
  marketingDepartment: (org: string) =>
    getJson<MarketingDepartmentStatus>(`/api/departments/marketing/${org}`),
  marketingObjectives: (org: string) =>
    getJson<{ objectives: MarketingObjective[] }>(
      `/api/departments/marketing/${org}/objectives`,
    ),
  createMarketingObjective: (
    org: string,
    payload: {
      title: string;
      description: string;
      desiredOutcome: string;
      constraints?: string[];
      locale?: string;
    },
  ) =>
    postJson<{ objective: MarketingObjective }>(
      `/api/departments/marketing/${org}/objectives`,
      payload,
    ),
  marketingMessage: (org: string, message: string, locale?: string) =>
    postJson<{
      reply: string;
      activity?: unknown[];
      approvals?: unknown[];
      objective?: MarketingObjective | null;
    }>(`/api/departments/marketing/${org}/message`, { message, ...(locale ? { locale } : {}) }),
  marketingActivity: (org: string) =>
    getJson<{ activity: { id: string; actor: string; kind: string; message: string; createdAt: string }[] }>(
      `/api/departments/marketing/${org}/activity`,
    ),
  marketingApprovals: (org: string) =>
    getJson<{
      approvals: {
        id: string;
        from: string;
        title: string;
        detail: string;
        cost?: string;
        status: string;
        createdAt: string;
      }[];
    }>(`/api/departments/marketing/${org}/approvals`),
  decideMarketingApproval: (org: string, approvalId: string, action: "approve" | "reject") =>
    postJson<{
      approval: {
        id: string;
        title: string;
        status: string;
        decidedAt?: string;
      };
    }>(`/api/departments/marketing/${org}/approvals/${approvalId}`, { action }),
  marketingEmployees: (org: string) =>
    getJson<{
      employees: {
        id: string;
        label: string;
        role: string;
        status: string;
        currentWork?: string;
      }[];
    }>(`/api/departments/marketing/${org}/employees`),
  marketingTools: (org: string) =>
    getJson<{
      tools: { toolId: string; label: string; capability: string; status: string; note?: string }[];
    }>(`/api/departments/marketing/${org}/tools`),
  dashboards: (org: string, departmentId: string) =>
    getJson<{
      organizationId: string;
      departmentId: string;
      dashboards: DashboardDefinition[];
      dashboardCount: number;
      dashboardLimit: number;
      remainingSlots: number;
    }>(`/api/departments/${departmentId}/${org}/dashboards`),
  dashboardSummary: (org: string) =>
    getJson<{ dashboardCount: number; dashboardLimit: number }>(`/api/dashboards/${org}`),
  createDashboard: (org: string, departmentId: string, template?: string) =>
    postJson<{
      organizationId: string;
      dashboard: DashboardDefinition;
      dashboardCount: number;
      dashboardLimit: number;
    }>(`/api/departments/${departmentId}/${org}/dashboards`, template ? { template } : {}),
  archiveDashboard: (org: string, departmentId: string, dashboardId: string) =>
    fetchJson<{ organizationId: string; dashboard: DashboardDefinition }>(
      `/api/departments/${departmentId}/${org}/dashboards/${dashboardId}`,
      { method: "DELETE" },
    ),
  calendar: (org: string, filters?: { departmentId?: string; type?: string; status?: string; from?: string; to?: string }) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters ?? {})) if (value) params.set(key, value);
    const query = params.toString();
    return getJson<{
      organizationId: string;
      entries: BusinessCalendarEntry[];
      externalState: "connected" | "disconnected" | "error";
      sourceCount: number;
    }>(`/api/calendar/${org}${query ? `?${query}` : ""}`);
  },
  seoDepartment: (org: string) =>
    getJson<{
      organizationId: string;
      department: { id: string; name: string; responsible: string; description: string };
      state: "ready" | "web_detected" | "disconnected";
      website: string | null;
      onboarding: {
        stage: "website_missing" | "repository_missing" | "repository_select" | "ready";
        websiteDetected: boolean;
        repositoryConnected: boolean;
        repositoryRead: boolean;
        repositoryWrite: boolean;
      };
      repository: {
        repositoryFullName: string;
        defaultBranch: string;
        access: "read" | "write";
      } | null;
      repositories: { id: string; fullName: string; private: boolean; defaultBranch: string; htmlUrl: string }[];
      tasks: DepartmentTask[];
      results: DepartmentResult[];
      capabilities: {
        websiteAudit: boolean;
        searchConsole: boolean;
        analytics: boolean;
        repositoryRead: boolean;
        repositoryWrite: boolean;
        roster: { id: string; label: string; description: string; state: "disponible" | "necesita_conexion" | "no_disponible" }[];
      };
    }>(`/api/departments/seo/${org}`),
  seoRepository: (org: string, repository: { repositoryId: string; repositoryFullName: string; defaultBranch?: string }) =>
    postJson<{ organizationId: string; repository: { repositoryFullName: string; defaultBranch: string; access: "read" | "write" }; repositoryRead: boolean; repositoryWrite: boolean }>(
      `/api/departments/seo/${org}/repository`, repository,
    ),
  seoAudit: (org: string) =>
    postJson<{ organizationId: string; task: DepartmentTask; result: DepartmentResult; report: SeoAuditReport }>(
      `/api/departments/seo/${org}/audit`,
      {},
    ),
};
