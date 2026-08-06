import { WorkflowBuilder } from "../builder/workflow-builder.js";
import type { WorkflowDefinition } from "../workflow-types.js";

/**
 * Sprint 45 canonical workflow — `First Result`.
 *
 * The first useful result produced by a Digital Employee: after executing
 * its first work (Sprint 44), the delegated employee runs the
 * `discovery.summary` Tool (Sprint 45) to derive a deterministic executive
 * summary of the business. No IA, no generated text.
 *
 * The workflow is a factory parameterised by `organizationId` and `agentId`,
 * mirroring the First Work workflow.
 */
export const FIRST_RESULT_WORKFLOW_ID = "wf_first_result";

export function buildFirstResultWorkflow(
  organizationId: string,
  agentId: string,
): WorkflowDefinition {
  return WorkflowBuilder.create({
    id: FIRST_RESULT_WORKFLOW_ID,
    name: "First Result",
    description:
      "A Digital Employee produces its first useful result: the executive summary of the organization's discovery.",
    metadata: {
      workflow_family: "business_intelligence",
      department: "comercial",
    },
  })
    .withStep({
      id: "first_result",
      name: "Produce Business Summary",
      description:
        "The delegated Digital Employee derives the deterministic executive summary of the business.",
      agentId,
      toolId: "discovery.summary",
      args: { organizationId },
      contextMapping: {
        previousOutputKey: "previous_output",
        previousActionIdKey: "previous_action_id",
        previousStatusKey: "previous_status",
        staticMetadata: {
          workflow_step: "first_result",
        },
      },
    })
    .build();
}

/**
 * Convenience export kept for tests. Hosts must use the parameterised
 * factory instead.
 */
export const FIRST_RESULT_WORKFLOW = buildFirstResultWorkflow(
  "org_default",
  "agent_sales_director",
);
