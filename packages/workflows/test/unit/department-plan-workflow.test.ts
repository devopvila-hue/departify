import {
  buildDepartmentPlanWorkflow,
  DEPARTMENT_PLAN_WORKFLOW,
  DEPARTMENT_PLAN_WORKFLOW_ID,
  validateWorkflowDefinition,
} from "../../src/index.js";

describe("Department Plan Workflow", () => {
  it("builds the canonical workflow with a single discovery.plan step", () => {
    const workflow = buildDepartmentPlanWorkflow("org_departify");
    expect(workflow.id).toBe(DEPARTMENT_PLAN_WORKFLOW_ID);
    expect(workflow.steps).toHaveLength(1);
    const step = workflow.steps[0];
    expect(step?.agentId).toBe("agent_sales_director");
    expect(step?.toolId).toBe("discovery.plan");
    expect(step?.args).toEqual({ organizationId: "org_departify" });
    expect(DEPARTMENT_PLAN_WORKFLOW.id).toBe(DEPARTMENT_PLAN_WORKFLOW_ID);
  });

  it("passes validation", () => {
    const workflow = buildDepartmentPlanWorkflow("org_departify");
    expect(validateWorkflowDefinition(workflow).id).toBe(
      DEPARTMENT_PLAN_WORKFLOW_ID,
    );
  });

  it("has an id matching the canonical workflow pattern", () => {
    expect(DEPARTMENT_PLAN_WORKFLOW_ID).toMatch(/^wf_[a-z][a-z0-9_]{2,62}$/);
  });
});
