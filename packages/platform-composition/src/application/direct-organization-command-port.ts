import type {
  ApplicationOrchestrationIntent,
  OrganizationCommandPort,
  OrganizationLifecyclePayload,
} from "@departify/application";
import type { OrganizationProvisioningRequest } from "@departify/provisioning-engine";

export class DirectOrganizationCommandPort implements OrganizationCommandPort {
  prepareCreateOrganization(
    request: OrganizationProvisioningRequest,
  ): ApplicationOrchestrationIntent<OrganizationProvisioningRequest> {
    return {
      operation: "provisioning.create_organization",
      payload: request,
    };
  }

  prepareLifecycleOperation(
    intent: ApplicationOrchestrationIntent<OrganizationLifecyclePayload>,
  ): ApplicationOrchestrationIntent<OrganizationLifecyclePayload> {
    return intent;
  }
}
