import { WorkflowBuilder } from "../builder/workflow-builder.js";
import type { WorkflowDefinition } from "../workflow-types.js";

/**
 * Sprint 26 canonical workflow — `Lead Qualification`.
 *
 * The Comercial department runs this workflow when a new lead arrives.
 * Each step delegates to a different Digital Employee through the
 * AgentToolBridge:
 *
 *   1. Qualify Lead      — agent_lead_qualifier   → system.uuid (qualified_lead_id)
 *   2. Prepare Contact   — agent_outreach_specialist → system.uuid (contact_id)
 *   3. Generate Proposal — agent_proposal_writer    → system.uuid (proposal_id)
 *
 * The previous step's output is threaded into the next step's metadata as
 * `previous_output`, `previous_action_id` and `previous_status` so every
 * step receives a typed context chain.
 */
export const LEAD_QUALIFICATION_WORKFLOW_ID = "wf_lead_qualification";

export function buildLeadQualificationWorkflow(): WorkflowDefinition {
  return WorkflowBuilder.create({
    id: LEAD_QUALIFICATION_WORKFLOW_ID,
    name: "Lead Qualification",
    description:
      "Qualify a lead, prepare the contact and generate a proposal using the Comercial Digital Employees.",
    metadata: {
      workflow_family: "sales",
      department: "comercial",
    },
  })
    .withStep({
      id: "qualify_lead",
      name: "Qualify Lead",
      description:
        "Lead Qualifier generates a qualified_lead_id that the next step consumes.",
      agentId: "agent_lead_qualifier",
      toolId: "system.uuid",
      args: {},
      contextMapping: {
        previousOutputKey: "previous_output",
        previousActionIdKey: "previous_action_id",
        previousStatusKey: "previous_status",
        staticMetadata: {
          workflow_step: "qualify_lead",
        },
      },
    })
    .withStep({
      id: "prepare_contact",
      name: "Prepare Contact",
      description:
        "Outreach Specialist produces the contact_id for the proposal stage.",
      agentId: "agent_outreach_specialist",
      toolId: "system.uuid",
      args: {},
      contextMapping: {
        previousOutputKey: "qualified_lead_id",
        previousActionIdKey: "qualified_lead_action_id",
        previousStatusKey: "qualified_lead_status",
        staticMetadata: {
          workflow_step: "prepare_contact",
        },
      },
    })
    .withStep({
      id: "generate_proposal",
      name: "Generate Proposal",
      description:
        "Proposal Writer finalises the deal by emitting the proposal_id.",
      agentId: "agent_proposal_writer",
      toolId: "system.uuid",
      args: {},
      contextMapping: {
        previousOutputKey: "contact_id",
        previousActionIdKey: "contact_action_id",
        previousStatusKey: "contact_status",
        staticMetadata: {
          workflow_step: "generate_proposal",
        },
      },
    })
    .build();
}

/**
 * Convenience export of the canonical workflow id.
 */
export const LEAD_QUALIFICATION_WORKFLOW = buildLeadQualificationWorkflow();
