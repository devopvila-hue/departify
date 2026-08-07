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
  createToolRuntime,
  ToolRegistry as ToolRuntimeRegistry,
} from "@departify/tool-runtime";
import {
  WorkflowExecution,
  type WorkflowResult,
} from "@departify/workflows";
import { randomUUID } from "node:crypto";
import { buildLlmRuntime, type LlmRuntime } from "./llm-runtime.js";

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
  state: CustomerZeroSessionState;
  reports: readonly CompanyDiscoveryReport[];
}

const sessions = new Map<string, CustomerZeroSession>();

export interface CustomerZeroSessionOptions {
  readonly llm?: LlmRuntime;
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
  const runtime = createToolRuntime({
    grantedScopes: ["read.public", "read.private"],
  });
  for (const entry of toolRegistry.list()) {
    runtime.registry.register(entry.definition);
    runtime.registry.setStatus(entry.definition.id, "active");
  }

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
    state: {
      organizationId,
      rawData: {},
      conversation: [],
    },
    reports: [],
  };

  sessions.set(organizationId, session);
  return session;
}

export function getCustomerZeroSession(
  organizationId: string,
): CustomerZeroSession | null {
  return sessions.get(organizationId) ?? null;
}

export function listCustomerZeroSessions(): readonly string[] {
  return [...sessions.keys()];
}

/**
 * Runs the Executive Discovery Workflow with the session's real rawData and
 * returns the typed report (Company DNA + gaps + questions).
 */
export async function runDiscoveryForSession(
  session: CustomerZeroSession,
): Promise<CompanyDiscoveryReport> {
  const result = await session.discoveryWorkflow.run({
    organizationId: session.organizationId,
    requestedBy: "system",
    options: {
      includeFounderBrain: true,
      includeCompetitorAnalysis: false,
      includeMarketAnalysis: false,
      depth: "standard",
    },
    ...(Object.keys(session.state.rawData).length > 0
      ? { rawData: session.state.rawData }
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
