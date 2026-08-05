import type {
  OrganizationProvisioningRequest,
  ProvisioningIssue,
} from "../domain/provisioning-types.js";

export interface ProvisioningRequestValidationResult {
  valid: boolean;
  issues: readonly ProvisioningIssue[];
}

export function validateProvisioningRequest(
  request: OrganizationProvisioningRequest,
): ProvisioningRequestValidationResult {
  const issues: ProvisioningIssue[] = [];

  if (request.organizationName.trim().length === 0) {
    issues.push({
      code: "ORGANIZATION_NAME_REQUIRED",
      field: "organizationName",
      message: "Organization name is required.",
    });
  }

  if (request.requestedBy.trim().length === 0) {
    issues.push({
      code: "REQUESTED_BY_REQUIRED",
      field: "requestedBy",
      message: "Requester is required.",
    });
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
