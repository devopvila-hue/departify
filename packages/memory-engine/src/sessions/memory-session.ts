import { assertMemoryValid } from "../validation/memory-error.js";

export const memorySessionStatuses = ["open", "closed", "expired"] as const;

export type MemorySessionStatus = (typeof memorySessionStatuses)[number];

export interface MemorySessionSnapshot {
  id: string;
  organizationId: string;
  agentId: string;
  status: MemorySessionStatus;
  openedAt: Date;
  closedAt?: Date;
}

export class MemorySession {
  private constructor(private readonly snapshot: MemorySessionSnapshot) {}

  static open(snapshot: Omit<MemorySessionSnapshot, "status">): MemorySession {
    const opened: MemorySessionSnapshot = {
      id: normalize(snapshot.id, "Session id"),
      organizationId: normalize(snapshot.organizationId, "Organization id"),
      agentId: normalize(snapshot.agentId, "Agent id"),
      openedAt: snapshot.openedAt,
      status: "open",
    };
    if (snapshot.closedAt) {
      opened.closedAt = snapshot.closedAt;
    }
    return new MemorySession(opened);
  }

  static reconstitute(snapshot: MemorySessionSnapshot): MemorySession {
    assertMemoryValid(
      memorySessionStatuses.includes(snapshot.status),
      "Memory session status is invalid.",
    );
    const restored: MemorySessionSnapshot = {
      id: normalize(snapshot.id, "Session id"),
      organizationId: normalize(snapshot.organizationId, "Organization id"),
      agentId: normalize(snapshot.agentId, "Agent id"),
      openedAt: snapshot.openedAt,
      status: snapshot.status,
    };
    if (snapshot.closedAt) {
      restored.closedAt = snapshot.closedAt;
    }
    return new MemorySession(restored);
  }

  close(closedAt = new Date()): MemorySession {
    assertMemoryValid(
      this.snapshot.status === "open",
      "Only open memory sessions can be closed.",
    );
    return new MemorySession({
      ...this.snapshot,
      status: "closed",
      closedAt,
    });
  }

  expire(expiredAt = new Date()): MemorySession {
    assertMemoryValid(
      this.snapshot.status === "open",
      "Only open memory sessions can expire.",
    );
    return new MemorySession({
      ...this.snapshot,
      status: "expired",
      closedAt: expiredAt,
    });
  }

  toSnapshot(): MemorySessionSnapshot {
    return { ...this.snapshot };
  }
}

function normalize(value: string, field: string): string {
  const normalized = value.trim();
  assertMemoryValid(normalized.length >= 2, `${field} is required.`);
  return normalized;
}
