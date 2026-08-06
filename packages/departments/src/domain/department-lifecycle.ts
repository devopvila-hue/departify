import type { DepartmentStatus } from "./department-types.js";
import { assertDepartmentDomainInvariant } from "./department-validation.js";

/**
 * Pure lifecycle policy for the Department aggregate.
 *
 * Lifecycle graph:
 *   draft     → active | paused | archived
 *   active    → paused | archived
 *   paused    → active | archived
 *   archived  is terminal
 */
const ALLOWED: Readonly<Record<DepartmentStatus, readonly DepartmentStatus[]>> =
  {
    draft: ["active", "paused", "archived"],
    active: ["paused", "archived"],
    paused: ["active", "archived"],
    archived: [],
  };

export function canDepartmentTransition(
  from: DepartmentStatus,
  to: DepartmentStatus,
): boolean {
  return ALLOWED[from].includes(to);
}

export function assertDepartmentTransition(
  from: DepartmentStatus,
  to: DepartmentStatus,
): void {
  assertDepartmentDomainInvariant(
    canDepartmentTransition(from, to),
    `Illegal Department lifecycle transition: ${from} → ${to}.`,
  );
}
