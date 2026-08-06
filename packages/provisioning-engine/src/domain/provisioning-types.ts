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
  | "instantiate_business"
  | "mark_organization_ready";

export interface OrganizationProvisioningRequest {
  requestedBy: string;
  organizationName: string;
  externalReference?: string;
  metadata?: Readonly<Record<string, string>>;
  /**
   * Optional business provisioning hints. The Sprint 25 business
   * provisioning step reads `departmentTemplateId` to select the
   * canonical DepartmentTemplate from the catalog. When omitted the
   * provisioning service uses the platform default.
   */
  business?: {
    readonly departmentTemplateId?: string;
  };
}

export interface ProvisioningIssue {
  code: string;
  message: string;
  field?: keyof OrganizationProvisioningRequest;
}

/**
 * Snapshot of the business provisioned from the DepartmentTemplateCatalog.
 * Sprint 25 ships this typed envelope so hosts can reason about the
 * shape of a provisioned organisation end-to-end.
 */
export interface BusinessProvisioningResource {
  readonly kind:
    | "tool"
    | "knowledge_collection"
    | "memory_session"
    | "connected_application";
  readonly referenceId: string;
  readonly label?: string;
}

export interface BusinessProvisioningEmployee {
  readonly agentId: string;
  readonly displayName: string;
  readonly role: string;
  readonly isDirector: boolean;
}

export interface BusinessProvisioningDepartment {
  readonly departmentId: string;
  readonly templateId: string;
  readonly name: string;
  readonly status: string;
  readonly directorAgentId: string | null;
  readonly employees: readonly BusinessProvisioningEmployee[];
  readonly resources: readonly BusinessProvisioningResource[];
}

export interface BusinessProvisioningResult {
  readonly provisioningId: ProvisioningId;
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly templateIds: readonly string[];
  readonly departments: readonly BusinessProvisioningDepartment[];
  readonly issues: readonly ProvisioningIssue[];
  readonly completedAt: string;
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
