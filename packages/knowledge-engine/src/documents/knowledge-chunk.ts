import { assertKnowledgeValid } from "../validation/knowledge-error.js";

export interface KnowledgeChunkSnapshot {
  id: string;
  documentId: string;
  sequence: number;
  content: string;
  metadata: Readonly<Record<string, string>>;
}

export class KnowledgeChunk {
  private constructor(private readonly snapshot: KnowledgeChunkSnapshot) {}

  static create(snapshot: KnowledgeChunkSnapshot): KnowledgeChunk {
    return new KnowledgeChunk({
      id: normalize(snapshot.id, "Knowledge chunk id"),
      documentId: normalize(snapshot.documentId, "Knowledge document id"),
      sequence: validateSequence(snapshot.sequence),
      content: normalizeContent(snapshot.content),
      metadata: { ...snapshot.metadata },
    });
  }

  toSnapshot(): KnowledgeChunkSnapshot {
    return {
      ...this.snapshot,
      metadata: { ...this.snapshot.metadata },
    };
  }
}

function normalize(value: string, field: string): string {
  const normalized = value.trim();
  assertKnowledgeValid(normalized.length >= 2, `${field} is required.`);
  return normalized;
}

function normalizeContent(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  assertKnowledgeValid(
    normalized.length >= 3 && normalized.length <= 8000,
    "Knowledge chunk content must be between 3 and 8000 characters.",
  );
  return normalized;
}

function validateSequence(sequence: number): number {
  assertKnowledgeValid(
    Number.isInteger(sequence) && sequence >= 0,
    "Knowledge chunk sequence must be a non-negative integer.",
  );
  return sequence;
}
