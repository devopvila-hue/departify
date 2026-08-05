import type { ProvisioningState } from "./provisioning-state.js";

export type ProvisioningId = string;

export type ProvisioningStepId =
  | "validate_request"
  | "create_organization"
  | "initialize_configuration"
  | "prepare_storage"
  | "prepare_memory"
  | "prepare_rag"
  | "register_plugins"
  | "register_agent_runtime"
  | "activate_executive_director"
  | "mark_organization_ready";

export interface OrganizationProvisioningRequest {
  requestedBy: string;
  organizationName: string;
  externalReference?: string;
  metadata?: Readonly<Record<string, string>>;
}

export interface ProvisioningIssue {
  code: string;
  message: string;
  field?: keyof OrganizationProvisioningRequest;
}

export interface OrganizationProvisioningPlan {
  id: ProvisioningId;
  request: OrganizationProvisioningRequest;
  steps: readonly ProvisioningStepId[];
}

export interface OrganizationProvisioningRecord {
  id: ProvisioningId;
  state: ProvisioningState;
  request: OrganizationProvisioningRequest;
  currentStep?: ProvisioningStepId;
  attempts: number;
  issues: readonly ProvisioningIssue[];
}

export interface ProvisioningOperationResult {
  id: ProvisioningId;
  state: ProvisioningState;
  accepted: boolean;
  issues: readonly ProvisioningIssue[];
}
