import { assertMemoryValid } from "../validation/memory-error.js";

export const retentionActions = [
  "retain",
  "expire",
  "archive",
  "consolidate",
] as const;

export type RetentionAction = (typeof retentionActions)[number];

export interface RetentionPolicy {
  expiresAfterDays?: number;
  minimumPriorityToRetain: number;
  archiveBelowPriority?: number;
  consolidateAfterDays?: number;
}

export interface RetentionDecision {
  action: RetentionAction;
  rationale: string;
}

export function validateRetentionPolicy(policy: RetentionPolicy): void {
  validateOptionalPositiveInteger(policy.expiresAfterDays, "expiresAfterDays");
  validateOptionalPositiveInteger(
    policy.consolidateAfterDays,
    "consolidateAfterDays",
  );
  validatePriority(policy.minimumPriorityToRetain, "minimumPriorityToRetain");
  if (policy.archiveBelowPriority !== undefined) {
    validatePriority(policy.archiveBelowPriority, "archiveBelowPriority");
  }
}

export function decideRetention(
  policy: RetentionPolicy,
  input: {
    priority: number;
    ageDays: number;
  },
): RetentionDecision {
  validateRetentionPolicy(policy);
  validatePriority(input.priority, "priority");
  assertMemoryValid(
    Number.isInteger(input.ageDays) && input.ageDays >= 0,
    "ageDays must be a non-negative integer.",
  );

  if (
    policy.expiresAfterDays !== undefined &&
    input.ageDays >= policy.expiresAfterDays
  ) {
    return {
      action: "expire",
      rationale: "Memory age reached expiration policy.",
    };
  }
  if (
    policy.archiveBelowPriority !== undefined &&
    input.priority < policy.archiveBelowPriority
  ) {
    return {
      action: "archive",
      rationale: "Memory priority is below archival threshold.",
    };
  }
  if (
    policy.consolidateAfterDays !== undefined &&
    input.ageDays >= policy.consolidateAfterDays
  ) {
    return {
      action: "consolidate",
      rationale: "Memory age reached consolidation policy.",
    };
  }
  return {
    action: "retain",
    rationale: "Memory remains inside retention policy.",
  };
}

function validateOptionalPositiveInteger(
  value: number | undefined,
  field: string,
): void {
  if (value === undefined) {
    return;
  }
  assertMemoryValid(
    Number.isInteger(value) && value > 0,
    `${field} must be a positive integer.`,
  );
}

function validatePriority(value: number, field: string): void {
  assertMemoryValid(
    Number.isInteger(value) && value >= 1 && value <= 100,
    `${field} must be between 1 and 100.`,
  );
}
