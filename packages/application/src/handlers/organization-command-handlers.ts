import {
  activateOrganizationCommandToIntent,
  archiveOrganizationCommandToIntent,
  createOrganizationCommandToProvisioningRequest,
  deleteOrganizationCommandToIntent,
  suspendOrganizationCommandToIntent,
} from "../mappers/organization-command-mapper.js";
import type {
  ActivateOrganizationCommand,
  ArchiveOrganizationCommand,
  CreateOrganizationCommand,
  DeleteOrganizationCommand,
  SuspendOrganizationCommand,
} from "../commands/organization-commands.js";
import type {
  ApplicationHandlerResult,
  ApplicationOrchestrationIntent,
  OrganizationCommandPort,
  OrganizationLifecyclePayload,
} from "../ports/application-ports.js";
import {
  validateActivateOrganizationCommand,
  validateArchiveOrganizationCommand,
  validateCreateOrganizationCommand,
  validateDeleteOrganizationCommand,
  validateSuspendOrganizationCommand,
} from "../validation/command-validation.js";
import type { OrganizationProvisioningRequest } from "@departify/provisioning-engine";

export class CreateOrganizationHandler {
  constructor(private readonly port: OrganizationCommandPort) {}

  handle(
    command: CreateOrganizationCommand,
  ): ApplicationHandlerResult<
    ApplicationOrchestrationIntent<OrganizationProvisioningRequest>
  > {
    const validCommand = validateCreateOrganizationCommand(command);
    const request =
      createOrganizationCommandToProvisioningRequest(validCommand);

    return {
      ok: true,
      value: this.port.prepareCreateOrganization(request),
    };
  }
}

export class ActivateOrganizationHandler {
  constructor(private readonly port: OrganizationCommandPort) {}

  handle(
    command: ActivateOrganizationCommand,
  ): ApplicationHandlerResult<
    ApplicationOrchestrationIntent<OrganizationLifecyclePayload>
  > {
    const intent = activateOrganizationCommandToIntent(
      validateActivateOrganizationCommand(command),
    );

    return {
      ok: true,
      value: this.port.prepareLifecycleOperation(intent),
    };
  }
}

export class SuspendOrganizationHandler {
  constructor(private readonly port: OrganizationCommandPort) {}

  handle(
    command: SuspendOrganizationCommand,
  ): ApplicationHandlerResult<
    ApplicationOrchestrationIntent<OrganizationLifecyclePayload>
  > {
    const intent = suspendOrganizationCommandToIntent(
      validateSuspendOrganizationCommand(command),
    );

    return {
      ok: true,
      value: this.port.prepareLifecycleOperation(intent),
    };
  }
}

export class ArchiveOrganizationHandler {
  constructor(private readonly port: OrganizationCommandPort) {}

  handle(
    command: ArchiveOrganizationCommand,
  ): ApplicationHandlerResult<
    ApplicationOrchestrationIntent<OrganizationLifecyclePayload>
  > {
    const intent = archiveOrganizationCommandToIntent(
      validateArchiveOrganizationCommand(command),
    );

    return {
      ok: true,
      value: this.port.prepareLifecycleOperation(intent),
    };
  }
}

export class DeleteOrganizationHandler {
  constructor(private readonly port: OrganizationCommandPort) {}

  handle(
    command: DeleteOrganizationCommand,
  ): ApplicationHandlerResult<
    ApplicationOrchestrationIntent<OrganizationLifecyclePayload>
  > {
    const intent = deleteOrganizationCommandToIntent(
      validateDeleteOrganizationCommand(command),
    );

    return {
      ok: true,
      value: this.port.prepareLifecycleOperation(intent),
    };
  }
}
