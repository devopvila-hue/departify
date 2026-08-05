import type { MemoryEngineEvent } from "../events/memory-events.js";
import { MemoryLifecyclePolicy } from "../lifecycle/memory-lifecycle.js";
import {
  memoryKinds,
  memoryScopes,
  memoryStatuses,
  type MemoryKind,
  type MemoryScope,
  type MemoryStatus,
} from "./memory-types.js";
import { assertMemoryValid } from "../validation/memory-error.js";

export interface MemoryRecordSnapshot {
  id: string;
  organizationId: string;
  ownerId?: string;
  sessionId?: string;
  kind: MemoryKind;
  scope: MemoryScope;
  status: MemoryStatus;
  content: string;
  priority: number;
  tags: readonly string[];
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}

export interface CreateMemoryInput {
  id: string;
  organizationId: string;
  ownerId?: string;
  sessionId?: string;
  kind: MemoryKind;
  scope: MemoryScope;
  content: string;
  priority: number;
  tags?: readonly string[];
  createdAt?: Date;
  expiresAt?: Date;
}

export class MemoryRecord {
  private readonly lifecycle = new MemoryLifecyclePolicy();
  private readonly events: MemoryEngineEvent[] = [];

  private constructor(private snapshot: MemoryRecordSnapshot) {}

  static create(input: CreateMemoryInput): MemoryRecord {
    const now = input.createdAt ?? new Date();
    const snapshot: MemoryRecordSnapshot = {
      id: normalizeRequired(input.id, "Memory id"),
      organizationId: normalizeRequired(
        input.organizationId,
        "Organization id",
      ),
      kind: validateKind(input.kind),
      scope: validateScope(input.scope),
      status: "active",
      content: normalizeContent(input.content),
      priority: validatePriority(input.priority),
      tags: normalizeTags(input.tags ?? []),
      createdAt: now,
      updatedAt: now,
    };
    const ownerId = normalizeOptional(input.ownerId);
    const sessionId = normalizeOptional(input.sessionId);
    if (ownerId) {
      snapshot.ownerId = ownerId;
    }
    if (sessionId) {
      snapshot.sessionId = sessionId;
    }
    if (input.expiresAt) {
      snapshot.expiresAt = input.expiresAt;
    }

    const record = new MemoryRecord(snapshot);
    record.assertScopeInvariant();
    record.record({
      type: "memory.created",
      memoryId: record.snapshot.id,
      kind: record.snapshot.kind,
      scope: record.snapshot.scope,
      occurredAt: now,
    });
    return record;
  }

  static reconstitute(snapshot: MemoryRecordSnapshot): MemoryRecord {
    assertMemoryValid(
      memoryStatuses.includes(snapshot.status),
      "Memory status is invalid.",
    );
    const restored: MemoryRecordSnapshot = {
      id: normalizeRequired(snapshot.id, "Memory id"),
      organizationId: normalizeRequired(
        snapshot.organizationId,
        "Organization id",
      ),
      kind: validateKind(snapshot.kind),
      scope: validateScope(snapshot.scope),
      status: snapshot.status,
      content: normalizeContent(snapshot.content),
      priority: validatePriority(snapshot.priority),
      tags: normalizeTags(snapshot.tags),
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
    };
    const ownerId = normalizeOptional(snapshot.ownerId);
    const sessionId = normalizeOptional(snapshot.sessionId);
    if (ownerId) {
      restored.ownerId = ownerId;
    }
    if (sessionId) {
      restored.sessionId = sessionId;
    }
    if (snapshot.expiresAt) {
      restored.expiresAt = snapshot.expiresAt;
    }

    const record = new MemoryRecord(restored);
    record.assertScopeInvariant();
    return record;
  }

  getId(): string {
    return this.snapshot.id;
  }

  getStatus(): MemoryStatus {
    return this.snapshot.status;
  }

  updateContent(content: string, occurredAt = new Date()): void {
    this.assertMutable();
    this.snapshot = {
      ...this.snapshot,
      content: normalizeContent(content),
      updatedAt: occurredAt,
    };
    this.record({
      type: "memory.updated",
      memoryId: this.snapshot.id,
      occurredAt,
    });
  }

  archive(occurredAt = new Date()): void {
    this.transitionTo("archived", occurredAt);
    this.record({
      type: "memory.archived",
      memoryId: this.snapshot.id,
      occurredAt,
    });
  }

  expire(occurredAt = new Date()): void {
    this.transitionTo("expired", occurredAt);
    this.record({
      type: "memory.expired",
      memoryId: this.snapshot.id,
      occurredAt,
    });
  }

  restore(occurredAt = new Date()): void {
    this.transitionTo("active", occurredAt);
  }

  delete(occurredAt = new Date()): void {
    this.transitionTo("deleted", occurredAt);
    this.record({
      type: "memory.deleted",
      memoryId: this.snapshot.id,
      occurredAt,
    });
  }

  pullEvents(): readonly MemoryEngineEvent[] {
    const pulled = [...this.events];
    this.events.length = 0;
    return pulled;
  }

  toSnapshot(): MemoryRecordSnapshot {
    return {
      ...this.snapshot,
      tags: [...this.snapshot.tags],
    };
  }

  private transitionTo(status: MemoryStatus, occurredAt: Date): void {
    this.lifecycle.assertTransition(this.snapshot.status, status);
    this.snapshot = {
      ...this.snapshot,
      status,
      updatedAt: occurredAt,
    };
  }

  private assertMutable(): void {
    assertMemoryValid(
      this.snapshot.status !== "deleted",
      "Deleted memories cannot be modified.",
    );
  }

  private assertScopeInvariant(): void {
    assertMemoryValid(
      this.snapshot.scope !== "agent" || Boolean(this.snapshot.ownerId),
      "Agent memory requires ownerId.",
    );
    assertMemoryValid(
      this.snapshot.scope !== "session" || Boolean(this.snapshot.sessionId),
      "Session memory requires sessionId.",
    );
  }

  private record(event: MemoryEngineEvent): void {
    this.events.push(event);
  }
}

function normalizeRequired(value: string, field: string): string {
  const normalized = value.trim();
  assertMemoryValid(normalized.length >= 2, `${field} is required.`);
  return normalized;
}

function normalizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function normalizeContent(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  assertMemoryValid(
    normalized.length >= 3 && normalized.length <= 4000,
    "Memory content must be between 3 and 4000 characters.",
  );
  return normalized;
}

function validateKind(kind: MemoryKind): MemoryKind {
  assertMemoryValid(memoryKinds.includes(kind), "Memory kind is invalid.");
  return kind;
}

function validateScope(scope: MemoryScope): MemoryScope {
  assertMemoryValid(memoryScopes.includes(scope), "Memory scope is invalid.");
  return scope;
}

function validatePriority(priority: number): number {
  assertMemoryValid(
    Number.isInteger(priority),
    "Memory priority must be an integer.",
  );
  assertMemoryValid(
    priority >= 1 && priority <= 100,
    "Memory priority must be between 1 and 100.",
  );
  return priority;
}

function normalizeTags(tags: readonly string[]): readonly string[] {
  assertMemoryValid(
    tags.length <= 20,
    "Memory cannot contain more than 20 tags.",
  );
  const normalized = tags.map((tag) => tag.trim().toLowerCase());
  assertMemoryValid(
    new Set(normalized).size === normalized.length,
    "Memory tags cannot contain duplicates.",
  );
  normalized.forEach((tag) => {
    assertMemoryValid(
      /^[a-z][a-z0-9._-]{1,47}$/.test(tag),
      "Memory tag must be a safe code between 2 and 48 characters.",
    );
  });
  return normalized;
}
