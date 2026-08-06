import { WorkflowBuilder } from "../builder/workflow-builder.js";
import type { WorkflowDefinition } from "../workflow-types.js";

/**
 * Sprint 42 canonical workflow — `Department Plan`.
 *
 * The first automatic Department planning decision: the Sales Director
 * (`agent_sales_director`) runs the `discovery.plan` Tool (Sprint 42) to
 * build the first work plan of the Department from the discovery questions
 * of the most recent Business Discovery report. Deterministic planning —
 * no IA.
 *
 * The workflow is a factory parameterised by `organizationId`, mirroring
 * the Business Briefing and Business Readiness workflows.
 */
export const DEPARTMENT_PLAN_WORKFLOW_ID = "wf_department_plan";

export function buildDepartmentPlanWorkflow(
  organizationId: string,
): WorkflowDefinition {
  return WorkflowBuilder.create({
    id: DEPARTMENT_PLAN_WORKFLOW_ID,
    name: "Department Plan",
    description:
      "The Sales Director builds the first work plan of the Department from the discovery questions of the organization.",
    metadata: {
      workflow_family: "business_intelligence",
      department: "comercial",
    },
  })
    .withStep({
      id: "department_planning",
      name: "Build Department Plan",
      description:
        "Sales Director orders the discovery questions by priority to plan the first Department work.",
      agentId: "agent_sales_director",
      toolId: "discovery.plan",
      args: { organizationId },
      contextMapping: {
        previousOutputKey: "previous_output",
        previousActionIdKey: "previous_action_id",
        previousStatusKey: "previous_status",
        staticMetadata: {
          workflow_step: "department_planning",
        },
      },
    })
    .build();
}

/**
 * Convenience export kept for tests. Hosts must use the parameterised
 * factory instead.
 */
export const DEPARTMENT_PLAN_WORKFLOW = buildDepartmentPlanWorkflow(
  "org_default",
);
