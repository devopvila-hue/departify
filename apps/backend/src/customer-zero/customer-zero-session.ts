/**
 * Customer Zero session composition — Sprint 57.
 *
 * Unlike the Sprint 56 single-shot route, the Customer Zero flow is
 * multi-step (URL → understand → confirm → gaps → prepare Marketing → chat).
 * A session holds the REAL composed runtime for one organization so the
 * context survives across HTTP requests inside the process (in-memory
 * adapters, as the sprint allows). No domain logic lives here: the session
 * composes the existing packages exactly as the validated smoke test does.
 */
import {
  AgentToolRuntimeAdapter,
  buildAgentPermissionSetResolver,
  type AgentToolPort,
} from "@departify/agent-tool-bridge";
import {
  BusinessDiscoveryService,
  createInMemoryDiscoveryReportRepository,
  type CompanyDiscoveryReport,
  type DiscoveryReportRepository,
} from "@departify/business-discovery";
import {
  BusinessEventService,
  buildCanonicalCatalog,
  type BusinessEvent,
  type BusinessEventResult,
} from "@departify/business-events";
import {
  buildMarketingTemplate,
  createDepartmentService,
  createDepartmentTemplateCatalog,
  type DepartmentService,
} from "@departify/departments";
import { ExecutiveDirector } from "@departify/executive-director";
import {
  createExecutiveDiscoveryWorkflow,
  createExecutiveOrchestrator,
  type ExecutiveDiscoveryWorkflow,
} from "@departify/executive-orchestrator";
import { BusinessProvisioningService } from "@departify/platform-composition";
import { registerAllCoreTools } from "@departify/tool-catalog";
import {
  createMauticContactCountToolDefinition,
  createMauticContactSearchToolDefinition,
  createMauticTestConnectionToolDefinition,
} from "./mautic-tools.js";
import {
  produceMarketingDiagnosis,
  formTeam,
  type MarketingDiagnosis,
  type TeamFormationResult,
} from "@departify/marketing-director";
import {
  createInMemoryMemoryRecordStore,
} from "@departify/memory";
import type { InMemoryMemoryRecordStore } from "@departify/memory";
import {
  createToolRuntime,
  ToolRegistry as ToolRuntimeRegistry,
  type ToolRuntime,
} from "@departify/tool-runtime";
import {
  DepartmentCapabilityRegistry,
  buildMauticCapability,
} from "@departify/capability-engine";
import {
  WorkflowExecution,
  type WorkflowResult,
} from "@departify/workflows";
import { randomUUID } from "node:crypto";
import { buildLlmRuntime, type LlmRuntime } from "./llm-runtime.js";
import type { SupportedLocale } from "./locale.js";
import type { ResearchProgress } from "./research-progress.js";
import {
  createConversationState,
  type DiscoveryConversationState,
} from "./progressive-discovery.js";
import type { ConnectionState } from "./connections.js";
import { TOOL_CATALOG, buildConnectionStateWithLifecycle } from "./connections.js";
import { resolveMauticCredentials } from "./mautic-adapter.js";
import {
  InMemoryToolStateStore,
  lifecycleToConnectionStatus,
  type OrganizationToolState,
  type ToolLifecycleStatus,
  type ToolStateStore,
} from "./tool-state.js";
import {
  InMemoryConversationStore,
  type ConversationStore,
} from "./conversation-store.js";
import type { DepartmentMemoryStore } from "./department-memory.js";
import {
  getGoogleTokenStore,
  hasOperationalGoogleCapability,
  type GoogleCapability,
} from "./google-tokens.js";

const ONBOARDING_DIRECTOR_AGENT_ID = "agent_marketing_director";
const ONBOARDING_EMPLOYEE_AGENT_ID = "agent_content_strategist";
const MARKETING_TEMPLATE_ID = "tpl_marketing";
const PLAN_ID = "plan_marketing";

