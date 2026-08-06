import {
  buildLeadQualificationWorkflow,
  LEAD_QUALIFICATION_WORKFLOW_ID,
  WorkflowExecution,
} from "../../src/index.js";
import type {
  AgentToolAction,
  AgentToolActionResult,
  AgentToolOutcome,
  AgentToolPort,
} from "@departify/agent-tool-bridge";

class SuccessAgentToolPort implements AgentToolPort {
  readonly calls: AgentToolAction[] = [];

  async executeAction(action: AgentToolAction): Promise<AgentToolOutcome> {
    this.calls.push(action);
    const envelope: AgentToolActionResult = {
      actionId: action.actionId,
      requestId: action.actionId,
      toolId: action.toolId,
      toolVersion: "1.0.0",
      status: "completed",
      output: { uuid: `${action.actionId}_uuid` },
      durationMs: 1,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    return envelope;
  }
}

describe("Lead Qualification Workflow execution", () => {
  it("completes three steps sequentially with typed context passing", async () => {
    const port = new SuccessAgentToolPort();
    const execution = new WorkflowExecution({ port });
    const result = await execution.run(buildLeadQualificationWorkflow());

    expect(result.status).toBe("completed");
    expect(result.steps).toHaveLength(3);
    expect(port.calls).toHaveLength(3);

    // Step 1 — fresh
    expect(port.calls[0]?.agentId).toBe("agent_lead_qualifier");
    expect(port.calls[0]?.metadata?.["workflow_step"]).toBe("qualify_lead");

    // Step 2 — receives Step 1's output under qualified_lead_id
    const step1Output = {
      uuid: `${port.calls[0]?.actionId}_uuid`,
    };
    expect(
      JSON.parse(port.calls[1]?.metadata?.["qualified_lead_id"] ?? "{}"),
    ).toEqual(step1Output);
    expect(port.calls[1]?.metadata?.["qualified_lead_status"]).toBe(
      "completed",
    );

    // Step 3 — receives Step 2's output under contact_id
    const step2Output = {
      uuid: `${port.calls[1]?.actionId}_uuid`,
    };
    expect(JSON.parse(port.calls[2]?.metadata?.["contact_id"] ?? "{}")).toEqual(
      step2Output,
    );
    expect(port.calls[2]?.metadata?.["contact_status"]).toBe("completed");
  });

  it("exposes the canonical workflow id through the exported constant", () => {
    expect(buildLeadQualificationWorkflow().id).toBe(
      LEAD_QUALIFICATION_WORKFLOW_ID,
    );
  });

  it("emits a typed WorkflowResult with start/end timestamps", async () => {
    const port = new SuccessAgentToolPort();
    const execution = new WorkflowExecution({ port });
    const result = await execution.run(buildLeadQualificationWorkflow());

    expect(result.executionId).toMatch(/^wfe_/);
    expect(result.workflowId).toBe(LEAD_QUALIFICATION_WORKFLOW_ID);
    expect(result.startedAt).toBeTruthy();
    expect(result.completedAt).toBeTruthy();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
