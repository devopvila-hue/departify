import type { KnowledgeContentType } from "../knowledge/knowledge-types.js";
import { knowledgeContentTypes } from "../knowledge/knowledge-types.js";
import { assertKnowledgeValid } from "../validation/knowledge-error.js";

export const indexingStatuses = ["planned", "ready", "failed"] as const;

export type IndexingStatus = (typeof indexingStatuses)[number];

export interface KnowledgeIndexingPlan {
  id: string;
  documentId: string;
  contentType: KnowledgeContentType;
  chunkCount: number;
  status: IndexingStatus;
}

export function createIndexingPlan(
  plan: KnowledgeIndexingPlan,
): KnowledgeIndexingPlan {
  assertKnowledgeValid(
    plan.id.trim().length >= 2,
    "Indexing plan id is required.",
  );
  assertKnowledgeValid(
    plan.documentId.trim().length >= 2,
    "Indexing plan documentId is required.",
  );
  assertKnowledgeValid(
    knowledgeContentTypes.includes(plan.contentType),
    "Indexing content type is invalid.",
  );
  assertKnowledgeValid(
    Number.isInteger(plan.chunkCount) && plan.chunkCount > 0,
    "Indexing chunkCount must be a positive integer.",
  );
  assertKnowledgeValid(
    indexingStatuses.includes(plan.status),
    "Indexing status is invalid.",
  );
  return { ...plan };
}
