import type { OrganizationProvisioningRequest } from "@departify/provisioning-engine";
import type {
  ActivateOrganizationCommand,
  ArchiveOrganizationCommand,
  CreateOrganizationCommand,
  DeleteOrganizationCommand,
  SuspendOrganizationCommand,
} from "../commands/organization-commands.js";
import type {
  ApplicationOrchestrationIntent,
  OrganizationLifecyclePayload,
} from "../ports/application-ports.js";

export function createOrganizationCommandToProvisioningRequest(
  command: CreateOrganizationCommand,
): OrganizationProvisioningRequest {
  return {
    requestedBy: command.initiatorId,
    organizationName: command.organizationName,
    ...(command.externalReference === undefined
      ? {}
      : { externalReference: command.externalReference }),
    ...(command.metadata === undefined ? {} : { metadata: command.metadata }),
  };
}

export function activateOrganizationCommandToIntent(
  command: ActivateOrganizationCommand,
): ApplicationOrchestrationIntent<OrganizationLifecyclePayload> {
  return {
    operation: "organization.activate",
    payload: {
      organizationId: command.organizationId,
    },
  };
}

export function suspendOrganizationCommandToIntent(
  command: SuspendOrganizationCommand,
): ApplicationOrchestrationIntent<OrganizationLifecyclePayload> {
  return reasonedLifecycleIntent("organization.suspend", command);
}

export function archiveOrganizationCommandToIntent(
  command: ArchiveOrganizationCommand,
): ApplicationOrchestrationIntent<OrganizationLifecyclePayload> {
  return reasonedLifecycleIntent("organization.archive", command);
}

export function deleteOrganizationCommandToIntent(
  command: DeleteOrganizationCommand,
): ApplicationOrchestrationIntent<OrganizationLifecyclePayload> {
  return reasonedLifecycleIntent("organization.delete", command);
}

function reasonedLifecycleIntent(
  operation:
    "organization.suspend" | "organization.archive" | "organization.delete",
  command:
    | SuspendOrganizationCommand
    | ArchiveOrganizationCommand
    | DeleteOrganizationCommand,
): ApplicationOrchestrationIntent<OrganizationLifecyclePayload> {
  return {
    operation,
    payload: {
      organizationId: command.organizationId,
      reason: command.reason,
    },
  };
}
