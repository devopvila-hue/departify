import {
  buildBusinessBriefingWorkflow,
  BUSINESS_BRIEFING_WORKFLOW,
  BUSINESS_BRIEFING_WORKFLOW_ID,
  validateWorkflowDefinition,
} from "../../src/index.js";

describe("Business Briefing Workflow", () => {
  it("builds the canonical workflow with a single discovery.get step", () => {
    const workflow = buildBusinessBriefingWorkflow("org_departify");
    expect(workflow.id).toBe(BUSINESS_BRIEFING_WORKFLOW_ID);
    expect(workflow.steps).toHaveLength(1);
    const step = workflow.steps[0];
    expect(step?.agentId).toBe("agent_sales_director");
    expect(step?.toolId).toBe("discovery.get");
    expect(step?.args).toEqual({ organizationId: "org_departify" });
    expect(BUSINESS_BRIEFING_WORKFLOW.id).toBe(BUSINESS_BRIEFING_WORKFLOW_ID);
  });

  it("passes validation", () => {
    const workflow = buildBusinessBriefingWorkflow("org_departify");
    expect(validateWorkflowDefinition(workflow).id).toBe(
      BUSINESS_BRIEFING_WORKFLOW_ID,
    );
  });

  it("has an id matching the canonical workflow pattern", () => {
    expect(BUSINESS_BRIEFING_WORKFLOW_ID).toMatch(/^wf_[a-z][a-z0-9_]{2,62}$/);
  });
});
