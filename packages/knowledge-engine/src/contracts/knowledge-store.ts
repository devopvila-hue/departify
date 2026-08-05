import type {
  CreateKnowledgeDocumentInput,
  KnowledgeDocumentSnapshot,
} from "../documents/knowledge-document.js";
import type { KnowledgeCollectionSnapshot } from "../knowledge/knowledge-collection.js";

export interface KnowledgeDocumentStore {
  create(
    input: CreateKnowledgeDocumentInput,
  ): Promise<KnowledgeDocumentSnapshot>;
  update(
    document: KnowledgeDocumentSnapshot,
  ): Promise<KnowledgeDocumentSnapshot>;
  getById(id: string): Promise<KnowledgeDocumentSnapshot | null>;
}

export interface KnowledgeCollectionStore {
  create(
    collection: KnowledgeCollectionSnapshot,
  ): Promise<KnowledgeCollectionSnapshot>;
  getById(id: string): Promise<KnowledgeCollectionSnapshot | null>;
}
