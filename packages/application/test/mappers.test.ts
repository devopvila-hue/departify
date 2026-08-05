import {
  createOrganizationCommandToProvisioningRequest,
  organizationSnapshotToDto,
} from "../src/index.js";
import type { OrganizationSnapshot } from "@departify/organization-domain";

describe("application mappers", () => {
  it("maps create command to provisioning request without exposing DTOs as domain", () => {
    expect(
      createOrganizationCommandToProvisioningRequest({
        type: "create_organization",
        commandId: "cmd_001",
        organizationName: "Departify",
        initiatorId: "actor_001",
        externalReference: "ref_001",
        metadata: { source: "test" },
      }),
    ).toEqual({
      requestedBy: "actor_001",
      organizationName: "Departify",
      externalReference: "ref_001",
      metadata: { source: "test" },
    });
  });

  it("maps domain snapshots to public DTOs", () => {
    const snapshot: OrganizationSnapshot = {
      id: "org_departify01",
      name: "Departify",
      status: "active",
      brand: { displayName: "Departify" },
      license: { plan: "professional", seats: 10 },
      settings: {
        timeZone: "Europe/Madrid",
        locale: "es-ES",
        limits: { maxWorkspaces: 2, maxMembers: 10 },
        featureFlags: { foundation: true },
        contactInformation: { email: "hello@departify.example" },
      },
      workspaces: [{ id: "wsp_primary01", name: "Primary", status: "active" }],
    };

    expect(organizationSnapshotToDto(snapshot)).toEqual({
      id: "org_departify01",
      name: "Departify",
      status: "active",
      brand: { displayName: "Departify" },
      license: { plan: "professional", seats: 10 },
      settings: {
        timeZone: "Europe/Madrid",
        locale: "es-ES",
        limits: { maxWorkspaces: 2, maxMembers: 10 },
        featureFlags: { foundation: true },
        contactInformation: { email: "hello@departify.example" },
      },
      workspaces: [{ id: "wsp_primary01", name: "Primary", status: "active" }],
    });
  });
});
