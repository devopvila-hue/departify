import { assertMemoryValid } from "../validation/memory-error.js";
import type { MemoryStatus } from "../memories/memory-types.js";

export const allowedMemoryTransitions: Record<
  MemoryStatus,
  readonly MemoryStatus[]
> = {
  active: ["archived", "expired", "deleted"],
  archived: ["active", "deleted"],
  expired: ["archived", "deleted"],
  deleted: [],
};

export const terminalMemoryStatuses = ["deleted"] as const;

export class MemoryLifecyclePolicy {
  canTransition(from: MemoryStatus, to: MemoryStatus): boolean {
    return allowedMemoryTransitions[from].includes(to);
  }

  assertTransition(from: MemoryStatus, to: MemoryStatus): void {
    assertMemoryValid(
      this.canTransition(from, to),
      `Memory cannot transition from ${from} to ${to}.`,
    );
  }
}
