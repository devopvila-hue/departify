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

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function postJson<T>(url: string, body?: unknown): Promise<T | null> {
  try {
    const response = await fetch(url, {
      method: "POST",
      ...(body
        ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
        : {}),
    });
    const parsed = (await response.json()) as T;
    return response.ok ? parsed : parsed;
  } catch {
    return null;
  }
}

export const api = {
  overview: (org: string) => getJson<CeoOverview>(`/api/customer-zero/${org}/overview`),
  status: (org: string) => getJson<CompanyStatus>(`/api/customer-zero/${org}`),
  connections: (org: string) =>
    getJson<{ connections: ConnectionCard[]; unmappedTools: string[] }>(
      `/api/customer-zero/${org}/connections`,
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
  commandCenterMessage: (org: string, message: string) =>
    postJson<CommandCenterMessageResult>(
      `/api/customer-zero/${org}/command-center/message`,
      { message },
    ),
};
