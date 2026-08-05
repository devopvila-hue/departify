import type { OrganizationSnapshot } from "@departify/organization-domain";
import type { OrganizationDto } from "../dto/organization-dto.js";

export function organizationSnapshotToDto(
  snapshot: OrganizationSnapshot,
): OrganizationDto {
  return {
    id: snapshot.id,
    name: snapshot.name,
    status: snapshot.status,
    brand: {
      displayName: snapshot.brand.displayName,
    },
    license: {
      plan: snapshot.license.plan,
      seats: snapshot.license.seats,
    },
    settings: {
      timeZone: snapshot.settings.timeZone,
      locale: snapshot.settings.locale,
      limits: {
        maxWorkspaces: snapshot.settings.limits.maxWorkspaces,
        maxMembers: snapshot.settings.limits.maxMembers,
      },
      featureFlags: { ...(snapshot.settings.featureFlags ?? {}) },
      contactInformation: {
        ...(snapshot.settings.contactInformation?.email === undefined
          ? {}
          : { email: snapshot.settings.contactInformation.email }),
        ...(snapshot.settings.contactInformation?.website === undefined
          ? {}
          : { website: snapshot.settings.contactInformation.website }),
      },
    },
    workspaces: snapshot.workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      status: workspace.status,
    })),
  };
}
