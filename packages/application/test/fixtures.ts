import type {
  ApplicationOrchestrationIntent,
  OrganizationCommandPort,
  OrganizationLifecyclePayload,
  OrganizationQueryPort,
  ProvisioningQueryPort,
} from "../src/index.js";
import type { OrganizationProvisioningRequest } from "@departify/provisioning-engine";

export const organizationCommandPort: OrganizationCommandPort = {
  prepareCreateOrganization(
    request: OrganizationProvisioningRequest,
  ): ApplicationOrchestrationIntent<OrganizationProvisioningRequest> {
    return {
      operation: "provisioning.create_organization",
      payload: request,
    };
  },
  prepareLifecycleOperation(
    intent: ApplicationOrchestrationIntent<OrganizationLifecyclePayload>,
  ): ApplicationOrchestrationIntent<OrganizationLifecyclePayload> {
    return intent;
  },
};

export const organizationQueryPort: OrganizationQueryPort = {
  async getOrganization(organizationId) {
    return {
      id: organizationId,
      name: "Departify",
      status: "active",
      brand: { displayName: "Departify" },
      license: { plan: "professional", seats: 10 },
      settings: {
        timeZone: "Europe/Madrid",
        locale: "es-ES",
        limits: { maxWorkspaces: 2, maxMembers: 10 },
        featureFlags: {},
        contactInformation: {},
      },
      workspaces: [{ id: "wsp_primary01", name: "Primary", status: "active" }],
    };
  },
  async listOrganizations() {
    return {
      items: [],
      total: 0,
    };
  },
};

export const provisioningQueryPort: ProvisioningQueryPort = {
  async getProvisioningStatus(provisioningId) {
    return {
      id: provisioningId,
      state: "requested",
      attempts: 0,
      issues: [],
    };
  },
};
