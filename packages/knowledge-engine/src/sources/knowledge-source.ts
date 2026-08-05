import { assertKnowledgeValid } from "../validation/knowledge-error.js";

export const knowledgeSourceTypes = [
  "manual",
  "upload",
  "integration",
  "system",
] as const;

export type KnowledgeSourceType = (typeof knowledgeSourceTypes)[number];

export interface KnowledgeSourceSnapshot {
  id: string;
  type: KnowledgeSourceType;
  name: string;
  reference?: string;
}

export class KnowledgeSource {
  private constructor(private readonly snapshot: KnowledgeSourceSnapshot) {}

  static create(snapshot: KnowledgeSourceSnapshot): KnowledgeSource {
    const source: KnowledgeSourceSnapshot = {
      id: normalize(snapshot.id, "Knowledge source id"),
      type: validateType(snapshot.type),
      name: normalize(snapshot.name, "Knowledge source name"),
    };
    const reference = snapshot.reference?.trim();
    if (reference) {
      source.reference = reference;
    }
    return new KnowledgeSource(source);
  }

  toSnapshot(): KnowledgeSourceSnapshot {
    return { ...this.snapshot };
  }
}

function validateType(type: KnowledgeSourceType): KnowledgeSourceType {
  assertKnowledgeValid(
    knowledgeSourceTypes.includes(type),
    "Knowledge source type is invalid.",
  );
  return type;
}

function normalize(value: string, field: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  assertKnowledgeValid(normalized.length >= 2, `${field} is required.`);
  return normalized;
}
