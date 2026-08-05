import type { OrganizationLifecycleDto } from "../dto/organization-dto.js";

export interface CreateOrganizationCommand {
  type: "create_organization";
  commandId: string;
  organizationName: string;
  initiatorId: string;
  externalReference?: string;
  metadata?: Readonly<Record<string, string>>;
}

export interface ActivateOrganizationCommand extends OrganizationLifecycleDto {
  type: "activate_organization";
  commandId: string;
}

export interface SuspendOrganizationCommand extends OrganizationLifecycleDto {
  type: "suspend_organization";
  commandId: string;
  reason: string;
}

export interface ArchiveOrganizationCommand extends OrganizationLifecycleDto {
  type: "archive_organization";
  commandId: string;
  reason: string;
}

export interface DeleteOrganizationCommand extends OrganizationLifecycleDto {
  type: "delete_organization";
  commandId: string;
  reason: string;
}

export type OrganizationCommand =
  | CreateOrganizationCommand
  | ActivateOrganizationCommand
  | SuspendOrganizationCommand
  | ArchiveOrganizationCommand
  | DeleteOrganizationCommand;
