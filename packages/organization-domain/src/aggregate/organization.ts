import type { OrganizationEvent } from "../events/organization-events.js";
import { OrganizationSettings } from "../entities/organization-settings.js";
import { Workspace, type WorkspaceSnapshot } from "../entities/workspace.js";
import {
  OrganizationLifecyclePolicy,
  organizationStatuses,
  type OrganizationStatus,
} from "../services/organization-lifecycle-policy.js";
import { assertDomainInvariant } from "../validation/domain-error.js";
import { Brand, type BrandSnapshot } from "../value-objects/brand.js";
import { License, type LicenseSnapshot } from "../value-objects/license.js";
import { OrganizationId } from "../value-objects/organization-id.js";
import { OrganizationName } from "../value-objects/organization-name.js";
import { WorkspaceId } from "../value-objects/workspace-id.js";
import type { OrganizationSettingsSnapshot } from "../entities/organization-settings.js";

export interface OrganizationSnapshot {
  id: string;
  name: string;
  status: OrganizationStatus;
  brand: BrandSnapshot;
  license: LicenseSnapshot;
  settings: OrganizationSettingsSnapshot;
  workspaces: readonly WorkspaceSnapshot[];
}

export interface RequestOrganizationInput {
  id: string;
  name: string;
  brand: BrandSnapshot;
  license: LicenseSnapshot;
  settings: OrganizationSettingsSnapshot;
  initialWorkspace: Omit<WorkspaceSnapshot, "status">;
  occurredAt?: Date;
}

export class Organization {
  private readonly lifecyclePolicy = new OrganizationLifecyclePolicy();
  private readonly domainEvents: OrganizationEvent[] = [];

  private constructor(
    private readonly id: OrganizationId,
    private name: OrganizationName,
    private status: OrganizationStatus,
    private brand: Brand,
    private license: License,
    private settings: OrganizationSettings,
    private readonly workspaces: Workspace[],
  ) {
    this.assertWorkspaceLimit();
  }

  static request(input: RequestOrganizationInput): Organization {
    const organization = new Organization(
      OrganizationId.create(input.id),
      OrganizationName.create(input.name),
      "requested",
      Brand.create(input.brand),
      License.create(input.license),
      OrganizationSettings.create(input.settings),
      [Workspace.create(input.initialWorkspace)],
    );

    organization.record({
      type: "organization.requested",
      organizationId: organization.id.toString(),
      organizationName: organization.name.toString(),
      occurredAt: input.occurredAt ?? new Date(),
    });

    return organization;
  }

  static reconstitute(snapshot: OrganizationSnapshot): Organization {
    assertDomainInvariant(
      organizationStatuses.includes(snapshot.status),
      "Organization status is invalid.",
    );
    return new Organization(
      OrganizationId.create(snapshot.id),
      OrganizationName.create(snapshot.name),
      snapshot.status,
      Brand.create(snapshot.brand),
      License.create(snapshot.license),
      OrganizationSettings.create(snapshot.settings),
      snapshot.workspaces.map((workspace) => Workspace.reconstitute(workspace)),
    );
  }

  getId(): OrganizationId {
    return this.id;
  }

  getStatus(): OrganizationStatus {
    return this.status;
  }

  markCreated(occurredAt = new Date()): void {
    this.transitionTo("created");
    this.record({
      type: "organization.created",
      organizationId: this.id.toString(),
      occurredAt,
    });
  }

  activate(occurredAt = new Date()): void {
    this.transitionTo("active");
    this.record({
      type: "organization.activated",
      organizationId: this.id.toString(),
      occurredAt,
    });
  }

  suspend(reason: string, occurredAt = new Date()): void {
    const normalizedReason = normalizeReason(reason);
    this.transitionTo("suspended");
    this.record({
      type: "organization.suspended",
      organizationId: this.id.toString(),
      reason: normalizedReason,
      occurredAt,
    });
  }

  archive(reason: string, occurredAt = new Date()): void {
    const normalizedReason = normalizeReason(reason);
    this.transitionTo("archived");
    this.record({
      type: "organization.archived",
      organizationId: this.id.toString(),
      reason: normalizedReason,
      occurredAt,
    });
  }

  delete(reason: string, occurredAt = new Date()): void {
    const normalizedReason = normalizeReason(reason);
    this.transitionTo("deleted");
    this.record({
      type: "organization.deleted",
      organizationId: this.id.toString(),
      reason: normalizedReason,
      occurredAt,
    });
  }

  rename(name: string): void {
    this.assertMutable();
    this.name = OrganizationName.create(name);
  }

  updateSettings(settings: OrganizationSettingsSnapshot): void {
    this.assertMutable();
    this.settings = OrganizationSettings.create(settings);
    this.assertWorkspaceLimit();
  }

  addWorkspace(workspace: Omit<WorkspaceSnapshot, "status">): void {
    this.assertMutable();
    this.workspaces.push(Workspace.create(workspace));
    this.assertWorkspaceLimit();
  }

  archiveWorkspace(workspaceId: string): void {
    this.assertMutable();
    const id = WorkspaceId.create(workspaceId);
    const workspace = this.workspaces.find((candidate) =>
      candidate.getId().equals(id),
    );
    assertDomainInvariant(workspace !== undefined, "Workspace does not exist.");
    workspace.archive();
  }

  pullDomainEvents(): readonly OrganizationEvent[] {
    const events = [...this.domainEvents];
    this.domainEvents.length = 0;
    return events;
  }

  toSnapshot(): OrganizationSnapshot {
    return {
      id: this.id.toString(),
      name: this.name.toString(),
      status: this.status,
      brand: this.brand.toSnapshot(),
      license: this.license.toSnapshot(),
      settings: this.settings.toSnapshot(),
      workspaces: this.workspaces.map((workspace) => workspace.toSnapshot()),
    };
  }

  private transitionTo(nextStatus: OrganizationStatus): void {
    this.lifecyclePolicy.assertTransition(this.status, nextStatus);
    this.status = nextStatus;
  }

  private assertMutable(): void {
    assertDomainInvariant(
      this.status !== "archived" && this.status !== "deleted",
      "Archived or deleted organizations cannot be modified.",
    );
  }

  private assertWorkspaceLimit(): void {
    assertDomainInvariant(
      this.workspaces.length <= this.settings.getLimits().maxWorkspaces,
      "Organization cannot exceed its workspace limit.",
    );
  }

  private record(event: OrganizationEvent): void {
    this.domainEvents.push(event);
  }
}

function normalizeReason(reason: string): string {
  const normalized = reason.trim();
  assertDomainInvariant(
    normalized.length >= 3 && normalized.length <= 240,
    "Lifecycle transition reason must be between 3 and 240 characters.",
  );
  return normalized;
}
