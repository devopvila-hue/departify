import { assertDomainInvariant } from "../validation/domain-error.js";

export const organizationStatuses = [
  "requested",
  "created",
  "active",
  "suspended",
  "archived",
  "deleted",
] as const;

export type OrganizationStatus = (typeof organizationStatuses)[number];

export const terminalOrganizationStatuses = ["deleted"] as const;

export const allowedOrganizationTransitions: Record<
  OrganizationStatus,
  readonly OrganizationStatus[]
> = {
  requested: ["created", "deleted"],
  created: ["active", "archived", "deleted"],
  active: ["suspended", "archived", "deleted"],
  suspended: ["active", "archived", "deleted"],
  archived: ["deleted"],
  deleted: [],
};

export class OrganizationLifecyclePolicy {
  canTransition(from: OrganizationStatus, to: OrganizationStatus): boolean {
    return allowedOrganizationTransitions[from].includes(to);
  }

  assertTransition(from: OrganizationStatus, to: OrganizationStatus): void {
    assertDomainInvariant(
      this.canTransition(from, to),
      `Organization cannot transition from ${from} to ${to}.`,
    );
  }
}
