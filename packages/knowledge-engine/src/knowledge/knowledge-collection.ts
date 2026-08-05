import type { KnowledgeScope } from "./knowledge-types.js";
import { knowledgeScopes } from "./knowledge-types.js";
import { assertKnowledgeValid } from "../validation/knowledge-error.js";

export interface KnowledgeCollectionSnapshot {
  id: string;
  organizationId: string;
  name: string;
  scope: KnowledgeScope;
  description?: string;
}

export class KnowledgeCollection {
  private constructor(private readonly snapshot: KnowledgeCollectionSnapshot) {}

  static create(snapshot: KnowledgeCollectionSnapshot): KnowledgeCollection {
    const collection: KnowledgeCollectionSnapshot = {
      id: normalize(snapshot.id, "Knowledge collection id"),
      organizationId: normalize(snapshot.organizationId, "Organization id"),
      name: normalize(snapshot.name, "Knowledge collection name"),
      scope: validateScope(snapshot.scope),
    };
    const description = snapshot.description?.trim().replace(/\s+/g, " ");
    if (description) {
      assertKnowledgeValid(
        description.length <= 500,
        "Knowledge collection description cannot exceed 500 characters.",
      );
      collection.description = description;
    }
    return new KnowledgeCollection(collection);
  }

  toSnapshot(): KnowledgeCollectionSnapshot {
    return { ...this.snapshot };
  }
}

function validateScope(scope: KnowledgeScope): KnowledgeScope {
  assertKnowledgeValid(
    knowledgeScopes.includes(scope),
    "Knowledge scope is invalid.",
  );
  return scope;
}

function normalize(value: string, field: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  assertKnowledgeValid(normalized.length >= 2, `${field} is required.`);
  return normalized;
}
