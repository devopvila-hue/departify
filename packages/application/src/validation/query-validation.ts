import {
  assertApplicationValid,
  assertNonEmptyText,
} from "./application-error.js";
import type {
  GetOrganizationQuery,
  GetProvisioningStatusQuery,
  ListOrganizationsQuery,
} from "../queries/organization-queries.js";

export function validateGetOrganizationQuery(
  query: GetOrganizationQuery,
): GetOrganizationQuery {
  return {
    type: query.type,
    organizationId: assertNonEmptyText(query.organizationId, "organizationId"),
  };
}

export function validateListOrganizationsQuery(
  query: ListOrganizationsQuery,
): ListOrganizationsQuery {
  if (query.limit !== undefined) {
    assertApplicationValid(
      Number.isInteger(query.limit) && query.limit > 0 && query.limit <= 100,
      "limit must be an integer between 1 and 100.",
    );
  }
  return {
    type: query.type,
    ...(query.cursor === undefined
      ? {}
      : { cursor: assertNonEmptyText(query.cursor, "cursor") }),
    ...(query.limit === undefined ? {} : { limit: query.limit }),
  };
}

export function validateGetProvisioningStatusQuery(
  query: GetProvisioningStatusQuery,
): GetProvisioningStatusQuery {
  return {
    type: query.type,
    provisioningId: assertNonEmptyText(query.provisioningId, "provisioningId"),
  };
}
