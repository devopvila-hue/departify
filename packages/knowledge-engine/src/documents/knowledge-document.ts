import type { KnowledgeEngineEvent } from "../events/knowledge-events.js";
import { KnowledgeLifecyclePolicy } from "../lifecycle/knowledge-lifecycle.js";
import type { KnowledgeSourceSnapshot } from "../sources/knowledge-source.js";
import { KnowledgeSource } from "../sources/knowledge-source.js";
import {
  knowledgeContentTypes,
  knowledgeScopes,
  knowledgeStatuses,
  type KnowledgeContentType,
  type KnowledgeScope,
  type KnowledgeStatus,
} from "../knowledge/knowledge-types.js";
import { assertKnowledgeValid } from "../validation/knowledge-error.js";
import {
  KnowledgeChunk,
  type KnowledgeChunkSnapshot,
} from "./knowledge-chunk.js";

export interface KnowledgeDocumentSnapshot {
  id: string;
  organizationId: string;
  collectionId: string;
  scope: KnowledgeScope;
  status: KnowledgeStatus;
  title: string;
  contentType: KnowledgeContentType;
  source: KnowledgeSourceSnapshot;
  chunks: readonly KnowledgeChunkSnapshot[];
  tags: readonly string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateKnowledgeDocumentInput {
  id: string;
  organizationId: string;
  collectionId: string;
  scope: KnowledgeScope;
  title: string;
  contentType: KnowledgeContentType;
  source: KnowledgeSourceSnapshot;
  chunks: readonly KnowledgeChunkSnapshot[];
  tags?: readonly string[];
  createdAt?: Date;
}

export class KnowledgeDocument {
  private readonly lifecycle = new KnowledgeLifecyclePolicy();
  private readonly events: KnowledgeEngineEvent[] = [];

  private constructor(private snapshot: KnowledgeDocumentSnapshot) {}

  static create(input: CreateKnowledgeDocumentInput): KnowledgeDocument {
    const now = input.createdAt ?? new Date();
    const document = new KnowledgeDocument({
      id: normalize(input.id, "Knowledge document id"),
      organizationId: normalize(input.organizationId, "Organization id"),
      collectionId: normalize(input.collectionId, "Knowledge collection id"),
      scope: validateScope(input.scope),
      status: "draft",
      title: normalizeTitle(input.title),
      contentType: validateContentType(input.contentType),
      source: KnowledgeSource.create(input.source).toSnapshot(),
      chunks: validateChunks(input.id, input.chunks),
      tags: normalizeTags(input.tags ?? []),
      createdAt: now,
      updatedAt: now,
    });
    document.record({
      type: "knowledge.created",
      documentId: document.snapshot.id,
      collectionId: document.snapshot.collectionId,
      sourceId: document.snapshot.source.id,
      occurredAt: now,
    });
    return document;
  }

  static reconstitute(snapshot: KnowledgeDocumentSnapshot): KnowledgeDocument {
    assertKnowledgeValid(
      knowledgeStatuses.includes(snapshot.status),
      "Knowledge status is invalid.",
    );
    return new KnowledgeDocument({
      id: normalize(snapshot.id, "Knowledge document id"),
      organizationId: normalize(snapshot.organizationId, "Organization id"),
      collectionId: normalize(snapshot.collectionId, "Knowledge collection id"),
      scope: validateScope(snapshot.scope),
      status: snapshot.status,
      title: normalizeTitle(snapshot.title),
      contentType: validateContentType(snapshot.contentType),
      source: KnowledgeSource.create(snapshot.source).toSnapshot(),
      chunks: validateChunks(snapshot.id, snapshot.chunks),
      tags: normalizeTags(snapshot.tags),
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
    });
  }

  getStatus(): KnowledgeStatus {
    return this.snapshot.status;
  }

  activate(occurredAt = new Date()): void {
    this.transitionTo("active", occurredAt);
  }

  markIndexed(indexPlanId: string, occurredAt = new Date()): void {
    this.transitionTo("indexed", occurredAt);
    this.record({
      type: "knowledge.indexed",
      documentId: this.snapshot.id,
      indexPlanId: normalize(indexPlanId, "Index plan id"),
      occurredAt,
    });
  }

