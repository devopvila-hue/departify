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
});
