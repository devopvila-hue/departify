import {
  organizationEventTypes,
  type OrganizationArchivedEvent,
  type OrganizationDeletedEvent,
  type OrganizationRequestedEvent,
} from "../src/index.js";

describe("organization domain events", () => {
  it("models the canonical event names", () => {
    expect(organizationEventTypes).toEqual([
      "organization.requested",
      "organization.created",
      "organization.activated",
      "organization.suspended",
      "organization.archived",
      "organization.deleted",
    ]);
  });

  it("keeps events as pure domain data", () => {
    const requested: OrganizationRequestedEvent = {
      type: "organization.requested",
      organizationId: "org_departify01",
      organizationName: "Departify",
      occurredAt: new Date("2026-08-05T00:00:00.000Z"),
    };
    const archived: OrganizationArchivedEvent = {
      type: "organization.archived",
      organizationId: "org_departify01",
      reason: "Lifecycle test",
      occurredAt: new Date("2026-08-05T01:00:00.000Z"),
    };
    const deleted: OrganizationDeletedEvent = {
      type: "organization.deleted",
      organizationId: "org_departify01",
      reason: "Lifecycle test",
      occurredAt: new Date("2026-08-05T02:00:00.000Z"),
    };

    expect([requested.type, archived.type, deleted.type]).toEqual([
      "organization.requested",
      "organization.archived",
      "organization.deleted",
    ]);
  });
});
