import {
  DomainInvariantError,
  Organization,
  type OrganizationEvent,
} from "../src/index.js";
import { organizationInput } from "./fixtures.js";

describe("Organization aggregate root", () => {
  it("requests an organization and records an explicit domain event", () => {
    const organization = Organization.request(organizationInput());

    expect(organization.getStatus()).toBe("requested");
    expect(organization.toSnapshot()).toMatchObject({
      id: "org_departify01",
      name: "Departify",
      status: "requested",
      workspaces: [
        {
          id: "wsp_primary01",
          name: "Primary",
          status: "active",
        },
      ],
    });

    expect(organization.pullDomainEvents()).toEqual<OrganizationEvent[]>([
      {
        type: "organization.requested",
        organizationId: "org_departify01",
        organizationName: "Departify",
        occurredAt: new Date("2026-08-05T00:00:00.000Z"),
      },
    ]);
  });

  it("supports controlled lifecycle transitions", () => {
    const organization = Organization.request(organizationInput());
    organization.pullDomainEvents();

    organization.markCreated(new Date("2026-08-05T01:00:00.000Z"));
    organization.activate(new Date("2026-08-05T02:00:00.000Z"));
    organization.suspend(
      "Billing review",
      new Date("2026-08-05T03:00:00.000Z"),
    );
    organization.activate(new Date("2026-08-05T04:00:00.000Z"));

    expect(organization.getStatus()).toBe("active");
    expect(organization.pullDomainEvents().map((event) => event.type)).toEqual([
      "organization.created",
      "organization.activated",
      "organization.suspended",
      "organization.activated",
    ]);
  });

  it("prevents implicit lifecycle transitions", () => {
    const organization = Organization.request(organizationInput());

    expect(() => organization.activate()).toThrow(DomainInvariantError);
    expect(organization.getStatus()).toBe("requested");
  });

  it("protects workspace limits", () => {
    const organization = Organization.request(organizationInput());

    organization.addWorkspace({ id: "wsp_secondary1", name: "Secondary" });

    expect(() =>
      organization.addWorkspace({ id: "wsp_third001", name: "Third" }),
    ).toThrow(DomainInvariantError);
  });

  it("prevents mutation after archive or deletion", () => {
    const organization = Organization.request(organizationInput());
    organization.markCreated();
    organization.archive("Company closed");

    expect(() => organization.rename("New Name")).toThrow(DomainInvariantError);
    organization.delete("Legal cleanup");
    expect(organization.getStatus()).toBe("deleted");
    expect(() =>
      organization.addWorkspace({ id: "wsp_newspace", name: "New" }),
    ).toThrow(DomainInvariantError);
  });

  it("reconstitutes without replaying domain events", () => {
    const organization = Organization.reconstitute({
      ...Organization.request(organizationInput()).toSnapshot(),
      status: "active",
    });

    expect(organization.getStatus()).toBe("active");
    expect(organization.pullDomainEvents()).toEqual([]);
  });
});
