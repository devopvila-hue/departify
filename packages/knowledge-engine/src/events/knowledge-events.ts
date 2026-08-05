export const knowledgeEventTypes = [
  "knowledge.created",
  "knowledge.indexed",
  "knowledge.updated",
  "knowledge.archived",
  "knowledge.deleted",
] as const;

export type KnowledgeEventType = (typeof knowledgeEventTypes)[number];

export interface KnowledgeEvent<
  TType extends KnowledgeEventType = KnowledgeEventType,
> {
  type: TType;
  documentId: string;
  occurredAt: Date;
}

export interface KnowledgeCreatedEvent extends KnowledgeEvent<"knowledge.created"> {
  collectionId: string;
  sourceId: string;
}

export interface KnowledgeIndexedEvent extends KnowledgeEvent<"knowledge.indexed"> {
  indexPlanId: string;
}

export type KnowledgeUpdatedEvent = KnowledgeEvent<"knowledge.updated">;
export type KnowledgeArchivedEvent = KnowledgeEvent<"knowledge.archived">;
export type KnowledgeDeletedEvent = KnowledgeEvent<"knowledge.deleted">;

export type KnowledgeEngineEvent =
  | KnowledgeCreatedEvent
  | KnowledgeIndexedEvent
  | KnowledgeUpdatedEvent
  | KnowledgeArchivedEvent
  | KnowledgeDeletedEvent;