  updateTitle(title: string, occurredAt = new Date()): void {
    this.assertMutable();
    this.snapshot = {
      ...this.snapshot,
      title: normalizeTitle(title),
      updatedAt: occurredAt,
    };
    this.record({
      type: "knowledge.updated",
      documentId: this.snapshot.id,
      occurredAt,
    });
  }

  archive(occurredAt = new Date()): void {
    this.transitionTo("archived", occurredAt);
    this.record({
      type: "knowledge.archived",
      documentId: this.snapshot.id,
      occurredAt,
    });
  }

  delete(occurredAt = new Date()): void {
    this.transitionTo("deleted", occurredAt);
    this.record({
      type: "knowledge.deleted",
      documentId: this.snapshot.id,
      occurredAt,
    });
  }

  pullEvents(): readonly KnowledgeEngineEvent[] {
    const pulled = [...this.events];
    this.events.length = 0;
    return pulled;
  }

  toSnapshot(): KnowledgeDocumentSnapshot {
    return {
      ...this.snapshot,
      source: { ...this.snapshot.source },
      chunks: this.snapshot.chunks.map((chunk) => ({
        ...chunk,
        metadata: { ...chunk.metadata },
      })),
      tags: [...this.snapshot.tags],
    };
  }

  private transitionTo(status: KnowledgeStatus, occurredAt: Date): void {
    this.lifecycle.assertTransition(this.snapshot.status, status);
    this.snapshot = {
      ...this.snapshot,
      status,
      updatedAt: occurredAt,
    };
  }

  private assertMutable(): void {
    assertKnowledgeValid(
      this.snapshot.status !== "deleted",
      "Deleted knowledge documents cannot be modified.",
    );
  }

  private record(event: KnowledgeEngineEvent): void {
    this.events.push(event);
  }
}

function normalize(value: string, field: string): string {
  const normalized = value.trim();
  assertKnowledgeValid(normalized.length >= 2, `${field} is required.`);
  return normalized;
}

function normalizeTitle(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  assertKnowledgeValid(
    normalized.length >= 2 && normalized.length <= 160,
    "Knowledge title must be between 2 and 160 characters.",
  );
  return normalized;
}

function validateScope(scope: KnowledgeScope): KnowledgeScope {
  assertKnowledgeValid(
    knowledgeScopes.includes(scope),
    "Knowledge scope is invalid.",
  );
  return scope;
}

function validateContentType(
  contentType: KnowledgeContentType,
): KnowledgeContentType {
  assertKnowledgeValid(
    knowledgeContentTypes.includes(contentType),
    "Knowledge content type is invalid.",
  );
  return contentType;
}

function validateChunks(
  documentId: string,
  chunks: readonly KnowledgeChunkSnapshot[],
): readonly KnowledgeChunkSnapshot[] {
  assertKnowledgeValid(
    chunks.length > 0,
    "Knowledge document requires at least one chunk.",
  );
  const normalized = chunks.map((chunk) =>
    KnowledgeChunk.create(chunk).toSnapshot(),
  );
  normalized.forEach((chunk) => {
    assertKnowledgeValid(
      chunk.documentId === documentId,
      "Knowledge chunk documentId must match the document.",
    );
  });
  return normalized;
}

function normalizeTags(tags: readonly string[]): readonly string[] {
  assertKnowledgeValid(
    tags.length <= 20,
    "Knowledge document cannot contain more than 20 tags.",
  );
  const normalized = tags.map((tag) => tag.trim().toLowerCase());
  assertKnowledgeValid(
    new Set(normalized).size === normalized.length,
    "Knowledge tags cannot contain duplicates.",
  );
  normalized.forEach((tag) => {
    assertKnowledgeValid(
      /^[a-z][a-z0-9._-]{1,47}$/.test(tag),
      "Knowledge tag must be a safe code between 2 and 48 characters.",
    );
  });
  return normalized;
}
