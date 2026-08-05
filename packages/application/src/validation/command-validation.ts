import {
  assertApplicationValid,
  assertNonEmptyText,
} from "./application-error.js";
import type {
  ActivateOrganizationCommand,
  ArchiveOrganizationCommand,
  CreateOrganizationCommand,
  DeleteOrganizationCommand,
  SuspendOrganizationCommand,
} from "../commands/organization-commands.js";

export function validateCreateOrganizationCommand(
  command: CreateOrganizationCommand,
): CreateOrganizationCommand {
  return {
    type: command.type,
    commandId: assertNonEmptyText(command.commandId, "commandId"),
    organizationName: assertNonEmptyText(
      command.organizationName,
      "organizationName",
    ),
    initiatorId: assertNonEmptyText(command.initiatorId, "initiatorId"),
    ...(command.externalReference === undefined
      ? {}
      : {
          externalReference: assertNonEmptyText(
            command.externalReference,
            "externalReference",
          ),
        }),
    ...(command.metadata === undefined ? {} : { metadata: command.metadata }),
  };
}

export function validateActivateOrganizationCommand(
  command: ActivateOrganizationCommand,
): ActivateOrganizationCommand {
  return {
    type: command.type,
    commandId: assertNonEmptyText(command.commandId, "commandId"),
    organizationId: assertNonEmptyText(
      command.organizationId,
      "organizationId",
    ),
  };
}

export function validateSuspendOrganizationCommand(
  command: SuspendOrganizationCommand,
): SuspendOrganizationCommand {
  return validateReasonedLifecycleCommand(command);
}

export function validateArchiveOrganizationCommand(
  command: ArchiveOrganizationCommand,
): ArchiveOrganizationCommand {
  return validateReasonedLifecycleCommand(command);
}

export function validateDeleteOrganizationCommand(
  command: DeleteOrganizationCommand,
): DeleteOrganizationCommand {
  return validateReasonedLifecycleCommand(command);
}

function validateReasonedLifecycleCommand<
  TCommand extends
    | SuspendOrganizationCommand
    | ArchiveOrganizationCommand
    | DeleteOrganizationCommand,
>(command: TCommand): TCommand {
  const reason = assertNonEmptyText(command.reason, "reason");
  assertApplicationValid(
    reason.length >= 3 && reason.length <= 240,
    "reason must be between 3 and 240 characters.",
  );
  return {
    ...command,
    commandId: assertNonEmptyText(command.commandId, "commandId"),
    organizationId: assertNonEmptyText(
      command.organizationId,
      "organizationId",
    ),
    reason,
  };
}