export interface CustomerZeroSessionState {
  readonly organizationId: string;
  url?: string;
  rawData: Readonly<Record<string, unknown>>;
  companyName?: string;
  conversation: readonly { role: "user" | "assistant"; content: string }[];
  /** The Marketing department's structured work for this organization. */
  marketingWork?: MarketingWorkState;
  /** Pending email action (Customer Zero Email P0) — multi-turn send work. */
  pendingEmailWork?: import("./pending-email.js").PendingEmailWork;
  /** Latest provider-backed email reference usable for an explicit reply. */
  lastEmailContext?: {
    provider: "google" | "corporate" | "hostinger";
    providerMessageId: string;
    providerThreadId?: string;
    subject: string;
    senderEmail: string;
  };
  /** Pending Calendar mutation; retained until the CEO approves or cancels. */
  pendingCalendarWork?: {
    summary: string;
    hour?: number;
    minute?: number;
    startIso?: string;
    endIso?: string;
    timezone: string;
    attendees: readonly string[];
    status: "awaiting_date" | "awaiting_approval" | "creating";
    createdAt: string;
  };
  /** Last Calendar result confirmed by Google; never populated from prose. */
  lastCalendarOperation?: {
    status: "verified" | "failed" | "ambiguous";
    operation: "list" | "get" | "create" | "update";
    eventId?: string;
    calendarId?: string;
    htmlLink?: string;
    summary?: string;
    startIso?: string;
    endIso?: string;
    verifiedAt?: string;
    error?: string;
  };
  /** Latest normalized connector receipt. Contains safe provider evidence only. */
  lastExecutionReceipt?: import("./execution-receipt.js").ExecutionReceipt;
  /** UI/session locale — every generated visible text respects it. */
  locale: SupportedLocale;
  /** Onboarding intake (Fase 2). */
  onboarding?: OnboardingIntake;
  /** Live research state for the "Conociendo tu negocio…" screen (Fase 3). */
  progress?: ResearchProgress;
  /** Progressive discovery conversation state (Fase 6). */
  discovery: DiscoveryConversationState;
  /** Transcript of the progressive discovery conversation. */
  discoveryTranscript: DiscoveryTurn[];
  /** Tools the CEO told us about, mapped to internal connectors. */
  connections: Map<string, ConnectionState>;
  /** Tools mentioned that Departify has no capability for (honest). */
  unmappedTools: string[];
  /** What the research really understood about the business. */
  understood?: Readonly<Record<string, unknown>>;
  /** Whether durable tool/connection state was hydrated (Phase P-B). */
  toolHydrated?: boolean;
  /**
   * Whether the durable Company DNA was rehydrated into this session
   * (Customer Zero P0). This is what lets the company understanding
   * survive a backend restart instead of dying with the process.
   */
  dnaHydrated?: boolean;
  /** The organization's current/selected conversation (Phase P-B part 15). */
  currentConversationId?: string;
  /** Marketing Director's diagnosis of the business. */
  marketingDiagnosis?: MarketingDiagnosis;
  /** The team Elvira formed for the current goal. */
  marketingTeam?: TeamFormationResult;
}

export interface DiscoveryTurn {
  readonly questionId: string;
  readonly question: string;
  readonly answer: string;
}

export interface OnboardingIntake {
  readonly companyName: string;
  readonly hasWebsite: boolean;
  readonly url?: string;
  readonly description?: string;
  readonly country?: string;
  readonly companySize?: string;
  /** What the CEO wants to achieve now — travels all the way to Marketing. */
  readonly goal: string;
}

export type MarketingWorkItemStatus =
  | "pending"
  | "running"
  | "completed"
  | "needs_approval"
  | "approved"
  | "unavailable"
  | "failed";

export interface MarketingWorkItemState {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly kind: "analysis" | "creation" | "external_action";
  readonly capability?: string;
  status: MarketingWorkItemStatus;
  /** The real deliverable produced by Marketing, once executed. */
  result?: string;
}

export interface MarketingWorkState {
  /** The CEO's original business intention. */
  readonly goal: string;
  /** Marketing's interpretation of the goal. */
  readonly summary: string;
  items: readonly MarketingWorkItemState[];
}

/**
 * The composed runtime + state of one Customer Zero organization. All
 * dependencies are real and shared across the steps of the flow.
 */
