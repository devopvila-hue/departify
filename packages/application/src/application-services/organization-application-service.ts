import type {
  ActivateOrganizationCommand,
  ArchiveOrganizationCommand,
  CreateOrganizationCommand,
  DeleteOrganizationCommand,
  SuspendOrganizationCommand,
} from "../commands/organization-commands.js";
import {
  ActivateOrganizationHandler,
  ArchiveOrganizationHandler,
  CreateOrganizationHandler,
  DeleteOrganizationHandler,
  SuspendOrganizationHandler,
} from "../handlers/organization-command-handlers.js";
import {
  GetOrganizationHandler,
  GetProvisioningStatusHandler,
  ListOrganizationsHandler,
} from "../handlers/organization-query-handlers.js";
import type {
  GetOrganizationQuery,
  GetProvisioningStatusQuery,
  ListOrganizationsQuery,
} from "../queries/organization-queries.js";
import type {
  OrganizationCommandPort,
  OrganizationQueryPort,
  ProvisioningQueryPort,
} from "../ports/application-ports.js";

export interface OrganizationApplicationServicePorts {
  organizationCommand: OrganizationCommandPort;
  organizationQuery: OrganizationQueryPort;
  provisioningQuery: ProvisioningQueryPort;
}

export class OrganizationApplicationService {
  private readonly createOrganizationHandler: CreateOrganizationHandler;
  private readonly activateOrganizationHandler: ActivateOrganizationHandler;
  private readonly suspendOrganizationHandler: SuspendOrganizationHandler;
  private readonly archiveOrganizationHandler: ArchiveOrganizationHandler;
  private readonly deleteOrganizationHandler: DeleteOrganizationHandler;
  private readonly getOrganizationHandler: GetOrganizationHandler;
  private readonly listOrganizationsHandler: ListOrganizationsHandler;
  private readonly getProvisioningStatusHandler: GetProvisioningStatusHandler;

  constructor(ports: OrganizationApplicationServicePorts) {
    this.createOrganizationHandler = new CreateOrganizationHandler(
      ports.organizationCommand,
    );
    this.activateOrganizationHandler = new ActivateOrganizationHandler(
      ports.organizationCommand,
    );
    this.suspendOrganizationHandler = new SuspendOrganizationHandler(
      ports.organizationCommand,
    );
    this.archiveOrganizationHandler = new ArchiveOrganizationHandler(
      ports.organizationCommand,
    );
    this.deleteOrganizationHandler = new DeleteOrganizationHandler(
      ports.organizationCommand,
    );
    this.getOrganizationHandler = new GetOrganizationHandler(
      ports.organizationQuery,
    );
    this.listOrganizationsHandler = new ListOrganizationsHandler(
      ports.organizationQuery,
    );
    this.getProvisioningStatusHandler = new GetProvisioningStatusHandler(
      ports.provisioningQuery,
    );
  }

  createOrganization(command: CreateOrganizationCommand) {
    return this.createOrganizationHandler.handle(command);
  }

  activateOrganization(command: ActivateOrganizationCommand) {
    return this.activateOrganizationHandler.handle(command);
  }

  suspendOrganization(command: SuspendOrganizationCommand) {
    return this.suspendOrganizationHandler.handle(command);
  }

  archiveOrganization(command: ArchiveOrganizationCommand) {
    return this.archiveOrganizationHandler.handle(command);
  }

  deleteOrganization(command: DeleteOrganizationCommand) {
    return this.deleteOrganizationHandler.handle(command);
  }

  getOrganization(query: GetOrganizationQuery) {
    return this.getOrganizationHandler.handle(query);
  }

  listOrganizations(query: ListOrganizationsQuery) {
    return this.listOrganizationsHandler.handle(query);
  }

  getProvisioningStatus(query: GetProvisioningStatusQuery) {
    return this.getProvisioningStatusHandler.handle(query);
  }
}
