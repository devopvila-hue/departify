/**
 * Customer Zero composition — the host-side wiring that turns the existing
 * pipeline into a runnable vertical slice (Sprint 56).
 *
 * This module is an ADAPTER / ENTRY POINT. It composes the existing public
 * packages exactly as the validated Marketing Customer Zero smoke test does:
 *
 *   payment.confirmed
 *     → organization created (payment simulation)
 *     → provisioning (tpl_marketing)
 *     → discovery with real rawData
 *     → Marketing Department Onboarding
 *     → first result
 *
 * No domain logic lives here. Every phase is delegated to the existing
 * runtimes; the composition only wires them together and maps the typed
 * result back to a product-facing shape.
 */
import {
  AgentToolRuntimeAdapter,
  buildAgentPermissionSetResolver,
  type AgentToolPort,
} from "@departify/agent-tool-bridge";
import {
  BusinessDiscoveryService,
  createInMemoryDiscoveryReportRepository,
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
} from "@departify/departments";
import { ExecutiveDirector } from "@departify/executive-director";
import {
  createExecutiveDiscoveryWorkflow,
  createExecutiveOrchestrator,
} from "@departify/executive-orchestrator";
import { BusinessProvisioningService } from "@departify/platform-composition";
import { registerAllCoreTools } from "@departify/tool-catalog";
import {
  createToolRuntime,
  ToolRegistry as ToolRuntimeRegistry,
} from "@departify/tool-runtime";
import { WorkflowExecution } from "@departify/workflows";
import { randomUUID } from "node:crypto";

/**
 * Product-facing input for the Customer Zero marketing slice. Only real
 * company information and the company identifier are required — the payment
 * is simulated by the host, never by the domain.
 */
export interface CustomerZeroMarketingInput {
  readonly companyName: string;
  /** Real company information that feeds `rawData` (Sprint 55). */
  readonly rawData: Readonly<Record<string, unknown>>;
}

/**
 * The CEO-facing result of running the Marketing department. Uses business
 * language, not runtime terminology.
 */
export interface CustomerZeroMarketingResult {
  readonly status: "completed" | "failed";
  readonly organizationId: string;
  readonly companyName: string;
  readonly department: "Marketing";
  readonly firstResult:
    | {
        readonly confidence: string;
        readonly gapCount: number;
        readonly criticalGapCount: number;
        readonly blockingGapCount: number;
        readonly questionCount: number;
      }
    | null;
  readonly errors: readonly { readonly code: string; readonly message: string }[];
  readonly runId: string;
}

const ONBOARDING_DIRECTOR_AGENT_ID = "agent_marketing_director";
const ONBOARDING_EMPLOYEE_AGENT_ID = "agent_content_strategist";
const MARKETING_TEMPLATE_ID = "tpl_marketing";
const PLAN_ID = "plan_marketing";

/**
 * Runs the Marketing Customer Zero slice from the CEO's real company input.
 * Publishes the single `payment.confirmed` event and returns the first result
 * produced by the pipeline.
 */
export async function runMarketingCustomerZero(
  input: CustomerZeroMarketingInput,
): Promise<CustomerZeroMarketingResult> {
  const organizationId = `org_${slugify(input.companyName)}_${shortId()}`;
  const runId = `run_${shortId()}`;

  const service = buildCustomerZeroService();
  const payment = buildSimulatedPaymentEvent({
    organizationId,
    runId,
    companyName: input.companyName,
    rawData: input.rawData,
  });

  const result: BusinessEventResult = await service.publish(payment);

  if (result.status !== "completed" || !result.output) {
    return {
      status: "failed",
      organizationId,
      companyName: input.companyName,
      department: "Marketing",
      firstResult: null,
      errors: result.errors.map((error) => ({
        code: error.code,
        message: error.message,
      })),
      runId,
    };
  }

  const summary = extractFirstResult(result.output);

  return {
    status: "completed",
    organizationId,
    companyName: input.companyName,
    department: "Marketing",
    firstResult: summary,
    errors: result.errors.map((error) => ({
      code: error.code,
      message: error.message,
    })),
    runId,
  };
}

/**
 * Builds the host composition that makes the existing pipeline runnable.
 * Mirrors the validated Marketing Customer Zero smoke test wiring.
 */
function buildCustomerZeroService(): BusinessEventService {
  // Discovery report persistence (in-memory for the local slice).
  const reportRepository = createInMemoryDiscoveryReportRepository();

  // Core Tool Catalog wired to the discovery repository.
  const toolRegistry = new ToolRuntimeRegistry();
  registerAllCoreTools(toolRegistry, { discoveryRepository: reportRepository });

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
  const realProvisioning = new BusinessProvisioningService({
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
      const provisioning = realProvisioning.instantiateBusiness(
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
        output: provisioning,
        errors: provisioning.issues.map((issue) => ({
          code: issue.code,
          message: issue.message,
          phase: "execution" as const,
        })),
        provisioningId,
      };
    },
  });

  return new BusinessEventService({ catalog });
}

/**
 * Simulates the external payment event with the exact same shape Stripe would
 * emit. The payment stays simulated for the local Customer Zero slice.
 */
function buildSimulatedPaymentEvent(options: {
  organizationId: string;
  runId: string;
  companyName: string;
  rawData: Readonly<Record<string, unknown>>;
}): BusinessEvent {
  return {
    eventId: `evt_${options.runId}`,
    type: "payment.confirmed",
    occurredAt: new Date(),
    paymentId: `pay_sim_${options.runId}`,
    organizationId: options.organizationId,
    planId: PLAN_ID,
    customerEmail: "ceo@customer-zero.local",
    payload: {
      companyName: options.companyName,
      rawData: options.rawData,
    },
  };
}

/**
 * Extracts the first result produced by the pipeline: the Department
 * Onboarding final output (the Marketing employee's executive summary).
 */
function extractFirstResult(output: unknown): CustomerZeroMarketingResult["firstResult"] {
  if (typeof output !== "object" || output === null) {
    return null;
  }
  const candidate = output as Record<string, unknown>;
  const onboarding = candidate.onboarding as
    | { finalOutput?: unknown }
    | undefined;
  if (!onboarding || typeof onboarding !== "object") {
    return null;
  }
  const finalOutput = onboarding.finalOutput as
    | {
        overallConfidence?: string;
        gapCount?: number;
        criticalGapCount?: number;
        blockingGapCount?: number;
        questionCount?: number;
      }
    | undefined;
  if (!finalOutput || typeof finalOutput !== "object") {
    return null;
  }
  return {
    confidence: finalOutput.overallConfidence ?? "unknown",
    gapCount: finalOutput.gapCount ?? 0,
    criticalGapCount: finalOutput.criticalGapCount ?? 0,
    blockingGapCount: finalOutput.blockingGapCount ?? 0,
    questionCount: finalOutput.questionCount ?? 0,
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

function assertOrganizationId(
  organizationId: string | undefined,
): string {
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
