import { WorkflowBuilder } from "../builder/workflow-builder.js";
import type { WorkflowDefinition } from "../workflow-types.js";

/**
 * Sprint 44 canonical workflow — `First Work`.
 *
 * The first useful work executed by a Digital Employee: the delegated
 * employee (from the Department Delegation, Sprint 43) reads the Business
 * Discovery report of the organization through the `discovery.get` Tool
 * (Sprint 37) — knowing the business it is about to serve. Deterministic,
 * no IA.
 *
 * The workflow is a factory parameterised by `organizationId` and `agentId`:
 * the host builds it with the employee that received the highest-priority
 * delegation item.
 */
export const FIRST_WORK_WORKFLOW_ID = "wf_first_work";

export function buildFirstWorkWorkflow(
  organizationId: string,
  agentId: string,
): WorkflowDefinition {
  return WorkflowBuilder.create({
    id: FIRST_WORK_WORKFLOW_ID,
    name: "First Work",
    description:
      "A Digital Employee executes its first useful work: reading the Business Discovery report of the organization.",
    metadata: {
      workflow_family: "business_intelligence",
      department: "comercial",
    },
  })
    .withStep({
      id: "first_work",
      name: "Know the Business",
      description:
        "The delegated Digital Employee reads the most recent discovery report of the organization.",
      agentId,
      toolId: "discovery.get",
      args: { organizationId },
      contextMapping: {
        previousOutputKey: "previous_output",
        previousActionIdKey: "previous_action_id",
        previousStatusKey: "previous_status",
        staticMetadata: {
          workflow_step: "first_work",
        },
      },
    })
    .build();
}

/**
 * Convenience export kept for tests. Hosts must use the parameterised
 * factory instead.
 */
export const FIRST_WORK_WORKFLOW = buildFirstWorkWorkflow(
  "org_default",
  "agent_sales_director",
);
