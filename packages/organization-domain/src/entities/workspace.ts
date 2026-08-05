import { OrganizationName } from "../value-objects/organization-name.js";
import { WorkspaceId } from "../value-objects/workspace-id.js";
import { assertDomainInvariant } from "../validation/domain-error.js";

export const workspaceStatuses = ["active", "archived"] as const;

export type WorkspaceStatus = (typeof workspaceStatuses)[number];

export interface WorkspaceSnapshot {
  id: string;
  name: string;
  status: WorkspaceStatus;
}

export class Workspace {
  private constructor(
    private readonly id: WorkspaceId,
    private readonly name: OrganizationName,
    private status: WorkspaceStatus,
  ) {}

  static create(values: Omit<WorkspaceSnapshot, "status">): Workspace {
    return new Workspace(
      WorkspaceId.create(values.id),
      OrganizationName.create(values.name),
      "active",
    );
  }

  static reconstitute(values: WorkspaceSnapshot): Workspace {
    assertDomainInvariant(
      workspaceStatuses.includes(values.status),
      "Workspace status is invalid.",
    );
    return new Workspace(
      WorkspaceId.create(values.id),
      OrganizationName.create(values.name),
      values.status,
    );
  }

  getId(): WorkspaceId {
    return this.id;
  }

  getStatus(): WorkspaceStatus {
    return this.status;
  }

  archive(): void {
    this.status = "archived";
  }

  toSnapshot(): WorkspaceSnapshot {
    return {
      id: this.id.toString(),
      name: this.name.toString(),
      status: this.status,
    };
  }
}
