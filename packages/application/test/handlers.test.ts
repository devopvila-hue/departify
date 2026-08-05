import {
  ActivateOrganizationHandler,
  CreateOrganizationHandler,
  GetOrganizationHandler,
  GetProvisioningStatusHandler,
  ListOrganizationsHandler,
  OrganizationApplicationService,
} from "../src/index.js";
import {
  organizationCommandPort,
  organizationQueryPort,
  provisioningQueryPort,
} from "./fixtures.js";

describe("application handlers", () => {
  it("prepares create organization orchestration through the command port", () => {
    const handler = new CreateOrganizationHandler(organizationCommandPort);

    expect(
      handler.handle({
        type: "create_organization",
        commandId: "cmd_001",
        organizationName: "Departify",
        initiatorId: "actor_001",
      }),
    ).toEqual({
      ok: true,
      value: {
        operation: "provisioning.create_organization",
        payload: {
          requestedBy: "actor_001",
          organizationName: "Departify",
        },
      },
    });
  });

  it("prepares lifecycle orchestration without mutating domain state", () => {
    const handler = new ActivateOrganizationHandler(organizationCommandPort);

    expect(
      handler.handle({
        type: "activate_organization",
        commandId: "cmd_002",
        organizationId: "org_departify01",
      }),
    ).toEqual({
      ok: true,
      value: {
        operation: "organization.activate",
        payload: {
          organizationId: "org_departify01",
        },
      },
    });
  });

  it("coordinates query ports without infrastructure adapters", async () => {
    await expect(
      new GetOrganizationHandler(organizationQueryPort).handle({
        type: "get_organization",
        organizationId: "org_departify01",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        id: "org_departify01",
      },
    });

    await expect(
      new ListOrganizationsHandler(organizationQueryPort).handle({
        type: "list_organizations",
        limit: 10,
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        items: [],
        total: 0,
      },
    });

    await expect(
      new GetProvisioningStatusHandler(provisioningQueryPort).handle({
        type: "get_provisioning_status",
        provisioningId: "prv_001",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        id: "prv_001",
        state: "requested",
      },
    });
  });

  it("exposes the composed organization application service", async () => {
    const service = new OrganizationApplicationService({
      organizationCommand: organizationCommandPort,
      organizationQuery: organizationQueryPort,
      provisioningQuery: provisioningQueryPort,
    });

    expect(
      service.suspendOrganization({
        type: "suspend_organization",
        commandId: "cmd_004",
        organizationId: "org_departify01",
        reason: "Lifecycle review",
      }),
    ).toMatchObject({
      ok: true,
      value: {
        operation: "organization.suspend",
      },
    });

    await expect(
      service.getProvisioningStatus({
        type: "get_provisioning_status",
        provisioningId: "prv_001",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        id: "prv_001",
      },
    });
  });
});
