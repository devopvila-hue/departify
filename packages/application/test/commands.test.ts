import {
  ApplicationValidationError,
  validateActivateOrganizationCommand,
  validateCreateOrganizationCommand,
  validateDeleteOrganizationCommand,
} from "../src/index.js";

describe("application commands", () => {
  it("validates create organization command contracts", () => {
    expect(
      validateCreateOrganizationCommand({
        type: "create_organization",
        commandId: "cmd_001",
        organizationName: " Departify ",
        initiatorId: "actor_001",
      }),
    ).toEqual({
      type: "create_organization",
      commandId: "cmd_001",
      organizationName: "Departify",
      initiatorId: "actor_001",
    });
  });

  it("validates lifecycle command contracts", () => {
    expect(
      validateActivateOrganizationCommand({
        type: "activate_organization",
        commandId: "cmd_002",
        organizationId: "org_departify01",
      }),
    ).toEqual({
      type: "activate_organization",
      commandId: "cmd_002",
      organizationId: "org_departify01",
    });

    expect(
      validateDeleteOrganizationCommand({
        type: "delete_organization",
        commandId: "cmd_003",
        organizationId: "org_departify01",
        reason: " Controlled lifecycle cleanup ",
      }),
    ).toMatchObject({
      reason: "Controlled lifecycle cleanup",
    });
  });

  it("rejects invalid command payloads", () => {
    expect(() =>
      validateCreateOrganizationCommand({
        type: "create_organization",
        commandId: "",
        organizationName: "Departify",
        initiatorId: "actor_001",
      }),
    ).toThrow(ApplicationValidationError);
  });
});
