import type { KnowledgeDocumentSnapshot } from "../documents/knowledge-document.js";
import type { KnowledgeRankingPolicy } from "../ranking/ranking-policy.js";
import type { KnowledgeSelectionPolicy } from "../policies/knowledge-selection-policy.js";

export interface KnowledgeRetrievalRequest {
  organizationId: string;
  query: string;
  selectionPolicy: KnowledgeSelectionPolicy;
  rankingPolicy: KnowledgeRankingPolicy;
  limit: number;
}

export interface KnowledgeRetrievalResult {
  documents: readonly KnowledgeDocumentSnapshot[];
}

export interface KnowledgeRetrievalPort {
  retrieve(
    request: KnowledgeRetrievalRequest,
  ): Promise<KnowledgeRetrievalResult>;
}
