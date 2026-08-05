import { createProvisioningIdentifiers } from "../src/index.js";

describe("provisioning identifiers", () => {
  it("creates deterministic portable identifiers", () => {
    expect(
      createProvisioningIdentifiers(
        {
          type: "create_organization",
          commandId: "cmd_sprint10_e2e",
          organizationName: "Departify Sprint 10",
          initiatorId: "platform-test",
        },
        {
          requestedBy: "platform-test",
          organizationName: "Departify Sprint 10",
        },
      ),
    ).toEqual({
      organizationId: "org_departify_sprint_10_cmd_sprint10_e2e",
      workspaceId: "wsp_departify_sprint_10_cmd_sprint10_e2e_primary",
      provisioningId: "prv_departify_sprint_10_cmd_sprint10_e2e",
    });
  });
});
