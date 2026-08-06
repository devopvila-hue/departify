import { WorkflowBuilder } from "../builder/workflow-builder.js";
import type { WorkflowDefinition } from "../workflow-types.js";

/**
 * Sprint 40 canonical workflow — `Business Briefing`.
 *
 * The first useful work a freshly provisioned Department performs: the
 * Sales Director (`agent_sales_director`) reads the Business Discovery
 * report of the organization through the `discovery.get` Tool (Sprint 37)
 * and produces the first business briefing. This exercises the knowledge
 * of the company collected by the discovery flow (Sprints 28-38).
 *
 * The workflow is a factory parameterised by `organizationId` because the
 * briefing targets a concrete organization; the host supplies it when the
 * Empresa Digital is created.
 */
export const BUSINESS_BRIEFING_WORKFLOW_ID = "wf_business_briefing";

export function buildBusinessBriefingWorkflow(
  organizationId: string,
): WorkflowDefinition {
  return WorkflowBuilder.create({
    id: BUSINESS_BRIEFING_WORKFLOW_ID,
    name: "Business Briefing",
    description:
      "The Sales Director reads the Business Discovery report of the organization to produce the first business briefing.",
    metadata: {
      workflow_family: "business_intelligence",
      department: "comercial",
    },
  })
    .withStep({
      id: "briefing",
      name: "Read Business Briefing",
      description:
        "Sales Director fetches the most recent discovery report of the organization.",
      agentId: "agent_sales_director",
      toolId: "discovery.get",
      args: { organizationId },
      contextMapping: {
        previousOutputKey: "previous_output",
        previousActionIdKey: "previous_action_id",
        previousStatusKey: "previous_status",
        staticMetadata: {
          workflow_step: "briefing",
        },
      },
    })
    .build();
}

/**
 * Convenience export kept for tests that need a workflow instance without
 * binding to a specific organization at import time. Hosts must use the
 * parameterised factory instead.
 */
export const BUSINESS_BRIEFING_WORKFLOW = buildBusinessBriefingWorkflow(
  "org_default",
);
