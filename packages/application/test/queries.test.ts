import {
  ApplicationValidationError,
  validateGetOrganizationQuery,
  validateGetProvisioningStatusQuery,
  validateListOrganizationsQuery,
} from "../src/index.js";

describe("application queries", () => {
  it("validates organization and provisioning query contracts", () => {
    expect(
      validateGetOrganizationQuery({
        type: "get_organization",
        organizationId: " org_departify01 ",
      }),
    ).toEqual({
      type: "get_organization",
      organizationId: "org_departify01",
    });

    expect(
      validateGetProvisioningStatusQuery({
        type: "get_provisioning_status",
        provisioningId: " prv_001 ",
      }),
    ).toEqual({
      type: "get_provisioning_status",
      provisioningId: "prv_001",
    });
  });

  it("validates list options without persistence assumptions", () => {
    expect(
      validateListOrganizationsQuery({
        type: "list_organizations",
        cursor: " page_1 ",
        limit: 25,
      }),
    ).toEqual({
      type: "list_organizations",
      cursor: "page_1",
      limit: 25,
    });

    expect(() =>
      validateListOrganizationsQuery({
        type: "list_organizations",
        limit: 101,
      }),
    ).toThrow(ApplicationValidationError);
  });
});
