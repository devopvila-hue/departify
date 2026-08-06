import { WorkflowBuilder } from "../builder/workflow-builder.js";
import type { WorkflowDefinition } from "../workflow-types.js";

/**
 * Sprint 43 canonical workflow — `Department Delegation`.
 *
 * The first automatic Director delegation: the Sales Director
 * (`agent_sales_director`) runs the `discovery.delegate` Tool (Sprint 43)
 * to assign the discovery plan items to the competent Digital Employees of
 * the Department. Deterministic delegation — no IA.
 *
 * The workflow is a factory parameterised by `organizationId`, mirroring
 * the Business Briefing, Readiness and Plan workflows.
 */
export const DEPARTMENT_DELEGATION_WORKFLOW_ID = "wf_department_delegation";

export function buildDepartmentDelegationWorkflow(
  organizationId: string,
): WorkflowDefinition {
  return WorkflowBuilder.create({
    id: DEPARTMENT_DELEGATION_WORKFLOW_ID,
    name: "Department Delegation",
    description:
      "The Sales Director delegates the discovery plan items to the competent Digital Employees of the Department.",
    metadata: {
      workflow_family: "business_intelligence",
      department: "comercial",
    },
  })
    .withStep({
      id: "department_delegation",
      name: "Delegate Department Work",
      description:
        "Sales Director assigns each discovery question to the competent Digital Employee.",
      agentId: "agent_sales_director",
      toolId: "discovery.delegate",
      args: { organizationId },
      contextMapping: {
        previousOutputKey: "previous_output",
        previousActionIdKey: "previous_action_id",
        previousStatusKey: "previous_status",
        staticMetadata: {
          workflow_step: "department_delegation",
        },
      },
    })
    .build();
}

/**
 * Convenience export kept for tests. Hosts must use the parameterised
 * factory instead.
 */
export const DEPARTMENT_DELEGATION_WORKFLOW =
  buildDepartmentDelegationWorkflow("org_default");
