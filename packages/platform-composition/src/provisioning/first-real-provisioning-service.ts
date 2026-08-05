import {
  CreateOrganizationHandler,
  type CreateOrganizationCommand,
} from "@departify/application";
import {
  Organization,
  type OrganizationSnapshot,
  type WorkspaceSnapshot,
} from "@departify/organization-domain";
import type { UnitOfWork, Versioned } from "@departify/persistence-contracts";
import {
  provisioningPipelineStepIds,
  validateProvisioningRequest,
  type OrganizationProvisioningRecord,
  type OrganizationProvisioningRequest,
  type ProvisioningIssue,
  type ProvisioningState,
  type ProvisioningStepId,
} from "@departify/provisioning-engine";
import { DirectOrganizationCommandPort } from "../application/direct-organization-command-port.js";
import {
  createProvisioningIdentifiers,
  type ProvisioningIdentifiers,
} from "../identifiers/provisioning-identifiers.js";

export interface FirstRealProvisioningResult {
  accepted: boolean;
  provisioningId: string;
  organizationId: string;
  workspaceId: string;
  state: ProvisioningState;
  currentStep?: ProvisioningStepId;
  issues: readonly ProvisioningIssue[];
}

export class FirstRealProvisioningService {
  private readonly createOrganizationHandler = new CreateOrganizationHandler(
    new DirectOrganizationCommandPort(),
  );

  constructor(private readonly unitOfWork: UnitOfWork) {}

  async createOrganization(
    command: CreateOrganizationCommand,
  ): Promise<FirstRealProvisioningResult> {
    const intentResult = this.createOrganizationHandler.handle(command);

    if (!intentResult.ok) {
      return {
        accepted: false,
        provisioningId: "prv_rejected",
        organizationId: "",
        workspaceId: "",
        state: "failed",
        issues: intentResult.issues.map((message) => ({
          code: "APPLICATION_COMMAND_REJECTED",
          message,
        })),
      };
    }

    const request = intentResult.value.payload;
    const identifiers = createProvisioningIdentifiers(command, request);

    return this.unitOfWork.execute(async (context) => {
      await context.provisioning.save({
        snapshot: createProvisioningRecord({
          identifiers,
          request,
          state: "requested",
          attempts: 0,
          issues: [],
        }),
        version: "v1",
      });

      await context.provisioning.save(
        {
          snapshot: createProvisioningRecord({
            identifiers,
            request,
            state: "validating",
            currentStep: "validate_request",
            attempts: 1,
            issues: [],
          }),
          version: "v2",
        },
        { expectedVersion: { value: "v1" } },
      );

      const validation = validateProvisioningRequest(request);
      if (!validation.valid) {
        const failedRecord = createProvisioningRecord({
          identifiers,
          request,
          state: "failed",
          currentStep: "validate_request",
          attempts: 1,
          issues: validation.issues,
        });
        await context.provisioning.save(
          { snapshot: failedRecord, version: "v3" },
          { expectedVersion: { value: "v2" } },
        );

        return resultFromRecord(identifiers, failedRecord, false);
      }

      await context.provisioning.save(
        {
          snapshot: createProvisioningRecord({
            identifiers,
            request,
            state: "planning",
            currentStep: "validate_request",
            attempts: 1,
            issues: [],
          }),
          version: "v3",
        },
        { expectedVersion: { value: "v2" } },
      );

      const organization = createOrganizationAggregate(identifiers, request);
      const organizationSnapshot = organization.toSnapshot();
      const workspaceSnapshot = organizationSnapshot.workspaces[0];

      if (workspaceSnapshot === undefined) {
        throw new Error("Provisioned organization must include one workspace.");
      }

      await context.provisioning.save(
        {
          snapshot: createProvisioningRecord({
            identifiers,
            request,
            state: "in_progress",
            currentStep: "create_organization",
            attempts: 1,
            issues: [],
          }),
          version: "v4",
        },
        { expectedVersion: { value: "v3" } },
      );

      await context.organizations.save(toVersioned(organizationSnapshot));
      await context.workspaces.save(toVersioned(workspaceSnapshot));

      const finalRecord = createProvisioningRecord({
        identifiers,
        request,
        state: "in_progress",
        currentStep: "create_organization",
        attempts: 1,
        issues: [],
      });

      await context.provisioning.save(
        { snapshot: finalRecord, version: "v5" },
        { expectedVersion: { value: "v4" } },
      );

      return resultFromRecord(identifiers, finalRecord, true);
    });
  }
}

function createOrganizationAggregate(
  identifiers: ProvisioningIdentifiers,
  request: OrganizationProvisioningRequest,
): Organization {
  const organization = Organization.request({
    id: identifiers.organizationId,
    name: request.organizationName,
    brand: { displayName: request.organizationName },
    license: { plan: "starter", seats: 1 },
    settings: {
      timeZone: request.metadata?.timeZone ?? "UTC",
      locale: request.metadata?.locale ?? "en",
      limits: {
        maxWorkspaces: 1,
        maxMembers: 1,
      },
      featureFlags: {},
      contactInformation: {},
    },
    initialWorkspace: {
      id: identifiers.workspaceId,
      name: "Primary Workspace",
    },
  });
  organization.markCreated();
  organization.pullDomainEvents();
  return organization;
}

function createProvisioningRecord(input: {
  identifiers: ProvisioningIdentifiers;
  request: OrganizationProvisioningRequest;
  state: ProvisioningState;
  currentStep?: ProvisioningStepId;
  attempts: number;
  issues: readonly ProvisioningIssue[];
}): OrganizationProvisioningRecord {
  return {
    id: input.identifiers.provisioningId,
    state: input.state,
    request: input.request,
    ...(input.currentStep === undefined
      ? {}
      : { currentStep: input.currentStep }),
    attempts: input.attempts,
    issues: input.issues,
  };
}

function resultFromRecord(
  identifiers: ProvisioningIdentifiers,
  record: OrganizationProvisioningRecord,
  accepted: boolean,
): FirstRealProvisioningResult {
  return {
    accepted,
    provisioningId: record.id,
    organizationId: identifiers.organizationId,
    workspaceId: identifiers.workspaceId,
    state: record.state,
    ...(record.currentStep === undefined
      ? {}
      : { currentStep: record.currentStep }),
    issues: record.issues,
  };
}

function toVersioned<
  TSnapshot extends OrganizationSnapshot | WorkspaceSnapshot,
>(snapshot: TSnapshot): Versioned<TSnapshot> {
  return {
    snapshot,
    version: "v1",
  };
}

export function implementedProvisioningSteps(): readonly ProvisioningStepId[] {
  return provisioningPipelineStepIds.filter(
    (step): step is ProvisioningStepId =>
      step === "validate_request" || step === "create_organization",
  );
}