export interface CustomerZeroSession {
  readonly organizationId: string;
  readonly llm: LlmRuntime;
  readonly reportRepository: DiscoveryReportRepository;
  readonly departmentService: DepartmentService;
  readonly discoveryWorkflow: ExecutiveDiscoveryWorkflow;
  readonly executor: WorkflowExecution;
  readonly port: AgentToolPort;
  readonly provisioning: BusinessProvisioningService;
  readonly businessEvents: BusinessEventService;
  /** Canonical department memory store (Sprint 60). */
  readonly memoryStore: InMemoryMemoryRecordStore;
  readonly departmentMemory?: DepartmentMemoryStore;
  /** The session's Tool Runtime (Sprint 62 capability engine source). */
  readonly runtime: ToolRuntime;
  /** Canonical department capability registry (Sprint 62). */
  readonly capabilities: DepartmentCapabilityRegistry;
  /** Durable organization tool/connection state (Phase P-B). */
  readonly toolState: ToolStateStore;
  /** Durable organization-scoped conversations (Phase P-B part 15). */
  readonly conversations: ConversationStore;
  state: CustomerZeroSessionState;
  reports: readonly CompanyDiscoveryReport[];
}

const sessions = new Map<string, CustomerZeroSession>();

export interface CustomerZeroSessionOptions {
  readonly llm?: LlmRuntime;
  readonly locale?: SupportedLocale;
  /** Durable tool/connection store (Supabase in production). */
  readonly toolState?: ToolStateStore;
  /** Durable conversation store (Supabase in production). */
  readonly conversations?: ConversationStore;
  readonly departmentMemory?: DepartmentMemoryStore;
}

/**
 * Returns the persisted session for an organization, creating it on first
 * use with a real composed runtime. Tests may inject a fake LLM runtime.
 */
export function getOrCreateCustomerZeroSession(
  organizationId: string,
  options: CustomerZeroSessionOptions = {},
): CustomerZeroSession {
  const existing = sessions.get(organizationId);
  if (existing) {
    return existing;
  }

  const llm = options.llm ?? buildLlmRuntime();

  // Discovery report persistence (in-memory for the local slice).
  const reportRepository = createInMemoryDiscoveryReportRepository();

  // Core Tool Catalog wired to the discovery repository and the real LLM
  // Router (registers `marketing.chat` for the conversation step).
  const toolRegistry = new ToolRuntimeRegistry();
  registerAllCoreTools(toolRegistry, {
    discoveryRepository: reportRepository,
    llmRouter: llm.router,
    runtime: {
      name: "departify-backend",
      version: "0.0.0",
      environment: process.env.NODE_ENV ?? "development",
    },
  });

  // Tool Runtime with the catalog's tools registered.
  // Sprint 61: process isolation so network-capable tools (Mautic) can execute.
  const runtime = createToolRuntime({
    grantedScopes: ["read.public", "read.private", "execute.network"],
    isolationLevel: "process",
  });
  for (const entry of toolRegistry.list()) {
    runtime.registry.register(entry.definition);
    runtime.registry.setStatus(entry.definition.id, "active");
  }

  // Sprint 61 — Mautic connector tools (read-only, network-capable).
  for (const def of [
    createMauticTestConnectionToolDefinition(),
    createMauticContactCountToolDefinition(),
    createMauticContactSearchToolDefinition(),
  ]) {
    if (!runtime.registry.has(def.id)) {
      runtime.registry.register(def);
      runtime.registry.setStatus(def.id, "active");
    }
  }

  // Sprint 62 — canonical capability registry for the Marketing department.
  // The Mautic capability is registered; its operational status is DERIVED by
  // the registry from the connection state + Tool Runtime (never from memory).
  const capabilities = new DepartmentCapabilityRegistry();
  capabilities.register(buildMauticCapability());

  // AgentToolBridge with the Marketing agents' permissions.
  const port: AgentToolPort = new AgentToolRuntimeAdapter({
    runtime,
    fetchPermissionSet: buildAgentPermissionSetResolver(
      new Map([
        ["agent.executive", [manageRuntimeScope]],
        [ONBOARDING_DIRECTOR_AGENT_ID, [manageRuntimeScope]],
        [ONBOARDING_EMPLOYEE_AGENT_ID, [manageRuntimeScope]],
      ]),
    ),
  });

  // Executive orchestration: discovery.analyze dispatch.
  const orchestrator = createExecutiveOrchestrator({
    director: new ExecutiveDirector(),
    bridge: port,
  });

  // Executive Discovery Workflow — produces the Company DNA report.
  const discoveryWorkflow = createExecutiveDiscoveryWorkflow({
    discoveryService: new BusinessDiscoveryService(),
    orchestrator,
    reportRepository,
  });

  // Workflow executor — runs the Department Onboarding steps.
  const executor = new WorkflowExecution({ port });

  // Real provisioning: Marketing department from its template.
  const departmentService = createDepartmentService();
  const templateCatalog = createDepartmentTemplateCatalog();
  templateCatalog.register(buildMarketingTemplate());
  const provisioning = new BusinessProvisioningService({
    catalog: templateCatalog,
    departmentService,
    defaultTemplateId: MARKETING_TEMPLATE_ID,
  });

  // Canonical business event catalog with the Marketing Customer Zero ports.
  const { catalog } = buildCanonicalCatalog({
    port,
    workflowExecutor: executor,
    discoveryWorkflow,
    onboardingDirectorAgentId: ONBOARDING_DIRECTOR_AGENT_ID,
    onboardingEmployeeAgentId: ONBOARDING_EMPLOYEE_AGENT_ID,
    organizationCreator: async (event) => ({
      status: "completed",
      output: { organizationId: event.organizationId },
      errors: [],
      provisioningId: provisioningIdFor(assertOrganizationId(event.organizationId)),
    }),
    provisioningHandler: async (event) => {
      if (
        event.type !== "payment.confirmed" &&
        event.type !== "organization.provisioned"
      ) {
        return {
          status: "rejected",
          output: null,
          errors: [
            {
              code: "wrong_type",
              message: "wrong event",
              phase: "delegation",
            },
          ],
        };
      }
      const provisioningId =
        event.type === "organization.provisioned"
          ? event.provisioningId
          : provisioningIdFor(event.organizationId);
      const result = provisioning.instantiateBusiness(
        provisioningId,
        event.organizationId,
        "wsp_marketing_primary",
        {
          requestedBy: "platform",
          organizationName: "Customer Zero",
          business: { departmentTemplateId: MARKETING_TEMPLATE_ID },
        },
      );
      return {
        status: "completed",
        output: result,
        errors: result.issues.map((issue) => ({
          code: issue.code,
          message: issue.message,
          phase: "execution" as const,
        })),
        provisioningId,
      };
    },
  });

  const session: CustomerZeroSession = {
    organizationId,
    llm,
    reportRepository,
    departmentService,
    discoveryWorkflow,
    executor,
    port,
    provisioning,
    businessEvents: new BusinessEventService({ catalog }),
    memoryStore: createInMemoryMemoryRecordStore(),
    ...(options.departmentMemory ? { departmentMemory: options.departmentMemory } : {}),
    runtime,
    capabilities,
    toolState: options.toolState ?? new InMemoryToolStateStore(),
    conversations: options.conversations ?? new InMemoryConversationStore(),
    state: {
      organizationId,
      rawData: {},
      conversation: [],
      locale: options.locale ?? "es",
      discovery: createConversationState(),
      discoveryTranscript: [],
      connections: new Map(),
      unmappedTools: [],
    },
    reports: [],
  };

  sessions.set(organizationId, session);
  return session;
}

