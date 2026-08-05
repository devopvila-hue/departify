import type {
  OrganizationDto,
  OrganizationListDto,
} from "../dto/organization-dto.js";
import type { ProvisioningStatusDto } from "../dto/provisioning-dto.js";
import type {
  GetOrganizationQuery,
  GetProvisioningStatusQuery,
  ListOrganizationsQuery,
} from "../queries/organization-queries.js";
import type {
  ApplicationHandlerResult,
  OrganizationQueryPort,
  ProvisioningQueryPort,
} from "../ports/application-ports.js";
import {
  validateGetOrganizationQuery,
  validateGetProvisioningStatusQuery,
  validateListOrganizationsQuery,
} from "../validation/query-validation.js";

export class GetOrganizationHandler {
  constructor(private readonly port: OrganizationQueryPort) {}

  async handle(
    query: GetOrganizationQuery,
  ): Promise<ApplicationHandlerResult<OrganizationDto | null>> {
    const validQuery = validateGetOrganizationQuery(query);
    return {
      ok: true,
      value: await this.port.getOrganization(validQuery.organizationId),
    };
  }
}

export class ListOrganizationsHandler {
  constructor(private readonly port: OrganizationQueryPort) {}

  async handle(
    query: ListOrganizationsQuery,
  ): Promise<ApplicationHandlerResult<OrganizationListDto>> {
    const validQuery = validateListOrganizationsQuery(query);
    return {
      ok: true,
      value: await this.port.listOrganizations({
        ...(validQuery.cursor === undefined
          ? {}
          : { cursor: validQuery.cursor }),
        ...(validQuery.limit === undefined ? {} : { limit: validQuery.limit }),
      }),
    };
  }
}

export class GetProvisioningStatusHandler {
  constructor(private readonly port: ProvisioningQueryPort) {}

  async handle(
    query: GetProvisioningStatusQuery,
  ): Promise<ApplicationHandlerResult<ProvisioningStatusDto | null>> {
    const validQuery = validateGetProvisioningStatusQuery(query);
    return {
      ok: true,
      value: await this.port.getProvisioningStatus(validQuery.provisioningId),
    };
  }
}
