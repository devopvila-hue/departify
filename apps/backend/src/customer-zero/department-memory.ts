/**
 * Department Memory — Sprint 60.
 *
 * Canonical memory architecture. ALL department knowledge flows through
 * the canonical `packages/memory-engine` `MemoryRecord` aggregate and
 * persists through the `InMemoryMemoryRecordStore` adapter (the concrete
 * implementation of `MemoryRecordStore`).
 *
 * The Sprint 59 `WeakMap`-based store is removed. Every memory write
 * creates a `MemoryRecord` with `scope: "department"` and tags that
 * encode the DepartmentMemoryKind and DepartmentMemoryProvenance.
 *
 * Company DNA is NEVER mutated from department memory. DNA promotion
 * produces a `DnaSuggestion`; only explicit CEO approval invokes the
 * canonical Company DNA mutation path.
 */
import { MemoryRecord } from "@departify/memory-engine";
import type { CustomerZeroSession } from "./customer-zero-session.js";

export type DepartmentMemoryKind =
  | "campaign"
  | "channel"
  | "audience"
  | "messaging"
  | "positioning"
  | "experiment"
  | "content"
  | "result"
  | "decision"
  | "note";

export type DepartmentMemoryProvenance =
  | "ceo_statement"
  | "conversation"
  | "internal_analysis"
  | "external_tool"
  | "discovery";

