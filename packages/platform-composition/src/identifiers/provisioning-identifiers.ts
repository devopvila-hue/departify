import type { CreateOrganizationCommand } from "@departify/application";
import type { OrganizationProvisioningRequest } from "@departify/provisioning-engine";

export interface ProvisioningIdentifiers {
  organizationId: string;
  workspaceId: string;
  provisioningId: string;
}

export function createProvisioningIdentifiers(
  command: CreateOrganizationCommand,
  request: OrganizationProvisioningRequest,
): ProvisioningIdentifiers {
  const nameSlug = toIdentifierSegment(request.organizationName);
  const commandSlug = toIdentifierSegment(command.commandId);
  const base = `${nameSlug}_${commandSlug}`.slice(0, 52);

  return {
    organizationId: `org_${base}`,
    workspaceId: `wsp_${base}_primary`.slice(0, 68),
    provisioningId: `prv_${base}`,
  };
}

function toIdentifierSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);

  return normalized.length >= 6 ? normalized : normalized.padEnd(6, "0");
}
