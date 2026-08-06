import type { AgentToolPort } from "@departify/agent-tool-bridge";
import type { DepartmentService } from "@departify/departments";
import {
  ExecutiveDiscoveryWorkflow,
  type ExecutiveDiscoveryWorkflowResult,
} from "@departify/executive-orchestrator";
import {
  buildLeadQualificationWorkflow,
  type WorkflowExecution,
  type WorkflowResult,
} from "@departify/workflows";
import type { BusinessEvent } from "../contracts/business-event-types.js";
import type {
  BusinessEventError,
  BusinessEventResult,
} from "../contracts/business-event-result.js";

/**
 * BusinessEventCatalog — the **only authorised source** for event →
 * handler mapping. Hosts register handlers through `register(type, handler)`
 * or rely on the default catalog which ships the three Sprint 27 events.
 *
 * The catalog never executes business logic itself. Each handler delegates
 * to one of the existing runtimes:
 *  - WorkflowExecution (Sprint 26)
 *  - BusinessProvisioningService (Sprint 25)
 *  - ExecutiveOrchestrator (Sprint 23)
 *
 * No reflection, no dynamic discovery.
 */

export type BusinessEventPhase =
  "validation" | "catalog" | "delegation" | "execution";

export type BusinessEventHandler = (
  event: BusinessEvent,
  context: BusinessEventHandlerContext,
) => Promise<BusinessEventHandlerOutcome>;

export interface BusinessEventHandlerContext {
  readonly now: () => Date;
  readonly eventId: () => string;
  readonly workflowId: () => string;
  readonly executionId: () => string;
}

export interface BusinessEventHandlerOutcome {
  readonly status: BusinessEventResult["status"];
  readonly output: unknown;
  readonly errors: readonly BusinessEventError[];
  readonly workflowId?: string;
  readonly executionId?: string;
  readonly provisioningId?: string;
}

/**
 * Host-supplied reaction to the `organization.discovered` fact event. The
 * catalog never executes business logic; hosts decide what to do once an
 * organization has been discovered (e.g. prepare its Empresa Digital).
 */
export type DiscoveryCompletionHandler = (
  event: BusinessEvent,
) => Promise<BusinessEventHandlerOutcome>;

export const DEFAULT_LEAD_QUALIFICATION_WORKFLOW_ID = "wf_lead_qualification";

/**
 * Default catalog handler factory. Returns the handlers wired to
 * the existing runtimes.
 */
export function buildDefaultCatalogHandlers(options: {
  port: AgentToolPort;
  workflowExecutor: WorkflowExecution;
  // The provisioning handler is optional — hosts that don't yet ship
  // business provisioning can supply a no-op handler instead.
  provisioningHandler?: (
    event: BusinessEvent,
  ) => Promise<BusinessEventHandlerOutcome>;
  // The discovery workflow is optional — hosts that don't wire the
  // Executive Discovery Workflow (Sprint 31) get a controlled rejection.
  discoveryWorkflow?: ExecutiveDiscoveryWorkflow;
  // The discovery completion handler is optional — hosts that don't react
  // to the `organization.discovered` fact get a controlled rejection.
  discoveryCompletionHandler?: DiscoveryCompletionHandler;
  // The Department service is optional — when no `discoveryCompletionHandler`
  // is supplied, the catalog associates the discovery to the organization's
  // non-archived Departments (Sprint 34 capability). Without either, the
  // event is rejected in a controlled way.
  departmentService?: DepartmentService;
}): {
  readonly "lead.created": BusinessEventHandler;
  readonly "organization.created": BusinessEventHandler;
  readonly "organization.provisioned": BusinessEventHandler;
  readonly "organization.discovery_requested": BusinessEventHandler;
  readonly "organization.discovered": BusinessEventHandler;
} {
  return {
    "lead.created": createLeadCreatedHandler(options),
    "organization.created": createOrganizationCreatedHandler(
      options.provisioningHandler,
    ),
    "organization.provisioned": createOrganizationProvisionedHandler(
      options.provisioningHandler,
    ),
    "organization.discovery_requested": createOrganizationDiscoveryRequestedHandler(
      options.discoveryWorkflow,
    ),
    "organization.discovered": createOrganizationDiscoveredHandler(
      options.discoveryCompletionHandler,
      options.departmentService,
    ),
  };
}

