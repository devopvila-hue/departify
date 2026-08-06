import { WorkflowBuilder } from "../builder/workflow-builder.js";
import type { WorkflowDefinition } from "../workflow-types.js";

/**
 * Sprint 41 canonical workflow — `Business Readiness`.
 *
 * The first automatic decision a Digital Employee takes from the Business
 * Briefing (Sprint 40): the Sales Director (`agent_sales_director`) runs the
 * `discovery.readiness` Tool (Sprint 41) to decide whether the Empresa
 * Digital is ready to operate, based on the most recent Business Discovery
 * report of the organization. Deterministic go/no-go — no IA.
 *
 * The workflow is a factory parameterised by `organizationId`, mirroring the
 * Business Briefing workflow.
 */
export const BUSINESS_READINESS_WORKFLOW_ID = "wf_business_readiness";

export function buildBusinessReadinessWorkflow(
  organizationId: string,
): WorkflowDefinition {
  return WorkflowBuilder.create({
    id: BUSINESS_READINESS_WORKFLOW_ID,
    name: "Business Readiness",
    description:
      "The Sales Director decides whether the Empresa Digital is ready to operate based on the Business Discovery report.",
    metadata: {
      workflow_family: "business_intelligence",
      department: "comercial",
    },
  })
    .withStep({
      id: "readiness_decision",
      name: "Decide Business Readiness",
      description:
        "Sales Director evaluates the discovery report and decides go/no-go.",
      agentId: "agent_sales_director",
      toolId: "discovery.readiness",
      args: { organizationId },
      contextMapping: {
        previousOutputKey: "previous_output",
        previousActionIdKey: "previous_action_id",
        previousStatusKey: "previous_status",
        staticMetadata: {
          workflow_step: "readiness_decision",
        },
      },
    })
    .build();
}

/**
 * Convenience export kept for tests. Hosts must use the parameterised
 * factory instead.
 */
export const BUSINESS_READINESS_WORKFLOW = buildBusinessReadinessWorkflow(
  "org_default",
);
