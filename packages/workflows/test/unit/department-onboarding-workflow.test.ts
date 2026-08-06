import {
  buildDepartmentOnboardingWorkflow,
  DEPARTMENT_ONBOARDING_WORKFLOW,
  DEPARTMENT_ONBOARDING_WORKFLOW_ID,
  validateWorkflowDefinition,
} from "../../src/index.js";

describe("Department Onboarding Workflow", () => {
  it("builds the canonical workflow with six ordered steps", () => {
    const workflow = buildDepartmentOnboardingWorkflow(
      "org_departify",
      "agent_lead_qualifier",
    );
    expect(workflow.id).toBe(DEPARTMENT_ONBOARDING_WORKFLOW_ID);
    expect(workflow.steps).toHaveLength(6);

    expect(workflow.steps.map((step) => step.id)).toEqual([
      "briefing",
      "readiness",
      "plan",
      "delegation",
      "first_work",
      "first_result",
    ]);

    // Director executes the first four steps.
    expect(workflow.steps.slice(0, 4).every((s) => s.agentId === "agent_sales_director")).toBe(true);
    // Delegated employee executes the last two steps.
    expect(workflow.steps[4]?.agentId).toBe("agent_lead_qualifier");
    expect(workflow.steps[5]?.agentId).toBe("agent_lead_qualifier");

    expect(workflow.steps.map((step) => step.toolId)).toEqual([
      "discovery.get",
      "discovery.readiness",
      "discovery.plan",
      "discovery.delegate",
      "discovery.get",
      "discovery.summary",
    ]);

    expect(DEPARTMENT_ONBOARDING_WORKFLOW.id).toBe(
      DEPARTMENT_ONBOARDING_WORKFLOW_ID,
    );
  });

  it("passes validation", () => {
    const workflow = buildDepartmentOnboardingWorkflow(
      "org_departify",
      "agent_lead_qualifier",
    );
    expect(validateWorkflowDefinition(workflow).id).toBe(
      DEPARTMENT_ONBOARDING_WORKFLOW_ID,
    );
  });

  it("has an id matching the canonical workflow pattern", () => {
    expect(DEPARTMENT_ONBOARDING_WORKFLOW_ID).toMatch(
      /^wf_[a-z][a-z0-9_]{2,62}$/,
    );
  });
});
