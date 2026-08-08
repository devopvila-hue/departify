import {
  type CreateMemoryInput,
  type MemoryRecordSnapshot,
  type MemoryRecordStore,
} from "@departify/memory-engine";

export class InMemoryMemoryRecordStore implements MemoryRecordStore {
  private readonly records = new Map<string, MemoryRecordSnapshot>();

  async create(input: CreateMemoryInput): Promise<MemoryRecordSnapshot> {
    const snapshot: MemoryRecordSnapshot = {
      id: input.id,
      organizationId: input.organizationId,
      kind: input.kind,
      scope: input.scope,
      status: "active",
      content: input.content,
      priority: input.priority,
      tags: input.tags ?? [],
      createdAt: input.createdAt ?? new Date(),
      updatedAt: input.createdAt ?? new Date(),
      ...(input.ownerId ? { ownerId: input.ownerId } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.departmentId ? { departmentId: input.departmentId } : {}),
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    };
    this.records.set(snapshot.id, snapshot);
    return snapshot;
  }

  async update(snapshot: MemoryRecordSnapshot): Promise<MemoryRecordSnapshot> {
    const updated = {
      ...snapshot,
      updatedAt: new Date(),
      tags: [...snapshot.tags],
    };
    this.records.set(updated.id, updated);
    return updated;
  }

  async getById(id: string): Promise<MemoryRecordSnapshot | null> {
    return this.records.get(id) ?? null;
  }

  /** Query by filters. Returns snapshots sorted by priority desc, then recency. */
  list(
    filter: MemoryListFilter,
  ): readonly MemoryRecordSnapshot[] {
    const result: MemoryRecordSnapshot[] = [];
    for (const record of this.records.values()) {
      if (record.status !== "active") continue;
      if (record.organizationId !== filter.organizationId) continue;
      if (filter.departmentId !== undefined && record.departmentId !== filter.departmentId) continue;
      if (filter.scope !== undefined && record.scope !== filter.scope) continue;
      if (filter.kind !== undefined && record.kind !== filter.kind) continue;
      if (filter.tag !== undefined && !record.tags.includes(filter.tag)) continue;
      result.push(record);
    }
    result.sort((a, b) => {
      const priorityDiff = b.priority - a.priority;
      if (priorityDiff !== 0) return priorityDiff;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });
    if (filter.limit !== undefined) {
      return result.slice(0, filter.limit);
    }
    return result;
  }

  /** Check if a record with similar content already exists. */
  hasSimilar(
    departmentId: string,
    content: string,
  ): boolean {
    const normalized = content.trim().toLowerCase();
    for (const record of this.records.values()) {
      if (record.status !== "active") continue;
      if (record.departmentId !== departmentId) continue;
      if (record.content.trim().toLowerCase() === normalized) return true;
    }
    return false;
  }
}

export interface MemoryListFilter {
  readonly organizationId: string;
  readonly departmentId?: string;
  readonly scope?: string;
  readonly kind?: string;
  readonly tag?: string;
  readonly limit?: number;
}

export function createInMemoryMemoryRecordStore(): InMemoryMemoryRecordStore {
  return new InMemoryMemoryRecordStore();
}
