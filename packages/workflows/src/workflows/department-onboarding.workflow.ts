import { WorkflowBuilder } from "../builder/workflow-builder.js";
import type { WorkflowDefinition } from "../workflow-types.js";

/**
 * Sprint 47 canonical workflow — `Department Onboarding`.
 *
 * The Vending Machine step: a single trigger that runs the whole work
 * pipeline of a freshly provisioned Department and delivers its first value.
 *
 *  1. briefing    — Director reads the discovery report (discovery.get)
 *  2. readiness   — Director decides go/no-go (discovery.readiness)
 *  3. plan        — Director builds the work plan (discovery.plan)
 *  4. delegation  — Director assigns the plan to the competent employees (discovery.delegate)
 *  5. first_work  — Employee executes its first useful work (discovery.get)
 *  6. first_result— Employee produces the first useful result (discovery.summary)
 *
 * The `finalOutput` of the last step is the first value delivered by the
 * Empresa Digital. The workflow is a factory parameterised by
 * `organizationId`, `directorAgentId` (Sprint 52 — the Director of the
 * contracted Department, so Marketing learns the business with its own
 * director) and `employeeAgentId` (the delegated employee that received the
 * highest-priority item).
 */
export const DEPARTMENT_ONBOARDING_WORKFLOW_ID = "wf_department_onboarding";

export function buildDepartmentOnboardingWorkflow(
  organizationId: string,
  directorAgentId: string,
  employeeAgentId: string,
): WorkflowDefinition {
  return WorkflowBuilder.create({
    id: DEPARTMENT_ONBOARDING_WORKFLOW_ID,
    name: "Department Onboarding",
    description:
      "Runs the full Department pipeline from briefing to first delivered value.",
    metadata: {
      workflow_family: "business_intelligence",
      department: "comercial",
    },
  })
    .withStep({
      id: "briefing",
      name: "Business Briefing",
      description: "Director reads the discovery report of the organization.",
      agentId: directorAgentId,
      toolId: "discovery.get",
      args: { organizationId },
    })
    .withStep({
      id: "readiness",
      name: "Business Readiness",
      description: "Director decides whether the Empresa Digital is ready to operate.",
      agentId: directorAgentId,
      toolId: "discovery.readiness",
      args: { organizationId },
    })
    .withStep({
      id: "plan",
      name: "Department Plan",
      description: "Director builds the first work plan of the Department.",
      agentId: directorAgentId,
      toolId: "discovery.plan",
      args: { organizationId },
    })
    .withStep({
      id: "delegation",
      name: "Department Delegation",
      description: "Director assigns the plan items to the competent employees.",
      agentId: directorAgentId,
      toolId: "discovery.delegate",
      args: { organizationId },
    })
    .withStep({
      id: "first_work",
      name: "First Work",
      description: "The delegated employee executes its first useful work.",
      agentId: employeeAgentId,
      toolId: "discovery.get",
      args: { organizationId },
    })
    .withStep({
      id: "first_result",
      name: "First Result",
      description:
        "The delegated employee produces the first useful result of the Department.",
      agentId: employeeAgentId,
      toolId: "discovery.summary",
      args: { organizationId },
    })
    .build();
}

/**
 * Convenience export kept for tests. Hosts must use the parameterised
 * factory instead.
 */
export const DEPARTMENT_ONBOARDING_WORKFLOW =
  buildDepartmentOnboardingWorkflow(
    "org_default",
    "agent_sales_director",
    "agent_lead_qualifier",
  );
