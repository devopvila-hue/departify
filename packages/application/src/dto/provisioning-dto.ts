import type {
  ProvisioningIssue,
  ProvisioningState,
  ProvisioningStepId,
} from "@departify/provisioning-engine";

export interface ProvisioningStatusDto {
  id: string;
  state: ProvisioningState;
  currentStep?: ProvisioningStepId;
  attempts: number;
  issues: readonly ProvisioningIssue[];
}
