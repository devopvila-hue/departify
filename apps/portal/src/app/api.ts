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

export interface ToolConnectionView {
  toolId: string;
  label: string;
  capability: string;
  category: string;
  /** Business domains this tool belongs to (primary first). */
  domains: ToolDomain[];
  /** "available" when the organization has no state for the tool. */
  state: ToolLifecycleStatus | "available";
  hasState: boolean;
  humanLabel: string;
  action: "prepare" | "connect" | "verify" | "retry" | null;
  verifiedAt?: string;
  blockedReason?: string;
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
  category: string;
  logoMark: string;
  brandColor: string;
  state: ConnectionFiveState;
  stateLabel: string;
  configSource: string | null;
  verifiedAt: string | null;
  capabilities: ConnectionCapabilityView[];
  actionLabel: string | null;
}

export interface ConnectionCardDetailView extends ConnectionCardView {
  organizationId: string;
  provider: string;
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

export interface ConversationView {
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
}

export interface MessageView {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

let accessToken: string | null = null;

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

async function postJson<T>(url: string, body?: unknown): Promise<T | null> {
  try {
    const headers = buildHeaders();
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

export const api = {
  me: () => getJson<MeView>("/api/auth/me"),
  start: (payload: Record<string, unknown>) =>
    postJson<StartView>("/api/customer-zero/start", payload),
  progress: (org: string) =>
    getJson<ProgressView>(`/api/customer-zero/${org}/progress`),
  nextQuestion: (org: string) =>
    getJson<ConversationView>(`/api/customer-zero/${org}/next-question`),
  answer: (org: string, questionId: string, answers: string[]) =>
    postJson<ConversationView>(`/api/customer-zero/${org}/answer`, {
      questionId,
      answers,
    }),
  enterMarketing: (org: string) =>
    postJson<{ organizationId: string; error?: { message?: string } }>(
      `/api/customer-zero/${org}/marketing`,
    ),
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
      connections: ToolConnectionView[];
      cards: ConnectionCardView[];
      unmappedTools: string[];
    }>(`/api/customer-zero/${org}/connections`),
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
    }>(`/api/customer-zero/${org}/results`),
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
  connect: (org: string, toolId: string) =>
    postJson<{ connection: ConnectionCard }>(
      `/api/customer-zero/${org}/connections/${toolId}/connect`,
    ),
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
  commandCenterMessage: (org: string, message: string, conversationId?: string) =>
    postJson<CommandCenterMessageResult & { conversationId?: string }>(
      `/api/customer-zero/${org}/command-center/message`,
      conversationId ? { message, conversationId } : { message },
    ),
  // Durable conversations (Phase P-B part 15).
  conversations: (org: string) =>
    getJson<{ conversations: ConversationView[] }>(
      `/api/customer-zero/${org}/conversations`,
    ),
  createConversation: (org: string, title?: string) =>
    postJson<{ conversation: ConversationView }>(
      `/api/customer-zero/${org}/conversations`,
      title ? { title } : undefined,
    ),
  conversation: (org: string, conversationId: string) =>
    getJson<{ conversation: ConversationView; messages: MessageView[] }>(
      `/api/customer-zero/${org}/conversations/${conversationId}`,
    ),
  sendConversationMessage: (org: string, conversationId: string, message: string) =>
    postJson<CommandCenterMessageResult & { conversationId: string }>(
      `/api/customer-zero/${org}/conversations/${conversationId}/messages`,
      { message },
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
};