export interface DepartmentMemoryEntry {
  readonly id: string;
  readonly organizationId: string;
  readonly departmentId: string;
  readonly kind: DepartmentMemoryKind;
  readonly title: string;
  readonly content: string;
  readonly provenance: DepartmentMemoryProvenance;
  readonly source?: string;
  readonly importance: number;
  readonly tags: readonly string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface DepartmentMemoryUpsert {
  kind: DepartmentMemoryKind;
  title: string;
  content: string;
  provenance: DepartmentMemoryProvenance;
  importance?: number;
  tags?: readonly string[];
  source?: string;
}

export interface DnaSuggestion {
  readonly title: string;
  readonly content: string;
  readonly evidence: readonly string[];
  readonly fromDepartment: string;
  readonly confidence: number;
  /** IDs of the canonical memory records that back this suggestion. */
  readonly sourceMemoryIds: readonly string[];
}

export function rememberDepartment(
  session: CustomerZeroSession,
  departmentId: string,
  upsert: DepartmentMemoryUpsert,
): DepartmentMemoryEntry {
  const store = session.memoryStore;
  const importance = clamp(upsert.importance ?? 0.5);
  const id = `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  const tags = buildCanonicalTags(
    upsert.kind,
    upsert.provenance,
    upsert.tags,
  );

  const fullContent = upsert.title && upsert.title !== upsert.content
    ? `[${upsert.title}] ${upsert.content}`
    : upsert.content;

  const record = MemoryRecord.create({
    id,
    organizationId: session.organizationId,
    departmentId,
    kind: "department",
    scope: "department",
    content: fullContent,
    priority: toPriority(importance),
    tags,
  });

  void store.create(record.toSnapshot());

  const snapshot = record.toSnapshot();
  const now = new Date();
  return {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    departmentId: snapshot.departmentId ?? departmentId,
    kind: upsert.kind,
    title: upsert.title,
    content: upsert.content,
    provenance: upsert.provenance,
    source: upsert.source ?? upsert.kind,
    importance,
    tags: upsert.tags ?? [],
    createdAt: snapshot.createdAt,
    updatedAt: now,
  };
}

export function listDepartmentMemory(
  session: CustomerZeroSession,
  departmentId: string,
  options?: { kind?: DepartmentMemoryKind; limit?: number },
): DepartmentMemoryEntry[] {
  const store = session.memoryStore;
  const snapshots = store.list({
    organizationId: session.organizationId,
    departmentId,
    scope: "department",
    ...(options?.kind ? { tag: kindTag(options.kind) } : {}),
    limit: options?.limit ?? 50,
  });

  return snapshots.map(mapSnapshotToEntry);
}

export function summariseDepartmentMemory(
  session: CustomerZeroSession,
  departmentId: string,
  limit = 5,
): DepartmentMemoryEntry[] {
  return listDepartmentMemory(session, departmentId, { limit });
}

export function findSimilarDepartmentMemory(
  session: CustomerZeroSession,
  departmentId: string,
  content: string,
): boolean {
  return session.memoryStore.hasSimilar(departmentId, content);
}

export function buildDnaSuggestion(input: {
  fromDepartment: string;
  title: string;
  content: string;
  evidence?: readonly string[];
  confidence?: number;
  sourceMemoryIds?: readonly string[];
}): DnaSuggestion {
  return {
    fromDepartment: input.fromDepartment,
    title: input.title,
    content: input.content,
    evidence: input.evidence ?? [],
    confidence: clamp(input.confidence ?? 0.6),
    sourceMemoryIds: input.sourceMemoryIds ?? [],
  };
}

/* -------------------------------------------------------------------------
 * Internal — tag encoding for DepartmentMemoryKind and provenance.
 * The canonical Memory Engine tags must match /^[a-z][a-z0-9._-]{1,47}$/
 * -------------------------------------------------------------------------*/

function kindTag(kind: DepartmentMemoryKind): string {
  return `kind.${kind}`;
}

function provenanceTag(provenance: DepartmentMemoryProvenance): string {
  return `prov.${provenance}`;
}

function buildCanonicalTags(
  kind: DepartmentMemoryKind,
  provenance: DepartmentMemoryProvenance,
  extraTags: readonly string[] | undefined,
): readonly string[] {
  const tags = [kindTag(kind), provenanceTag(provenance)];
  if (extraTags) {
    for (const tag of extraTags) {
      tags.push(tag.trim().toLowerCase());
    }
  }
  return tags;
}

function mapSnapshotToEntry(
  snapshot: ReturnType<MemoryRecord["toSnapshot"]>,
): DepartmentMemoryEntry {
  const tags = snapshot.tags;
  const kind = extractKindFromTags(tags) ?? "note";
  const provenance = extractProvenanceFromTags(tags) ?? "conversation";
  const userTags = tags.filter(
    (t: string) => !t.startsWith("kind.") && !t.startsWith("prov."),
  );
  const content = snapshot.content.replace(/^\[.*?\]\s*/, "");
  const titleMatch = snapshot.content.match(/^\[(.*?)\]\s*/);

  return {
    id: snapshot.id,
    organizationId: snapshot.organizationId,
    departmentId: snapshot.departmentId ?? "unknown",
    kind,
    title: titleMatch ? titleMatch[1] ?? "" : "",
    content,
    provenance,
    importance: fromPriority(snapshot.priority),
    tags: userTags,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  };
}

function extractKindFromTags(
  tags: readonly string[],
): DepartmentMemoryKind | null {
  for (const tag of tags) {
    if (tag.startsWith("kind.")) {
      const kind = tag.slice(5) as DepartmentMemoryKind;
      if (kind.length > 0) return kind;
    }
  }
  return null;
}

function extractProvenanceFromTags(
  tags: readonly string[],
): DepartmentMemoryProvenance | null {
  for (const tag of tags) {
    if (tag.startsWith("prov.")) {
      const prov = tag.slice(5) as DepartmentMemoryProvenance;
      if (prov.length > 0) return prov;
    }
  }
  return null;
}

function toPriority(importance: number): number {
  return clamp(Math.round(importance * 100), 1, 100);
}

function fromPriority(priority: number): number {
  return clamp(priority / 100);
}

function clamp(value: number, min = 0, max = 1): number {
  if (Number.isNaN(value)) return 0.5;
  return Math.max(min, Math.min(max, value));
}
