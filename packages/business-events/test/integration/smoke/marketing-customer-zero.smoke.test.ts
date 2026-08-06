import {
  AgentToolRuntimeAdapter,
  buildAgentPermissionSetResolver,
  type AgentToolPort,
} from "@departify/agent-tool-bridge";
import {
  createToolRuntime,
  ToolRegistry as ToolRuntimeRegistry,
} from "@departify/tool-runtime";
import { registerAllCoreTools } from "@departify/tool-catalog";
import { WorkflowExecution } from "@departify/workflows";
import {
  buildMarketingTemplate,
  createDepartmentService,
  createDepartmentTemplateCatalog,
} from "@departify/departments";
import {
  BusinessDiscoveryService,
  createInMemoryDiscoveryReportRepository,
} from "@departify/business-discovery";
import { ExecutiveDirector } from "@departify/executive-director";
import {
  createExecutiveDiscoveryWorkflow,
  createExecutiveOrchestrator,
} from "@departify/executive-orchestrator";
import { BusinessProvisioningService } from "@departify/platform-composition";
import {
  BusinessEventService,
  buildCanonicalCatalog,
  type BusinessEvent,
} from "../../../src/index.js";

/**
 * SMOKE TEST — Marketing Customer Zero (Sprint 53).
 *
 * The first end-to-end Smoke Test: a real company contracts the Marketing
 * department and the whole Vending Machine flow runs with REAL provisioning
 * (not a stub). `payment.confirmed` must produce:
 *   organization → REAL Marketing department instantiated from `tpl_marketing`
 *   → discovery → onboarding with the Marketing Director → first value
 *   → the CEO only decides.
 *
 * The only mock is the external event emitter (`payment.confirmed`). The
 * `provisioningHandler` uses the real `BusinessProvisioningService`, so the
 * Marketing department is genuinely created (Director + employees).
 */
describe("SMOKE — Marketing Customer Zero", () => {
  it("creates a real Marketing department and delivers its first value from a single payment", async () => {
    // --- Real infrastructure -------------------------------------------
    const reportRepository = createInMemoryDiscoveryReportRepository();
    const toolRegistry = new ToolRuntimeRegistry();
    registerAllCoreTools(toolRegistry, {
      discoveryRepository: reportRepository,
    });
    const runtime = createToolRuntime({
      grantedScopes: ["read.public", "read.private"],
    });
    for (const entry of toolRegistry.list()) {
      runtime.registry.register(entry.definition);
      runtime.registry.setStatus(entry.definition.id, "active");
    }

    const port: AgentToolPort = new AgentToolRuntimeAdapter({
      runtime,
      fetchPermissionSet: buildAgentPermissionSetResolver(
        new Map([
          [
            "agent.executive",
            [
              {
                scope: "runtime" as const,
                action: "manage" as const,
                resource: "*",
              },
            ],
          ],
          [
            "agent_marketing_director",
            [
              {
                scope: "runtime" as const,
                action: "manage" as const,
                resource: "*",
              },
            ],
          ],
          [
            "agent_content_strategist",
            [
              {
                scope: "runtime" as const,
                action: "manage" as const,
                resource: "*",
              },
            ],
          ],
        ]),
      ),
    });

    const orchestrator = createExecutiveOrchestrator({
      director: new ExecutiveDirector(),
      bridge: port,
    });

    const discoveryWorkflow = createExecutiveDiscoveryWorkflow({
      discoveryService: new BusinessDiscoveryService({
        sessionIdGenerator: () => "session_smoke_c0",
      }),
      orchestrator,
      executionIdFactory: () => "exe_disc_smoke_c0",
      reportRepository,
    });

    const executor = new WorkflowExecution({ port });

    // --- Real provisioning: Marketing department from its template -------
    const departmentService = createDepartmentService();
    const templateCatalog = createDepartmentTemplateCatalog();
    templateCatalog.register(buildMarketingTemplate());
    const realProvisioning = new BusinessProvisioningService({
      catalog: templateCatalog,
      departmentService,
      defaultTemplateId: "tpl_marketing",
    });

    const { catalog } = buildCanonicalCatalog({
      port,
      workflowExecutor: executor,
      discoveryWorkflow,
      onboardingDirectorAgentId: "agent_marketing_director",
      onboardingEmployeeAgentId: "agent_content_strategist",
      organizationCreator: async (event) => ({
        status: "completed",
        output: { organizationId: event.organizationId },
        errors: [],
        provisioningId: "prv_smoke_c0",
      }),
      provisioningHandler: async (event) => {
        if (event.type !== "payment.confirmed" && event.type !== "organization.provisioned") {
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
            : "prv_smoke_c0";
        const provisioning = realProvisioning.instantiateBusiness(
          provisioningId,
          event.organizationId,
          "wsp_marketing_primary",
          {
            requestedBy: "platform",
            organizationName: "Marketing Customer Zero",
            business: { departmentTemplateId: "tpl_marketing" },
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
    const service = new BusinessEventService({ catalog });

    // --- The real company pays -----------------------------------------
    const payment: BusinessEvent = {
      eventId: "evt_smoke_c0",
      type: "payment.confirmed",
      occurredAt: new Date(),
      paymentId: "pay_smoke_c0",
      organizationId: "org_real_company",
      planId: "plan_marketing",
      customerEmail: "ceo@realcompany.com",
      payload: {},
    };

    const result = await service.publish(payment);

    // --- Assertions: the CEO only decides; the department works ---------
    expect(result.status).toBe("completed");

    // 1. The Marketing department was REALLY created from its template.
    const marketing = departmentService.list().find(
      (d) => d.organizationId === "org_real_company",
    );
    expect(marketing).toBeDefined();
    expect(marketing?.directorAgentId).toBe("agent_marketing_director");
    expect(marketing?.employeeAgentIds).toContain("agent_content_strategist");
    expect(marketing?.employeeAgentIds).toContain("agent_social_media_manager");
    expect(marketing?.employeeAgentIds).toContain("agent_ads_specialist");
    expect(marketing?.status).toBe("active");

    // 2. The discovery report was persisted.
    const stored = reportRepository.findById("exe_disc_smoke_c0");
    expect(stored).not.toBeNull();
    expect(stored?.organizationId).toBe("org_real_company");

    // 3. The first value was delivered by the Marketing employee.
    const output = result.output as {
      onboarding?: {
        finalOutput?: { gapCount?: number };
        steps?: { agentId?: string }[];
      };
    };
    expect(output.onboarding?.finalOutput?.gapCount).toBeGreaterThan(0);
    expect(output.onboarding?.steps?.[0]?.agentId).toBe(
      "agent_marketing_director",
    );
    expect(output.onboarding?.steps?.[4]?.agentId).toBe(
      "agent_content_strategist",
    );
  });
});