/**
 * Returns the DiscoveryReportRepository of an existing Customer Zero session,
 * or null when the session has not been created yet.
 */
export function getCustomerZeroReportRepository(
  organizationId: string,
): DiscoveryReportRepository | null {
  return sessions.get(organizationId)?.reportRepository ?? null;
}

export function getCustomerZeroSession(
  organizationId: string,
): CustomerZeroSession | null {
  return sessions.get(organizationId) ?? null;
}

export function listCustomerZeroSessions(): readonly string[] {
  return [...sessions.keys()];
}

/** Test support: clears the in-process session registry (simulates a restart). */
export function resetCustomerZeroSessionsForTest(): void {
  sessions.clear();
}

/**
 * Loads the organization's durable tool/connection state into the session.
 * Customer Zero bootstrap: when the required MAUTIC_* env configuration exists
 * but the org has no durable Mautic record yet, Mautic is represented as
 * CONFIGURED (never CONNECTED — verification is separate).
 */
export async function hydrateSessionToolState(
  session: CustomerZeroSession,
): Promise<void> {
  // The session cache is only a projection. Re-read durable evidence on
  // every hydration so a refresh, login, or callback cannot leave a stale
  // connected state in memory.
  const records = await session.toolState.listForOrg(session.organizationId);
  session.state.toolHydrated = true;

  if (!records.some((record) => record.toolId === "mautic")) {
    const bootstrap = buildMauticBootstrapRecord(session.organizationId);
    if (bootstrap) {
      await session.toolState.upsert(bootstrap);
      records.push(bootstrap);
    }
  }

  for (const record of records) {
    if (session.state.connections.has(record.toolId)) continue;
    const tool = TOOL_CATALOG.find((entry) => entry.id === record.toolId);
    const connection = tool
      ? buildConnectionStateWithLifecycle(tool, session.state.locale, record.status, {
          ...(record.configSource ? { configSource: record.configSource } : {}),
          ...(record.verifiedAt ? { verifiedAt: record.verifiedAt } : {}),
        })
      : buildFallbackConnection(record);
    session.state.connections.set(record.toolId, connection);
  }

  // P0 — single source of truth reconciliation. If a durable Google
  // OAuth token row exists for this org (refresh token persisted +
  // operational probe verified), but the durable organization_tool_states
  // row is missing or stale, we synthesize a `connected` state for the
  // affected Google tools here. This keeps /conexiones cards and chat
  // capability answers perfectly aligned with the durable Google token
  // store — no more "Connected in chat but Not Connected in card".
  await reconcileGoogleConnectionsFromDurableTokens(session, records);
}

