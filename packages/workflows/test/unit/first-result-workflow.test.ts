import {
  buildFirstResultWorkflow,
  FIRST_RESULT_WORKFLOW,
  FIRST_RESULT_WORKFLOW_ID,
  validateWorkflowDefinition,
} from "../../src/index.js";

describe("First Result Workflow", () => {
  it("builds the canonical workflow with a single discovery.summary step", () => {
    const workflow = buildFirstResultWorkflow(
      "org_departify",
      "agent_lead_qualifier",
    );
    expect(workflow.id).toBe(FIRST_RESULT_WORKFLOW_ID);
    expect(workflow.steps).toHaveLength(1);
    const step = workflow.steps[0];
    expect(step?.agentId).toBe("agent_lead_qualifier");
    expect(step?.toolId).toBe("discovery.summary");
    expect(step?.args).toEqual({ organizationId: "org_departify" });
    expect(FIRST_RESULT_WORKFLOW.id).toBe(FIRST_RESULT_WORKFLOW_ID);
  });

  it("passes validation", () => {
    const workflow = buildFirstResultWorkflow(
      "org_departify",
      "agent_lead_qualifier",
    );
    expect(validateWorkflowDefinition(workflow).id).toBe(FIRST_RESULT_WORKFLOW_ID);
  });

  it("has an id matching the canonical workflow pattern", () => {
    expect(FIRST_RESULT_WORKFLOW_ID).toMatch(/^wf_[a-z][a-z0-9_]{2,62}$/);
  });
});
