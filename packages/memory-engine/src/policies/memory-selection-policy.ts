import type { MemoryKind, MemoryScope } from "../memories/memory-types.js";
import { memoryKinds, memoryScopes } from "../memories/memory-types.js";
import { assertMemoryValid } from "../validation/memory-error.js";

export interface MemorySelectionPolicy {
  kinds: readonly MemoryKind[];
  scopes: readonly MemoryScope[];
  minPriority?: number;
  tags?: readonly string[];
}

export function validateMemorySelectionPolicy(
  policy: MemorySelectionPolicy,
): void {
  assertMemoryValid(
    policy.kinds.length > 0,
    "Selection policy requires kinds.",
  );
  assertMemoryValid(
    policy.scopes.length > 0,
    "Selection policy requires scopes.",
  );
  policy.kinds.forEach((kind) => {
    assertMemoryValid(memoryKinds.includes(kind), "Selection kind is invalid.");
  });
  policy.scopes.forEach((scope) => {
    assertMemoryValid(
      memoryScopes.includes(scope),
      "Selection scope is invalid.",
    );
  });
  if (policy.minPriority !== undefined) {
    assertMemoryValid(
      Number.isInteger(policy.minPriority) &&
        policy.minPriority >= 1 &&
        policy.minPriority <= 100,
      "Selection minPriority must be between 1 and 100.",
    );
  }
}