/**
 * For each Google tool (gmail, google_workspace, google_calendar,
 * google_drive) check whether the durable Google token store reports
 * an operational refresh-token row for this org. If yes, upsert a
 * `connected` row into organization_tool_states and add the matching
 * ConnectionState to the in-memory session. Idempotent: an existing
 * `connected` record is left untouched; a `needs_connection` /
 * `blocked` record is upgraded to `connected`.
 */
async function reconcileGoogleConnectionsFromDurableTokens(
  session: CustomerZeroSession,
  existingRecords: OrganizationToolState[],
): Promise<void> {
  const summaries = await getGoogleTokenStore().listForOrg(session.organizationId);
  const capabilityByTool: Readonly<Record<string, GoogleCapability>> = {
    gmail: "email.read",
    google_calendar: "calendar.read",
    google_workspace: "drive.read",
    google_drive: "drive.read",
  };
  const googleToolIds = Object.keys(capabilityByTool);
  for (const toolId of googleToolIds) {
    const existing = existingRecords.find((r) => r.toolId === toolId);
    const capability = capabilityByTool[toolId];
    if (!capability) continue;
    // An OAuth handshake is an intentional transient state. Do not let a
    // background capability reconciliation erase it before the callback has
    // had a chance to validate its nonce.
    if (session.state.connections.get(toolId)?.status === "connecting") continue;
    if (!summaries.length && !existing) continue;
    const operational = summaries.some(
      (summary) =>
        summary.hasRefreshToken &&
        Boolean(summary.operationalVerifiedAt) &&
        hasOperationalGoogleCapability(summary, capability),
    );
    const status: OrganizationToolState["status"] = operational
      ? "connected"
      : "needs_connection";
    const tool = TOOL_CATALOG.find((entry) => entry.id === toolId);
    const label = tool?.label ?? toolId;
    const record: OrganizationToolState = {
      organizationId: session.organizationId,
      toolId,
      label,
      ...(tool?.capability ? { capability: tool.capability } : {}),
      declared: true,
      status,
      configSource: "oauth:google",
      ...(operational
        ? (() => {
            const verifiedAt = summaries.find((s) =>
              hasOperationalGoogleCapability(s, capability),
            )?.operationalVerifiedAt;
            return verifiedAt ? { verifiedAt } : {};
          })()
        : {}),
      health: operational ? "operational" : "down",
    };
    try {
      await session.toolState.upsert(record);
    } catch {
      // If the durable tool-state store is unavailable, still patch
      // the in-memory session so the chat surface and the
      // /conexiones view agree for the rest of this request.
    }
    if (tool) {
      const connection = buildConnectionStateWithLifecycle(
        tool,
        session.state.locale,
        status,
        {
          configSource: "oauth:google",
          ...(record.verifiedAt ? { verifiedAt: record.verifiedAt } : {}),
        },
      );
      session.state.connections.set(toolId, connection);
    }
  }
}

/** Persists a declaration/connection update to the durable store. */
export async function persistToolState(
  session: CustomerZeroSession,
  state: OrganizationToolState,
): Promise<void> {
  await session.toolState.upsert(state);
}

