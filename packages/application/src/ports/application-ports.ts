import type {
  OrganizationProvisioningRequest,
  ProvisioningOperationResult,
} from "@departify/provisioning-engine";
import type {
  OrganizationDto,
  OrganizationListDto,
} from "../dto/organization-dto.js";
import type { ProvisioningStatusDto } from "../dto/provisioning-dto.js";

export type ApplicationOperation =
  | "provisioning.create_organization"
  | "organization.activate"
  | "organization.suspend"
  | "organization.archive"
  | "organization.delete";

export interface ApplicationOrchestrationIntent<TPayload> {
  operation: ApplicationOperation;
  payload: TPayload;
}

export interface OrganizationCommandPort {
  prepareCreateOrganization(
    request: OrganizationProvisioningRequest,
  ): ApplicationOrchestrationIntent<OrganizationProvisioningRequest>;
  prepareLifecycleOperation(
    intent: ApplicationOrchestrationIntent<OrganizationLifecyclePayload>,
  ): ApplicationOrchestrationIntent<OrganizationLifecyclePayload>;
}

export interface OrganizationLifecyclePayload {
  organizationId: string;
  reason?: string;
}

export interface ProvisioningResultPort {
  toApplicationResult(
    result: ProvisioningOperationResult,
  ): ApplicationHandlerResult<ProvisioningOperationResult>;
}

export interface OrganizationQueryPort {
  getOrganization(organizationId: string): Promise<OrganizationDto | null>;
  listOrganizations(options: {
    cursor?: string;
    limit?: number;
  }): Promise<OrganizationListDto>;
}

export interface ProvisioningQueryPort {
  getProvisioningStatus(
    provisioningId: string,
  ): Promise<ProvisioningStatusDto | null>;
}

export type ApplicationHandlerResult<TValue> =
  | {
      ok: true;
      value: TValue;
    }
  | {
      ok: false;
      issues: readonly string[];
    };
