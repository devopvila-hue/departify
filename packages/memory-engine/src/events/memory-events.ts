export const memoryEventTypes = [
  "memory.created",
  "memory.updated",
  "memory.archived",
  "memory.expired",
  "memory.deleted",
] as const;

export type MemoryEventType = (typeof memoryEventTypes)[number];

export interface MemoryEvent<TType extends MemoryEventType = MemoryEventType> {
  type: TType;
  memoryId: string;
  occurredAt: Date;
}

export interface MemoryCreatedEvent extends MemoryEvent<"memory.created"> {
  kind: string;
  scope: string;
}

export type MemoryUpdatedEvent = MemoryEvent<"memory.updated">;
export type MemoryArchivedEvent = MemoryEvent<"memory.archived">;
export type MemoryExpiredEvent = MemoryEvent<"memory.expired">;
export type MemoryDeletedEvent = MemoryEvent<"memory.deleted">;

export type MemoryEngineEvent =
  | MemoryCreatedEvent
  | MemoryUpdatedEvent
  | MemoryArchivedEvent
  | MemoryExpiredEvent
  | MemoryDeletedEvent;
