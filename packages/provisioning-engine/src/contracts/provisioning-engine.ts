import type {
  OrganizationProvisioningPlan,
  OrganizationProvisioningRequest,
  ProvisioningId,
  ProvisioningOperationResult,
} from "../domain/provisioning-types.js";
import type {
  ProvisioningResourcePlanner,
  ProvisioningStateStore,
} from "./ports.js";
import type { ProvisioningRequestValidationResult } from "../validation/provisioning-request.js";

export interface ProvisioningEngine {
  createOrganization(
    request: OrganizationProvisioningRequest,
  ): Promise<ProvisioningOperationResult>;
  validateRequest(
    request: OrganizationProvisioningRequest,
  ): ProvisioningRequestValidationResult;
  prepareResources(
    plan: OrganizationProvisioningPlan,
  ): Promise<ProvisioningOperationResult>;
  registerProvisioningState(plan: OrganizationProvisioningPlan): Promise<void>;
  finalizeProvisioning(
    id: ProvisioningId,
  ): Promise<ProvisioningOperationResult>;
  cancelProvisioning(id: ProvisioningId): Promise<ProvisioningOperationResult>;
}

export interface ProvisioningEnginePorts {
  stateStore: ProvisioningStateStore;
  resourcePlanners: readonly ProvisioningResourcePlanner[];
}
