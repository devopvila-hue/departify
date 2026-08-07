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
import { createDepartmentService } from "@departify/departments";
import {
  BusinessDiscoveryService,
  createInMemoryDiscoveryReportRepository,
} from "@departify/business-discovery";
import { ExecutiveDirector } from "@departify/executive-director";
import {
  createExecutiveDiscoveryWorkflow,
  createExecutiveOrchestrator,
} from "@departify/executive-orchestrator";
import {
  BusinessEventService,
  buildCanonicalCatalog,
  type BusinessEvent,
} from "../../src/index.js";

/**
 * End-to-end integration: a BusinessEvent flows through the catalog into
 * the existing runtimes (Tool Runtime + Core Tool Catalog + Workflow
 * Execution) without any modification to those packages.
 */
describe("BusinessEvent end-to-end integration", () => {
  it("publishes lead.created against a real Tool Runtime composition", async () => {
    const toolRegistry = new ToolRuntimeRegistry();
    registerAllCoreTools(toolRegistry, {});
    const runtime = createToolRuntime({ grantedScopes: ["read.public"] });
    for (const entry of toolRegistry.list()) {
      runtime.registry.register(entry.definition);
      runtime.registry.setStatus(entry.definition.id, "active");
    }

    const port: AgentToolPort = new AgentToolRuntimeAdapter({
      runtime,
      fetchPermissionSet: buildAgentPermissionSetResolver(
        new Map([
          [
            "agent_lead_qualifier",
            [
              {
                scope: "runtime" as const,
                action: "execute" as const,
                resource: "system.uuid",
              },
            ],
          ],
          [
            "agent_outreach_specialist",
            [
              {
                scope: "runtime" as const,
                action: "execute" as const,
                resource: "system.uuid",
              },
            ],
          ],
          [
            "agent_proposal_writer",
            [
              {
                scope: "runtime" as const,
                action: "execute" as const,
                resource: "system.uuid",
              },
            ],
          ],
        ]),
      ),
    });

    const executor = new WorkflowExecution({ port });
    const { catalog } = buildCanonicalCatalog({
      port,
      workflowExecutor: executor,
    });
    const service = new BusinessEventService({ catalog });

    const event: BusinessEvent = {
      eventId: "evt_e2e_lead",
      type: "lead.created",
      occurredAt: new Date(),
      organizationId: "org_departify",
      departmentId: "dep_comercial",
      leadId: "lead_001",
      contactEmail: "lead@example.com",
      payload: {},
    };

    const result = await service.publish(event);

    expect(result.status).toBe("completed");
    expect(result.workflowId).toBe("wf_lead_qualification");
    expect(result.executionId).toMatch(/^wfe_/);
    expect(result.departmentId).toBe("dep_comercial");
    expect(result.errors).toEqual([]);
  });

  it("forwards organization.created through the provisioning handler", async () => {
    const port = {
      executeAction: async () => {
        throw new Error("bridge not used");
      },
    } as unknown as AgentToolPort;

    const executor = new WorkflowExecution({ port });
    const { catalog } = buildCanonicalCatalog({
      port,
      workflowExecutor: executor,
      provisioningHandler: async (event) => {
        if (event.type !== "organization.created") {
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
        return {
          status: "completed",
          output: {
            organizationId: event.organizationId,
            workspaceId: event.workspaceId,
          },
          errors: [],
          provisioningId: "prv_integration_001",
        };
      },
    });

    const service = new BusinessEventService({ catalog });

    const event: BusinessEvent = {
      eventId: "evt_e2e_org",
      type: "organization.created",
      occurredAt: new Date(),
      organizationId: "org_departify",
      workspaceId: "wsp_default",
      organizationName: "Departify",
      payload: {},
    };

    const result = await service.publish(event);

    expect(result.status).toBe("completed");
    expect(result.provisioningId).toBe("prv_integration_001");
    expect(result.errors).toEqual([]);
  });

  it("publishes organization.discovery_requested through the Executive Discovery Workflow", async () => {
    // Real composition: AgentToolBridge → Tool Runtime → Core Tool Catalog
    // with the discovery.analyze Tool, driven by the real
    // ExecutiveDiscoveryWorkflow (Sprint 31).
    const toolRegistry = new ToolRuntimeRegistry();
    registerAllCoreTools(toolRegistry, {});
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
        ]),
      ),
    });

    const orchestrator = createExecutiveOrchestrator({
      director: new ExecutiveDirector(),
      bridge: port,
    });

    const discoveryWorkflow = createExecutiveDiscoveryWorkflow({
      discoveryService: new BusinessDiscoveryService({
        sessionIdGenerator: () => "session_evt_e2e",
      }),
      orchestrator,
      executionIdFactory: () => "exe_disc_evt_e2e",
    });

    const executor = new WorkflowExecution({ port });
    const { catalog } = buildCanonicalCatalog({
      port,
      workflowExecutor: executor,
      discoveryWorkflow,
    });
    const service = new BusinessEventService({ catalog });

    const event: BusinessEvent = {
      eventId: "evt_e2e_discovery",
      type: "organization.discovery_requested",
      occurredAt: new Date(),
      organizationId: "org_departify",
      requestedBy: "tester",
      includeFounderBrain: true,
      payload: {},
    };

    const result = await service.publish(event);

    expect(result.status).toBe("completed");
    expect(result.workflowId).toBe("wf_executive_discovery");
    expect(result.executionId).toBe("exe_disc_evt_e2e");
    expect(result.errors).toEqual([]);
    const output = result.output as {
      report: { gaps: unknown[]; questions: unknown[] };
    };
    expect(output.report.gaps.length).toBeGreaterThan(0);
    expect(output.report.questions.length).toBeGreaterThan(0);
  });

  it("delegates organization.discovered to the discovery completion handler", async () => {
    const port = {
      executeAction: async () => {
        throw new Error("bridge not used");
      },
    } as unknown as AgentToolPort;

    const executor = new WorkflowExecution({ port });
    const captured: { event: BusinessEvent | null } = { event: null };
    const { catalog } = buildCanonicalCatalog({
      port,
      workflowExecutor: executor,
      discoveryCompletionHandler: async (event) => {
        captured.event = event;
        return {
          status: "completed",
          output: {
            organizationId: event.organizationId,
            sessionId:
              event.type === "organization.discovered"
                ? event.sessionId
                : null,
          },
          errors: [],
          executionId: "exe_disc_completion_001",
        };
      },
    });
    const service = new BusinessEventService({ catalog });

    const event: BusinessEvent = {
      eventId: "evt_e2e_discovered",
      type: "organization.discovered",
      occurredAt: new Date(),
      organizationId: "org_departify",
      sessionId: "session_evt_discovered",
      discoveryExecutionId: "exe_disc_evt_e2e",
      confidence: "low",
      gapCount: 14,
      questionCount: 20,
      payload: {},
    };

    const result = await service.publish(event);

    expect(result.status).toBe("completed");
    expect(result.executionId).toBe("exe_disc_completion_001");
    expect(result.errors).toEqual([]);
    expect(captured.event?.type).toBe("organization.discovered");
    expect(captured.event?.organizationId).toBe("org_departify");
  });

  it("associates the discovery to the organization's Department by default", async () => {
    const departmentService = createDepartmentService();
    departmentService.create({
      id: "dep_comercial",
      organizationId: "org_departify",
      name: "Comercial",
      description: "Sales department",
      configuration: {
        displayName: "Comercial",
        description: "Sales",
        tags: [],
        metadata: {},
      },
    });
    departmentService.activate("dep_comercial");

    const port = {
      executeAction: async () => {
        throw new Error("bridge not used");
      },
    } as unknown as AgentToolPort;
    const executor = new WorkflowExecution({ port });
    const { catalog } = buildCanonicalCatalog({
      port,
      workflowExecutor: executor,
      departmentService,
    });
    const service = new BusinessEventService({ catalog });

    const event: BusinessEvent = {
      eventId: "evt_e2e_assoc",
      type: "organization.discovered",
      occurredAt: new Date(),
      organizationId: "org_departify",
      sessionId: "session_assoc",
      discoveryExecutionId: "exe_disc_assoc_001",
      confidence: "low",
      gapCount: 14,
      questionCount: 20,
      payload: {},
    };

    const result = await service.publish(event);

    expect(result.status).toBe("completed");
    expect(departmentService.getDiscoveryId("dep_comercial")).toBe(
      "exe_disc_assoc_001",
    );
    expect(
      departmentService.get("dep_comercial").toSnapshot().discoveryId,
    ).toBe("exe_disc_assoc_001");
  });

  it("runs the discovery workflow automatically on organization.provisioned", async () => {
    // Real composition: provisioning handler + Executive Discovery Workflow
    // (Sprint 31) with a real BusinessDiscoveryService, ExecutiveOrchestrator,
    // AgentToolBridge, Tool Runtime, Core Tool Catalog and a report repository.
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
            "agent_sales_director",
            [
              {
                scope: "runtime" as const,
                action: "manage" as const,
                resource: "*",
              },
            ],
          ],
          [
            "agent_lead_qualifier",
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
        sessionIdGenerator: () => "session_provisioned_auto",
      }),
      orchestrator,
      executionIdFactory: () => "exe_disc_provisioned_auto",
      reportRepository,
    });

    const executor = new WorkflowExecution({ port });
    const { catalog } = buildCanonicalCatalog({
      port,
      workflowExecutor: executor,
      discoveryWorkflow,
      provisioningHandler: async (event) => ({
        status: "completed",
        output: { organizationId: event.organizationId },
        errors: [],
        provisioningId:
          event.type === "organization.provisioned"
            ? event.provisioningId
            : "prv_auto",
      }),
    });
    const service = new BusinessEventService({ catalog });

    const event: BusinessEvent = {
      eventId: "evt_e2e_provisioned_auto",
      type: "organization.provisioned",
      occurredAt: new Date(),
      organizationId: "org_departify",
      workspaceId: "wsp_default",
      provisioningId: "prv_auto_001",
      payload: {},
    };

    const result = await service.publish(event);

    expect(result.status).toBe("completed");
    // The final workflow reported is the Department Onboarding (Sprint 48).
    expect(result.workflowId).toBe("wf_department_onboarding");
    const stored = reportRepository.findById("exe_disc_provisioned_auto");
    expect(stored).not.toBeNull();
    expect(stored?.organizationId).toBe("org_departify");
    expect(stored?.report.gaps.length).toBeGreaterThan(0);
    // The first value was delivered: the onboarding result carries the
    // executive summary produced by the delegated employee.
    const output = result.output as {
      onboarding?: { finalOutput?: { gapCount?: number } };
    };
    expect(output.onboarding?.finalOutput?.gapCount).toBeGreaterThan(0);
  });

  it("turns a confirmed payment into an organization (Vending Machine entry)", async () => {
    // The only mock is the external event: `payment.confirmed` is emitted by
    // Stripe (or a simulator) with the exact same shape. The handler turns
    // the paid customer into an organization through the existing
    // `OrganizationCreator` port; provisioning, discovery and onboarding are
    // chained downstream (Sprints 38-48) once the organization is created.
    const port = {
      executeAction: async () => {
        throw new Error("bridge not used");
      },
    } as unknown as AgentToolPort;
    const executor = new WorkflowExecution({ port });
    const { catalog } = buildCanonicalCatalog({
      port,
      workflowExecutor: executor,
      organizationCreator: async (event) => {
        if (event.type !== "payment.confirmed") {
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
        return {
          status: "completed",
          output: {
            organizationId: event.organizationId,
            paymentId: event.paymentId,
            planId: event.planId,
          },
          errors: [],
          provisioningId: "prv_from_payment",
        };
      },
      provisioningHandler: async (event) => ({
        status: "completed" as const,
        output: { organizationId: event.organizationId },
        errors: [],
        provisioningId: "prv_from_payment",
      }),
    });
    const service = new BusinessEventService({ catalog });

    const payment: BusinessEvent = {
      eventId: "evt_e2e_payment",
      type: "payment.confirmed",
      occurredAt: new Date(),
      paymentId: "pay_e2e_001",
      organizationId: "org_departify",
      planId: "plan_pro",
      customerEmail: "client@example.com",
      payload: {},
    };

    const result = await service.publish(payment);

    expect(result.status).toBe("completed");
    // Without a discovery workflow the pipeline returns the activation result.
    const output = result.output as {
      organizationId: string;
    };
    expect(output.organizationId).toBe("org_departify");
  });

  it("starts the whole Empresa Digital from a single payment.confirmed", async () => {
    // The only mock is the external event. One `payment.confirmed` must put
    // the whole Empresa Digital in motion: organization → provisioning →
    // discovery → onboarding → first value (Sprints 38-50 chained).
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
            "agent_sales_director",
            [
              {
                scope: "runtime" as const,
                action: "manage" as const,
                resource: "*",
              },
            ],
          ],
          [
            "agent_lead_qualifier",
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
        sessionIdGenerator: () => "session_vending",
      }),
      orchestrator,
      executionIdFactory: () => "exe_disc_vending_001",
      reportRepository,
    });

    const executor = new WorkflowExecution({ port });
    const { catalog } = buildCanonicalCatalog({
      port,
      workflowExecutor: executor,
      discoveryWorkflow,
      organizationCreator: async (event) => {
        if (event.type !== "payment.confirmed") {
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
        return {
          status: "completed",
          output: { organizationId: event.organizationId },
          errors: [],
          provisioningId: "prv_from_payment",
        };
      },
      provisioningHandler: async (event) => ({
        status: "completed",
        output: { organizationId: event.organizationId },
        errors: [],
        provisioningId: "prv_vending",
      }),
    });
    const service = new BusinessEventService({ catalog });

    const payment: BusinessEvent = {
      eventId: "evt_e2e_vending",
      type: "payment.confirmed",
      occurredAt: new Date(),
      paymentId: "pay_vending_001",
      organizationId: "org_departify",
      planId: "plan_pro",
      customerEmail: "client@example.com",
      payload: {},
    };

    const result = await service.publish(payment);

    // The whole flow completed from a single event: the onboarding ran and
    // delivered the first value.
    expect(result.status).toBe("completed");
    const stored = reportRepository.findById("exe_disc_vending_001");
    expect(stored).not.toBeNull();
    expect(stored?.organizationId).toBe("org_departify");
    const output = result.output as {
      onboarding?: { finalOutput?: { gapCount?: number } };
    };
    expect(output.onboarding?.finalOutput?.gapCount).toBeGreaterThan(0);
  });

  it("runs the Marketing Customer Zero onboarding with its own Director", async () => {
    // A real company contracts the Marketing department: the onboarding must
    // run with the Marketing Director and a Marketing employee (Sprint 52),
    // not with the Comercial agents.
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
        sessionIdGenerator: () => "session_marketing_c0",
      }),
      orchestrator,
      executionIdFactory: () => "exe_disc_marketing_c0",
      reportRepository,
    });

    const executor = new WorkflowExecution({ port });
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
        provisioningId: "prv_marketing_c0",
      }),
      provisioningHandler: async (event) => ({
        status: "completed",
        output: { organizationId: event.organizationId },
        errors: [],
        provisioningId: "prv_marketing_c0",
      }),
    });
    const service = new BusinessEventService({ catalog });

    const payment: BusinessEvent = {
      eventId: "evt_e2e_marketing_c0",
      type: "payment.confirmed",
      occurredAt: new Date(),
      paymentId: "pay_marketing_c0",
      organizationId: "org_departify",
      planId: "plan_marketing",
      customerEmail: "client@example.com",
      payload: {},
    };

    const result = await service.publish(payment);

    expect(result.status).toBe("completed");
    const output = result.output as {
      onboarding?: {
        steps?: { agentId?: string }[];
        finalOutput?: { gapCount?: number };
      };
    };
    // The first four steps ran with the Marketing Director; the last two
    // with the Marketing employee.
    const steps = output.onboarding?.steps ?? [];
    expect(steps[0]?.agentId).toBe("agent_marketing_director");
    expect(steps[4]?.agentId).toBe("agent_content_strategist");
    expect(output.onboarding?.finalOutput?.gapCount).toBeGreaterThan(0);
  });

  it("forwards the real company rawData through payment.confirmed to discovery", async () => {
    // Sprint 56: the CEO's real company information carried by the
    // payment.confirmed payload must reach the discovery pipeline so
    // Marketing learns the business instead of an empty Company DNA.
    const reportRepository = createInMemoryDiscoveryReportRepository();
    const received: { rawData?: unknown } = {};

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

    const innerDiscoveryService = new BusinessDiscoveryService({
      sessionIdGenerator: () => "session_rawdata_c0",
    });
    const discoveryWorkflow = createExecutiveDiscoveryWorkflow({
      discoveryService: {
        initiateDiscovery: async (request: unknown) => {
          const candidate = request as { rawData?: unknown };
          received.rawData = candidate.rawData;
          return innerDiscoveryService.initiateDiscovery(request);
        },
      } as unknown as BusinessDiscoveryService,
      orchestrator,
      executionIdFactory: () => "exe_disc_rawdata_c0",
      reportRepository,
    });

    const executor = new WorkflowExecution({ port });
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
        provisioningId: "prv_rawdata_c0",
      }),
      provisioningHandler: async (event) => ({
        status: "completed",
        output: { organizationId: event.organizationId },
        errors: [],
        provisioningId: "prv_rawdata_c0",
      }),
    });
    const service = new BusinessEventService({ catalog });

    const rawData = {
      mission: {
        statement: "MOON co-living: shared living in Barcelona and Madrid",
        confidence: {
          level: "verified",
          source: "user_input",
          lastVerified: new Date().toISOString(),
        },
      },
      market: {
        industry: "co-living",
        competition: "medium",
        confidence: {
          level: "verified",
          source: "user_input",
          lastVerified: new Date().toISOString(),
        },
      },
    };
    const payment: BusinessEvent = {
      eventId: "evt_e2e_rawdata_c0",
      type: "payment.confirmed",
      occurredAt: new Date(),
      paymentId: "pay_rawdata_c0",
      organizationId: "org_rawdata_c0",
      planId: "plan_marketing",
      customerEmail: "client@example.com",
      payload: { rawData },
    };

    const result = await service.publish(payment);

    expect(result.status).toBe("completed");
    expect(received.rawData).toEqual(rawData);
  });
});
