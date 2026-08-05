import type { RequestOrganizationInput } from "../src/index.js";

export function organizationInput(
  overrides: Partial<RequestOrganizationInput> = {},
): RequestOrganizationInput {
  return {
    id: "org_departify01",
    name: "Departify",
    brand: { displayName: "Departify" },
    license: { plan: "professional", seats: 10 },
    settings: {
      timeZone: "Europe/Madrid",
      locale: "es-ES",
      limits: {
        maxWorkspaces: 2,
        maxMembers: 10,
      },
      featureFlags: {
        foundation: true,
      },
      contactInformation: {
        email: "hello@departify.example",
        website: "https://departify.example",
      },
    },
    initialWorkspace: {
      id: "wsp_primary01",
      name: "Primary",
    },
    occurredAt: new Date("2026-08-05T00:00:00.000Z"),
    ...overrides,
  };
}