function createLeadCreatedHandler(options: {
  workflowExecutor: WorkflowExecution;
}): BusinessEventHandler {
  return async (event) => {
    if (event.type !== "lead.created") {
      return rejected("lead.created handler invoked for non lead event");
    }
    const workflow = buildLeadQualificationWorkflow();
    const result: WorkflowResult = await options.workflowExecutor.run(workflow);
    return {
      status: result.status === "completed" ? "completed" : "failed",
      output: result,
      errors: result.error
        ? [
            {
              code: result.error.code,
              message: result.error.message,
              phase: "execution",
            },
          ]
        : [],
      workflowId: workflow.id,
      executionId: result.executionId,
    };
  };
}

function createOrganizationCreatedHandler(
  provisioningHandler:
    | ((event: BusinessEvent) => Promise<BusinessEventHandlerOutcome>)
    | undefined,
): BusinessEventHandler {
  return async (event) => {
    if (!provisioningHandler) {
      return rejected(
        "organization.created requires a provisioning handler. No provisioning handler was supplied to the catalog.",
      );
    }
    return provisioningHandler(event);
  };
}

function createOrganizationProvisionedHandler(
  provisioningHandler:
    | ((event: BusinessEvent) => Promise<BusinessEventHandlerOutcome>)
    | undefined,
): BusinessEventHandler {
  return async (event) => {
    if (!provisioningHandler) {
      return rejected(
        "organization.provisioned requires a provisioning handler. No provisioning handler was supplied to the catalog.",
      );
    }
    return provisioningHandler(event);
  };
}

/**
 * Handler for `organization.discovery_requested`. Delegates to the existing
 * `ExecutiveDiscoveryWorkflow` (Sprint 31) — the first official Executive
 * workflow — which composes Business Discovery initiation (Sprint 28) with
 * the official `discovery.analyze` dispatch (Sprint 30). The workflow is
 * injected by the host; without it the event is rejected in a controlled
 * way. No business logic lives here.
 */
function createOrganizationDiscoveryRequestedHandler(
  discoveryWorkflow: ExecutiveDiscoveryWorkflow | undefined,
): BusinessEventHandler {
  return async (event) => {
    if (event.type !== "organization.discovery_requested") {
      return rejected(
        "organization.discovery_requested handler invoked for non discovery event",
      );
    }
    if (!discoveryWorkflow) {
      return rejected(
        "organization.discovery_requested requires an ExecutiveDiscoveryWorkflow. No discovery workflow was supplied to the catalog.",
      );
    }

    const result: ExecutiveDiscoveryWorkflowResult =
      await discoveryWorkflow.run({
        organizationId: event.organizationId,
        requestedBy: event.requestedBy,
        options: {
          includeFounderBrain: event.includeFounderBrain ?? false,
          includeCompetitorAnalysis: event.includeCompetitorAnalysis ?? false,
          includeMarketAnalysis: event.includeMarketAnalysis ?? false,
          depth: event.depth ?? "standard",
        },
        ...(event.priority ? { priority: event.priority } : {}),
      });

    if (result.status === "failed") {
      return {
        status: "failed",
        output: result,
        errors: [
          {
            code: result.error.code,
            message: result.error.message,
            phase: "execution",
          },
        ],
        workflowId: result.workflowId,
        executionId: result.executionId,
      };
    }

    return {
      status: "completed",
      output: result,
      errors: [],
      workflowId: result.workflowId,
      executionId: result.executionId,
    };
  };
}

/**
 * Handler for `organization.discovered` fact event. Delegates to the
 * host-supplied `DiscoveryCompletionHandler` when present — the catalog never
 * executes business logic. Without a completion handler, the catalog falls
 * back to associating the discovery (`event.discoveryExecutionId`) to the
 * organization's non-archived Departments through the supplied
 * `DepartmentService` (Sprint 34 capability). Without either, the event is
 * rejected in a controlled way.
 */