/** Builds the CONFIGURED Mautic bootstrap record from Railway env, if present. */
export function buildMauticBootstrapRecord(
  organizationId: string,
): OrganizationToolState | null {
  if (!resolveMauticCredentials()) return null;
  const tool = TOOL_CATALOG.find((entry) => entry.id === "mautic");
  return {
    organizationId,
    toolId: "mautic",
    label: tool?.label ?? "Mautic",
    ...(tool?.capability ? { capability: tool.capability } : {}),
    declared: true,
    status: "configured",
    configSource: "env:mautic",
  };
}

function buildFallbackConnection(
  record: OrganizationToolState,
): ConnectionState {
  return {
    toolId: record.toolId,
    label: record.label,
    capability: record.capability ?? "unknown",
    category: "Herramientas",
    status: lifecycleToConnectionStatus(record.status),
    lifecycle: record.status,
    ...(record.configSource ? { configSource: record.configSource } : {}),
    ...(record.verifiedAt ? { verifiedAt: record.verifiedAt } : {}),
  };
}

export type { ToolLifecycleStatus };

/**
 * Runs the Executive Discovery Workflow with the session's real rawData and
 * returns the typed report (Company DNA + gaps + questions).
 */
export async function runDiscoveryForSession(
  session: CustomerZeroSession,
  extraRawData?: Readonly<Record<string, unknown>>,
): Promise<CompanyDiscoveryReport> {
  const mergedRawData = extraRawData
    ? { ...session.state.rawData, ...extraRawData }
    : session.state.rawData;
  const result = await session.discoveryWorkflow.run({
    organizationId: session.organizationId,
    requestedBy: "system",
    options: {
      includeFounderBrain: true,
      includeCompetitorAnalysis: false,
      includeMarketAnalysis: false,
      depth: "standard",
    },
    ...(Object.keys(mergedRawData).length > 0
      ? { rawData: mergedRawData }
      : {}),
  });

  if (result.status !== "completed" || !result.report) {
    throw new Error(
      result.error?.message ?? "Discovery did not complete.",
    );
  }

  session.reports = [...session.reports, result.report];
  return result.report;
}

/**
 * Publishes the simulated payment and runs the whole existing chain
 * (provisioning tpl_marketing → discovery → onboarding → first result) on the
 * session's real runtime.
 */
export async function runMarketingPreparationForSession(
  session: CustomerZeroSession,
): Promise<{ result: BusinessEventResult; workflowResult: WorkflowResult | null }> {
  const event = buildSimulatedPaymentEvent(session);
  const result = await session.businessEvents.publish(event);

  if (result.status !== "completed" || !result.output) {
    return { result, workflowResult: null };
  }

  const output = result.output as { onboarding?: WorkflowResult };
  return { result, workflowResult: output.onboarding ?? null };
}

/**
 * Runs the `marketing.plan` tool as the Marketing Director through the real
 * runtime and stores the structured work plan in the session.
 */
export async function runMarketingPlanForSession(
  session: CustomerZeroSession,
  goal: string,
): Promise<{ summary: string; items: readonly { id: string; title: string; description: string; kind: string; capability?: string }[] }> {
  const outcome = await session.port.executeAction({
    actionId: `act_plan_${shortId()}`,
    agentId: "agent_marketing_director",
    organizationId: session.organizationId,
    toolId: "marketing.plan",
    args: {
      organizationId: session.organizationId,
      goal,
      locale: session.state.locale,
      extraContext: buildSessionExtraContext(session),
    },
  });

  if (outcome.status !== "completed") {
    throw new Error(
      outcome.status === "rejected"
        ? outcome.reason
        : outcome.error?.message ?? "Marketing could not create a plan.",
    );
  }

  const output = outcome.output as { summary?: string; items?: unknown[] } | undefined;
  const items = (output?.items ?? []).map((raw, index) => {
    const item = raw as { id?: string; title?: string; description?: string; kind?: string; capability?: string };
    const kind =
      item.kind === "external_action" || item.kind === "creation"
        ? item.kind
        : "analysis";
    return {
      id: item.id ?? `item_${index + 1}`,
      title: item.title ?? "Trabajo de Marketing",
      description: item.description ?? "",
      kind,
      ...(item.capability ? { capability: item.capability } : {}),
    };
  });

  const workItems: MarketingWorkItemState[] = items.map((item) => ({
    id: item.id,
    title: item.title,
    description: item.description,
    kind: item.kind as MarketingWorkItemState["kind"],
    ...(item.capability ? { capability: item.capability } : {}),
    // External actions are gated behind CEO approval.
    status: item.kind === "external_action" ? "needs_approval" : "pending",
  }));

  session.state.marketingWork = {
    goal,
    summary: output?.summary ?? "",
    items: workItems,
  };

  return {
    summary: output?.summary ?? "",
    items,
  };
}

