import type { ProvisioningStepId } from "../domain/provisioning-types.js";

export interface ProvisioningPipelineStep {
  id: ProvisioningStepId;
  order: number;
  requiredState: "validating" | "planning" | "in_progress";
  description: string;
  implemented: false;
}

export const provisioningPipeline = [
  {
    id: "validate_request",
    order: 1,
    requiredState: "validating",
    description: "Validate that the provisioning request can enter the engine.",
    implemented: false,
  },
  {
    id: "create_organization",
    order: 2,
    requiredState: "in_progress",
    description: "Create the organization boundary.",
    implemented: false,
  },
  {
    id: "initialize_configuration",
    order: 3,
    requiredState: "in_progress",
    description: "Initialize organization-scoped configuration.",
    implemented: false,
  },
  {
    id: "prepare_storage",
    order: 4,
    requiredState: "in_progress",
    description: "Prepare organization-scoped storage resources.",
    implemented: false,
  },
  {
    id: "prepare_memory",
    order: 5,
    requiredState: "in_progress",
    description: "Prepare organization-scoped memory resources.",
    implemented: false,
  },
  {
    id: "prepare_rag",
    order: 6,
    requiredState: "in_progress",
    description: "Prepare retrieval resources for the organization.",
    implemented: false,
  },
  {
    id: "register_plugins",
    order: 7,
    requiredState: "in_progress",
    description: "Register organization-scoped plugin capabilities.",
    implemented: false,
  },
  {
    id: "register_agent_runtime",
    order: 8,
    requiredState: "in_progress",
    description: "Register the organization with the future Agent Runtime.",
    implemented: false,
  },
  {
    id: "activate_executive_director",
    order: 9,
    requiredState: "in_progress",
    description: "Activate the future Executive Director boundary.",
    implemented: false,
  },
  {
    id: "mark_organization_ready",
    order: 10,
    requiredState: "in_progress",
    description:
      "Mark the organization as ready after all future phases succeed.",
    implemented: false,
  },
] as const satisfies readonly ProvisioningPipelineStep[];

export const provisioningPipelineStepIds = provisioningPipeline.map(
  (step) => step.id,
);

export function getProvisioningStep(
  id: ProvisioningStepId,
): ProvisioningPipelineStep | undefined {
  return provisioningPipeline.find((step) => step.id === id);
}