function createOrganizationDiscoveredHandler(
  completionHandler: DiscoveryCompletionHandler | undefined,
  departmentService: DepartmentService | undefined,
): BusinessEventHandler {
  return async (event) => {
    if (event.type !== "organization.discovered") {
      return rejected(
        "organization.discovered handler invoked for non discovery event",
      );
    }
    if (completionHandler) {
      return completionHandler(event);
    }
    if (!departmentService) {
      return rejected(
        "organization.discovered requires a discovery completion handler or a department service. Neither was supplied to the catalog.",
      );
    }

    const departments = departmentService
      .list()
      .filter(
        (snapshot) =>
          snapshot.organizationId === event.organizationId &&
          snapshot.status !== "archived",
      );

    if (departments.length === 0) {
      return {
        status: "skipped",
        output: { associatedCount: 0, departmentIds: [] },
        errors: [],
      };
    }

    const departmentIds: string[] = [];
    for (const snapshot of departments) {
      departmentService.associateDiscovery(
        snapshot.id,
        event.discoveryExecutionId,
      );
      departmentIds.push(snapshot.id);
    }

    return {
      status: "completed",
      output: { associatedCount: departmentIds.length, departmentIds },
      errors: [],
    };
  };
}

function rejected(message: string): BusinessEventHandlerOutcome {
  return {
    status: "rejected",
    output: null,
    errors: [
      {
        code: "BUSINESS_EVENT_REJECTED",
        message,
        phase: "catalog",
      },
    ],
  };
}

export class BusinessEventCatalog {
  private readonly handlers = new Map<
    BusinessEvent["type"],
    BusinessEventHandler
  >();

  register(
    type: BusinessEvent["type"],
    handler: BusinessEventHandler,
  ): BusinessEventCatalog {
    if (this.handlers.has(type)) {
      throw new Error(
        `Business event handler for '${type}' is already registered.`,
      );
    }
    this.handlers.set(type, handler);
    return this;
  }

  has(type: BusinessEvent["type"]): boolean {
    return this.handlers.has(type);
  }

  resolve(type: BusinessEvent["type"]): BusinessEventHandler {
    const handler = this.handlers.get(type);
    if (!handler) {
      throw new Error(
        `Business event handler for '${type}' is not registered with the catalog.`,
      );
    }
    return handler;
  }

  tryResolve(type: BusinessEvent["type"]): BusinessEventHandler | null {
    return this.handlers.get(type) ?? null;
  }

  list(): readonly BusinessEvent["type"][] {
    return [...this.handlers.keys()];
  }

  size(): number {
    return this.handlers.size;
  }
}

export function createBusinessEventCatalog(
  handlers?: Partial<{
    readonly "lead.created": BusinessEventHandler;
    readonly "organization.created": BusinessEventHandler;
    readonly "organization.provisioned": BusinessEventHandler;
    readonly "organization.discovery_requested": BusinessEventHandler;
    readonly "organization.discovered": BusinessEventHandler;
  }>,
): BusinessEventCatalog {
  const catalog = new BusinessEventCatalog();
  if (handlers?.["lead.created"]) {
    catalog.register("lead.created", handlers["lead.created"]);
  }
  if (handlers?.["organization.created"]) {
    catalog.register("organization.created", handlers["organization.created"]);
  }
  if (handlers?.["organization.provisioned"]) {
    catalog.register(
      "organization.provisioned",
      handlers["organization.provisioned"],
    );
  }
  if (handlers?.["organization.discovery_requested"]) {
    catalog.register(
      "organization.discovery_requested",
      handlers["organization.discovery_requested"],
    );
  }
  if (handlers?.["organization.discovered"]) {
    catalog.register(
      "organization.discovered",
      handlers["organization.discovered"],
    );
  }
  return catalog;
}

/**
 * Convenience helper that wires the canonical Sprint 27 catalog and
 * returns the catalog together with the default handler bundle.
 */
export function buildCanonicalCatalog(
  options: Parameters<typeof buildDefaultCatalogHandlers>[0] & {
    readonly provisioningHandler?: (
      event: BusinessEvent,
    ) => Promise<BusinessEventHandlerOutcome>;
  },
): {
  catalog: BusinessEventCatalog;
  handlers: ReturnType<typeof buildDefaultCatalogHandlers>;
} {
  const handlers = buildDefaultCatalogHandlers(options);
  const catalog = new BusinessEventCatalog()
    .register("lead.created", handlers["lead.created"])
    .register("organization.created", handlers["organization.created"])
    .register("organization.provisioned", handlers["organization.provisioned"])
    .register(
      "organization.discovery_requested",
      handlers["organization.discovery_requested"],
    )
    .register("organization.discovered", handlers["organization.discovered"]);
  return { catalog, handlers };
}