/**
 * Runs the `marketing.execute` tool for one work item as the Marketing
 * Director, storing the real deliverable and updating the item status.
 */
export async function executeMarketingWorkItemForSession(
  session: CustomerZeroSession,
  itemId: string,
): Promise<string> {
  const work = session.state.marketingWork;
  const item = work?.items.find((i) => i.id === itemId);
  if (!work || !item) {
    throw new Error(`Work item '${itemId}' not found.`);
  }
  if (item.status === "needs_approval") {
    throw new Error("This work item requires CEO approval before execution.");
  }

  const outcome = await session.port.executeAction({
    actionId: `act_exec_${shortId()}`,
    agentId: "agent_marketing_director",
    organizationId: session.organizationId,
    toolId: "marketing.execute",
    args: {
      organizationId: session.organizationId,
      locale: session.state.locale,
      extraContext: buildSessionExtraContext(session),
      item: {
        id: item.id,
        title: item.title,
        description: item.description,
        kind: item.kind,
        ...(item.capability ? { capability: item.capability } : {}),
      },
    },
  });

  if (outcome.status !== "completed") {
    item.status = "failed";
    return outcome.status === "rejected"
      ? outcome.reason
      : outcome.error?.message ?? "Marketing could not execute this item.";
  }

  const output = outcome.output as { result?: string } | undefined;
  item.status = "completed";
  item.result = output?.result ?? "";
  return item.result;
}

/**
 * Approves a gated work item (external action). After approval the item is
 * marked `approved`; if the underlying capability is not connected, its
 * status becomes `unavailable` so the CEO sees an honest state.
 */
export function approveMarketingWorkItemForSession(
  session: CustomerZeroSession,
  itemId: string,
): MarketingWorkItemState {
  const work = session.state.marketingWork;
  const item = work?.items.find((i) => i.id === itemId);
  if (!work || !item) {
    throw new Error(`Work item '${itemId}' not found.`);
  }
  if (item.status !== "needs_approval" && item.status !== "approved") {
    throw new Error("Only gated work items require approval.");
  }

  item.status = "approved";
  // Honest availability, told the way a department head would tell it: the
  // work is approved, but nobody can act outside the company until the
  // right tool is connected. No capability ids, no runtime vocabulary.
  const english = session.state.locale === "en";
  item.result = english
    ? "Approved. I cannot carry this out yet: it needs a tool of yours " +
      "connected so my team can act outside the company. You can connect " +
      "it in Connections and I will pick it up from there."
    : "Aprobado. Todavía no puedo llevarlo a cabo: necesito una de tus " +
      "herramientas conectada para que mi equipo pueda actuar fuera de la " +
      "empresa. Puedes conectarla en Conexiones y yo sigo desde ahí.";
  item.status = "unavailable";
  return item;
}

/**
 * The real extra context Marketing receives: the CEO's initial goal from the
 * onboarding, the answers of the progressive discovery conversation, the
 * tools the company uses and which of them are really connected.
 */
export function buildSessionExtraContext(session: CustomerZeroSession): string {
  const parts: string[] = [];
  const onboarding = session.state.onboarding;
  if (onboarding) {
    parts.push(`Empresa: ${onboarding.companyName}`);
    if (onboarding.country) parts.push(`País principal: ${onboarding.country}`);
    if (onboarding.companySize) parts.push(`Tamaño: ${onboarding.companySize}`);
    if (onboarding.description) {
      parts.push(`Lo que está creando: ${onboarding.description}`);
    }
    if (onboarding.goal) {
      parts.push(`Objetivo inicial del CEO: ${onboarding.goal}`);
    }
  }
  for (const turn of session.state.discoveryTranscript) {
    parts.push(`${turn.question} → ${turn.answer}`);
  }
  const connections = [...session.state.connections.values()];
  if (connections.length > 0) {
    parts.push(
      `Herramientas de la empresa: ${connections
        .map((connection) => `${connection.label} (${connection.status})`)
        .join(", ")}`,
    );
    const connected = connections.filter((c) => c.status === "connected");
    parts.push(
      connected.length > 0
        ? `Capacidades conectadas y usables: ${connected
            .map((c) => c.capability)
            .join(", ")}`
        : "Todavía no hay ninguna herramienta externa conectada: no puedes " +
          "ejecutar acciones externas, dilo con honestidad.",
    );
  }
  if (session.state.unmappedTools.length > 0) {
    parts.push(
      `Herramientas mencionadas sin conector disponible: ${session.state.unmappedTools.join(", ")}`,
    );
  }
  return parts.join("\\n");
}

