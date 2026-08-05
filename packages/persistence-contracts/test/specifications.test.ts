import type {
  OrganizationSpecification,
  PersistenceSpecification,
} from "../src/index.js";
import type { OrganizationSnapshot } from "@departify/organization-domain";

describe("specification contracts", () => {
  it("defines pure specifications for domain snapshots", () => {
    const specification: OrganizationSpecification<OrganizationSnapshot> = {
      name: "active-organizations",
      filters: {
        clauses: [{ field: "status", operator: "equals", value: "active" }],
      },
      isSatisfiedBy(candidate) {
        return candidate.status === "active";
      },
    };

    expect(specification.name).toBe("active-organizations");
    expect(
      specification.isSatisfiedBy?.({
        id: "org_departify01",
        name: "Departify",
        status: "active",
        brand: { displayName: "Departify" },
        license: { plan: "professional", seats: 10 },
        settings: {
          timeZone: "Europe/Madrid",
          locale: "es-ES",
          limits: { maxWorkspaces: 1, maxMembers: 10 },
        },
        workspaces: [],
      }),
    ).toBe(true);
  });

  it("keeps persistence specifications as declarative query contracts", () => {
    const specification: PersistenceSpecification<OrganizationSnapshot> = {
      name: "paged-organizations",
      pagination: {
        limit: 10,
        sort: [{ field: "name", direction: "asc" }],
      },
    };

    expect(specification.pagination?.limit).toBe(10);
  });
});
