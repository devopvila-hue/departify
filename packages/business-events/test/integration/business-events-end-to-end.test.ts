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
    expect(result.workflowId).toBe("wf_executive_discovery");
    expect(result.executionId).toBe("exe_disc_provisioned_auto");
    const stored = reportRepository.findById("exe_disc_provisioned_auto");
    expect(stored).not.toBeNull();
    expect(stored?.organizationId).toBe("org_departify");
    expect(stored?.report.gaps.length).toBeGreaterThan(0);
  });
});