function mostRecentReport(session: {
  reports: readonly CompanyDiscoveryReport[];
}): CompanyDiscoveryReport | null {
  const reports = [...session.reports].sort(
    (a, b) => b.generatedAt.getTime() - a.generatedAt.getTime(),
  );
  return reports[0] ?? null;
}

/**
 * Produces Elvira's marketing diagnosis from the session's accumulated
 * knowledge: the Company DNA, onboarding data, discovered facts, CEO's
 * answers, and connected tools. Deterministic — no AI needed.
 */
export function produceDiagnosisForSession(
  session: CustomerZeroSession,
): MarketingDiagnosis {
  const onboarding = session.state.onboarding;
  const report = mostRecentReport(session);

  const products: { name: string; description?: string }[] = [];
  if (report?.companyDna.products) {
    for (const p of report.companyDna.products) {
      products.push({
        name: typeof p.name === "string" ? p.name : String(p),
        ...(typeof p.description === "string"
          ? { description: p.description }
          : {}),
      });
    }
  }

  const connectedTools = [...session.state.connections.values()]
    .filter((c) => c.status === "connected")
    .map((c) => c.toolId);

  const declaredTools = [...session.state.connections.keys()];

  return produceMarketingDiagnosis(
    {
      companyName: onboarding?.companyName ?? session.state.companyName ?? "Tu empresa",
      goal: onboarding?.goal ?? "",
      locale: session.state.locale,
      ...(onboarding?.country ? { country: onboarding.country } : {}),
      ...(onboarding?.companySize ? { companySize: onboarding.companySize } : {}),
      hasWebsite: onboarding?.hasWebsite ?? false,
      ...(onboarding?.description ? { description: onboarding.description } : {}),
      ...(products.length > 0 ? { products } : {}),
      connectedTools,
      declaredTools,
      unmappedTools: session.state.unmappedTools,
      discoveryGaps: report?.gaps.map((g: { description: string }) => g.description) ?? [],
    },
    report,
  );
}

/**
 * Forms Elvira's team based on the diagnosis. Which specialists are needed
 * depends on the CEO's goal and the business context — never hardcoded.
 */
export function produceTeamForSession(
  session: CustomerZeroSession,
  diagnosis: MarketingDiagnosis,
): TeamFormationResult {
  const connectedTools = [...session.state.connections.values()]
    .filter((c) => c.status === "connected")
    .map((c) => c.toolId);

  return formTeam(
    diagnosis.goal,
    diagnosis.neededSpecialistRoles,
    session.state.locale,
    connectedTools,
  );
}

function buildSimulatedPaymentEvent(
  session: CustomerZeroSession,
): BusinessEvent {
  return {
    eventId: `evt_${shortId()}`,
    type: "payment.confirmed",
    occurredAt: new Date(),
    paymentId: `pay_sim_${shortId()}`,
    organizationId: session.organizationId,
    planId: PLAN_ID,
    customerEmail: "ceo@customer-zero.local",
    payload: {
      companyName: session.state.companyName ?? "Customer Zero",
      rawData: session.state.rawData,
    },
  };
}

const manageRuntimeScope = {
  scope: "runtime" as const,
  action: "manage" as const,
  resource: "*",
};

function provisioningIdFor(organizationId: string): string {
  return `prv_${slugify(organizationId)}_${shortId()}`;
}

function assertOrganizationId(organizationId: string | undefined): string {
  if (!organizationId) {
    throw new Error("payment.confirmed requires an organizationId.");
  }
  return organizationId;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return slug.length > 0 ? slug : "company";
}

function shortId(): string {
  return randomUUID().slice(0, 8);
}
