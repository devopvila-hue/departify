export interface GetOrganizationQuery {
  type: "get_organization";
  organizationId: string;
}

export interface ListOrganizationsQuery {
  type: "list_organizations";
  cursor?: string;
  limit?: number;
}

export interface GetProvisioningStatusQuery {
  type: "get_provisioning_status";
  provisioningId: string;
}

export type OrganizationQuery =
  GetOrganizationQuery | ListOrganizationsQuery | GetProvisioningStatusQuery;
