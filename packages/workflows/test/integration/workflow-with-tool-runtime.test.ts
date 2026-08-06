import {
  AgentToolRuntimeAdapter,
  buildAgentPermissionSetResolver,
} from "@departify/agent-tool-bridge";
import {
  createToolRuntime,
  ToolRegistry as ToolRuntimeRegistry,
} from "@departify/tool-runtime";
import { registerAllCoreTools } from "@departify/tool-catalog";
import {
  buildLeadQualificationWorkflow,
  WorkflowExecution,
} from "../../src/index.js";
import type { AgentToolPort } from "@departify/agent-tool-bridge";

/**
 * End-to-end integration: the Lead Qualification Workflow runs against a
 * real Tool Runtime + Core Tool Catalog + AgentToolBridge composition. No
 * IA, no LLM Router, no HTTP — just the existing tools dispatched through
 * the bridge.
 */
describe("Lead Qualification Workflow integration with Tool Runtime", () => {
  it("completes the workflow end-to-end using the canonical tool catalog", async () => {
    const toolRegistry = new ToolRuntimeRegistry();
    registerAllCoreTools(toolRegistry, {});
    const runtime = createToolRuntime({ grantedScopes: ["read.public"] });
    for (const entry of toolRegistry.list()) {
      runtime.registry.register(entry.definition);
      runtime.registry.setStatus(entry.definition.id, "active");
    }

    const permissions = new Map([
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
    ]);

    const port: AgentToolPort = new AgentToolRuntimeAdapter({
      runtime,
      fetchPermissionSet: buildAgentPermissionSetResolver(permissions),
    });

    const execution = new WorkflowExecution({ port });
    const result = await execution.run(buildLeadQualificationWorkflow());

    expect(result.status).toBe("completed");
    expect(result.steps).toHaveLength(3);
    expect(result.steps.every((step) => step.status === "completed")).toBe(
      true,
    );

    // Step outputs flow through the chain.
    const step1Output = result.steps[0]?.output as { uuid?: string };
    const step2Metadata =
      result.steps[1]?.actionId !== undefined ? result.steps[1] : null;
    expect(step1Output?.uuid).toMatch(/^[0-9a-f-]{36}$/i);
    expect(step2Metadata).not.toBeNull();
  });

  it("propagates authorization failures when an agent lacks scopes", async () => {
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
          // agent_outreach_specialist has no permission to call system.uuid
        ]),
      ),
    });

    const execution = new WorkflowExecution({ port });
    const result = await execution.run(buildLeadQualificationWorkflow());

    expect(result.status).toBe("failed");
    expect(result.steps[0]?.status).toBe("completed");
    expect(result.steps[1]?.status).toBe("failed");
    expect(result.error?.code).toBe("agent_not_registered");
  });
});
