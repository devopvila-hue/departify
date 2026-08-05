import type { OrganizationStatus } from "@departify/organization-domain";

export interface BrandDto {
  displayName: string;
}

export interface LicenseDto {
  plan: string;
  seats: number;
}

export interface LimitsDto {
  maxWorkspaces: number;
  maxMembers: number;
}

export interface ContactInformationDto {
  email?: string;
  website?: string;
}

export interface OrganizationSettingsDto {
  timeZone: string;
  locale: string;
  limits: LimitsDto;
  featureFlags: Readonly<Record<string, boolean>>;
  contactInformation: ContactInformationDto;
}

export interface WorkspaceDto {
  id: string;
  name: string;
  status: string;
}

export interface OrganizationDto {
  id: string;
  name: string;
  status: OrganizationStatus;
  brand: BrandDto;
  license: LicenseDto;
  settings: OrganizationSettingsDto;
  workspaces: readonly WorkspaceDto[];
}

export interface OrganizationListDto {
  items: readonly OrganizationDto[];
  total: number;
}

export interface CreateOrganizationDto {
  organizationName: string;
  initiatorId: string;
  externalReference?: string;
  metadata?: Readonly<Record<string, string>>;
}

export interface OrganizationLifecycleDto {
  organizationId: string;
  reason?: string;
}
