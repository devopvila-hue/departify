import type {
  OrganizationProvisioningPlan,
  OrganizationProvisioningRecord,
  ProvisioningId,
  ProvisioningIssue,
  ProvisioningStepId,
} from "../domain/provisioning-types.js";
import type { ProvisioningState } from "../domain/provisioning-state.js";

export interface ProvisioningStateStore {
  read(id: ProvisioningId): Promise<OrganizationProvisioningRecord | null>;
  write(record: OrganizationProvisioningRecord): Promise<void>;
  transition(id: ProvisioningId, state: ProvisioningState): Promise<void>;
}

export interface ProvisioningResourcePreparation {
  step: ProvisioningStepId;
  issues: readonly ProvisioningIssue[];
}

export interface ProvisioningResourcePlanner {
  prepare(
    plan: OrganizationProvisioningPlan,
  ): Promise<ProvisioningResourcePreparation>;
}
