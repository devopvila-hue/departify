import {
  buildLeadQualificationWorkflow,
  LEAD_QUALIFICATION_WORKFLOW,
  LEAD_QUALIFICATION_WORKFLOW_ID,
  WorkflowBuilder,
  WorkflowExecution,
  WorkflowValidationError,
  validateWorkflowDefinition,
} from "../../src/index.js";
import type {
  AgentToolAction,
  AgentToolActionResult,
  AgentToolOutcome,
  AgentToolOutcomeError,
  AgentToolPort,
} from "@departify/agent-tool-bridge";

/**
 * RecordingAgentToolPort captures every action the workflow submits and
 * returns scripted outcomes. It also lets tests inject failures for
 * specific steps.
 */
class RecordingAgentToolPort implements AgentToolPort {
  readonly calls: AgentToolAction[] = [];
  private readonly outcomesByStep = new Map<string, AgentToolOutcome>();

  withOutcome(stepId: string, outcome: AgentToolOutcome): this {
    this.outcomesByStep.set(stepId, outcome);
    return this;
  }

  async executeAction(action: AgentToolAction): Promise<AgentToolOutcome> {
    this.calls.push(action);
    const scripted = this.outcomesByStep.get(
      action.metadata?.["workflow_step"] ?? "",
    );
    if (scripted) {
      return scripted;
    }
    const envelope: AgentToolActionResult = {
      actionId: action.actionId,
      requestId: action.actionId,
      toolId: action.toolId,
      toolVersion: "1.0.0",
      status: "completed",
      output: { id: `${action.metadata?.["workflow_step"] ?? "x"}_output` },
      durationMs: 1,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    return envelope;
  }
}

function rejectedOutcome(
  actionId: string,
  toolId: string,
  reason: string,
  code: string,
): AgentToolOutcomeError {
  return {
    actionId,
    agentId: "agent_x",
    toolId,
    status: "rejected",
    reason,
    code,
    occurredAt: new Date().toISOString(),
  };
}

describe("Lead Qualification Workflow", () => {
  it("builds the canonical Comercial workflow with three steps", () => {
    const workflow = buildLeadQualificationWorkflow();
    expect(workflow.id).toBe(LEAD_QUALIFICATION_WORKFLOW_ID);
    expect(workflow.steps).toHaveLength(3);
    expect(workflow.steps.map((step) => step.agentId)).toEqual([
      "agent_lead_qualifier",
      "agent_outreach_specialist",
      "agent_proposal_writer",
    ]);
    expect(workflow.steps.every((step) => step.toolId === "system.uuid")).toBe(
      true,
    );
    expect(LEAD_QUALIFICATION_WORKFLOW.id).toBe(LEAD_QUALIFICATION_WORKFLOW_ID);
  });

  it("runs end-to-end and threads the previous step's output to the next", async () => {
    const port = new RecordingAgentToolPort();
    const execution = new WorkflowExecution({ port });

    const result = await execution.run(buildLeadQualificationWorkflow());

    expect(result.status).toBe("completed");
    expect(result.steps).toHaveLength(3);
    expect(result.steps.every((step) => step.status === "completed")).toBe(
      true,
    );

    // Step 1 received only the workflow metadata.
    expect(port.calls[0]?.metadata?.["workflow_step"]).toBe("qualify_lead");
    expect(port.calls[0]?.metadata?.["previous_output"]).toBeUndefined();

    // Step 2 received Step 1's serialised output under qualified_lead_id.
    expect(port.calls[1]?.metadata?.["workflow_step"]).toBe("prepare_contact");
    expect(port.calls[1]?.metadata?.["qualified_lead_id"]).toBe(
      JSON.stringify({ id: "qualify_lead_output" }),
    );
    expect(port.calls[1]?.metadata?.["qualified_lead_action_id"]).toBe(
      port.calls[0]?.actionId,
    );
    expect(port.calls[1]?.metadata?.["qualified_lead_status"]).toBe(
      "completed",
    );

    // Step 3 received Step 2's serialised output under contact_id.
    expect(port.calls[2]?.metadata?.["workflow_step"]).toBe(
      "generate_proposal",
    );
    expect(port.calls[2]?.metadata?.["contact_id"]).toBe(
      JSON.stringify({ id: "prepare_contact_output" }),
    );
    expect(port.calls[2]?.metadata?.["contact_action_id"]).toBe(
      port.calls[1]?.actionId,
    );
  });

  it("preserves correlation ids end-to-end", async () => {
    const port = new RecordingAgentToolPort();
    const execution = new WorkflowExecution({ port });
    const result = await execution.run(buildLeadQualificationWorkflow());

    expect(result.executionId).toMatch(/^wfe_/);
    expect(result.workflowId).toBe(LEAD_QUALIFICATION_WORKFLOW_ID);
    expect(result.startedAt).toBeTruthy();
    expect(result.completedAt).toBeTruthy();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.steps.every((step) => step.actionId.length > 0)).toBe(true);
  });

  it("reports failures when a step is rejected", async () => {
    const port = new RecordingAgentToolPort().withOutcome(
      "prepare_contact",
      rejectedOutcome(
        "act_wf_failed",
        "system.uuid",
        "Agent does not have permission to call system.uuid.",
        "authorization_failed",
      ),
    );
    const execution = new WorkflowExecution({ port });
    const result = await execution.run(buildLeadQualificationWorkflow());

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("authorization_failed");
    expect(result.steps[0]?.status).toBe("completed");
    expect(result.steps[1]?.status).toBe("failed");
    expect(result.steps[2]).toBeUndefined();
  });

  it("honours cancellation through the supplied AbortSignal", async () => {
    const port = new RecordingAgentToolPort();
    const controller = new AbortController();
    controller.abort();

    const execution = new WorkflowExecution({
      port,
      signal: controller.signal,
    });
    const result = await execution.run(buildLeadQualificationWorkflow());

    expect(result.status).toBe("cancelled");
    expect(result.error?.code).toBe("execution_cancelled");
    expect(result.steps[0]?.status).toBe("cancelled");
  });

  it("rejects workflows missing steps or with duplicate ids", () => {
    expect(() =>
      WorkflowBuilder.create({
        id: "wf_empty",
        name: "Empty",
        description: "No steps",
      }).build(),
    ).toThrow(WorkflowValidationError);

    expect(() =>
      WorkflowBuilder.create({
        id: "wf_dup",
        name: "Dup",
        description: "Duplicate step ids",
      })
        .withStep({
          id: "step_a",
          name: "A",
          agentId: "agent_x",
          toolId: "system.uuid",
          args: {},
        })
        .withStep({
          id: "step_a",
          name: "A2",
          agentId: "agent_y",
          toolId: "system.uuid",
          args: {},
        })
        .build(),
    ).toThrow(WorkflowValidationError);
  });

  it("validates a workflow definition without exposing contracts", () => {
    const workflow = buildLeadQualificationWorkflow();
    expect(validateWorkflowDefinition(workflow).id).toBe(
      LEAD_QUALIFICATION_WORKFLOW_ID,
    );
  });
});
