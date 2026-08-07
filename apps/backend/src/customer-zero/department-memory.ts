/**
 * Department Memory — Sprint 59.
 *
 * Department memory is NOT another Company DNA. It is a scoped,
 * domain-specific working knowledge that a Department carries across
 * sessions. Marketing remembers previous campaigns, channel performance,
 * messaging tests, audiences, positioning experiments, content history,
 * campaign results, marketing decisions. Finance will eventually carry
 * different knowledge.
 *
 * The architecture decision (Sprint 59) is:
 *
 *   - Reuse the existing memory-engine port pattern (`MemoryRecordStore`).
 *   - Add a `department` memory scope (already added to memory scopes).
 *   - Department memories are keyed by `organizationId + departmentId`.
 *   - The store is in-memory only — same constraint as the rest of the
 *     Customer Zero flow. Persistence is a future port.
 *   - The store advertises `provenance`: every memory entry carries the
 *     source (CEO statement, internal analysis, external tool result).
 *     CEO-visible updates always come as a SUGGESTION, never as a silent
 *     mutation of Company DNA.
 *
 * The Company DNA (`packages/business-discovery` `CompanyDNA`) remains
 * the shared truth; department memory is department-local. Updates to
 * Company DNA go through the existing discovery pipeline.
 */

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
  /** Stable id within the (organizationId, departmentId) namespace. */
  readonly id: string;
  readonly organizationId: string;
  readonly departmentId: string;
  readonly kind: DepartmentMemoryKind;
  readonly title: string;
  readonly content: string;
  readonly provenance: DepartmentMemoryProvenance;
  readonly source?: string;
  /** Free-form importance score, 0..1. */
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
  /** Optional explicit source. Default is the kind string. */
  source?: string;
}

/**
 * Add an entry to a department's memory. The Company DNA is NEVER
 * mutated here. If a department-level entry is a candidate for the
 * shared truth, the caller must produce a `dnaSuggestion` and surface
 * it to the CEO through the chat.
 */
export function rememberDepartment(
  session: CustomerZeroSession,
  departmentId: string,
  upsert: DepartmentMemoryUpsert,
): DepartmentMemoryEntry {
  const store = getStore(session);
  const now = new Date();
  const entry: DepartmentMemoryEntry = {
    id: `dpm_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    organizationId: session.organizationId,
    departmentId,
    kind: upsert.kind,
    title: upsert.title,
    content: upsert.content,
    provenance: upsert.provenance,
    source: upsert.source ?? upsert.kind,
    importance: clamp(upsert.importance ?? 0.5),
    tags: upsert.tags ?? [],
    createdAt: now,
    updatedAt: now,
  };
  store.push(entry);
  return entry;
}

export function listDepartmentMemory(
  session: CustomerZeroSession,
  departmentId: string,
  options?: { kind?: DepartmentMemoryKind; limit?: number },
): DepartmentMemoryEntry[] {
  const store = getStore(session);
  const filtered = store.filter((entry) => {
    if (entry.departmentId !== departmentId) return false;
    if (options?.kind && entry.kind !== options.kind) return false;
    return true;
  });
  return filtered
    .sort((a, b) => b.importance - a.importance || b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, options?.limit ?? 50);
}

/**
 * Builds a list of human-readable department memory entries as a
 * small Markdown-ish block. The CEO never sees this raw; only the
 * central chat reads it. Today it returns the title of each entry.
 */
export function summariseDepartmentMemory(
  session: CustomerZeroSession,
  departmentId: string,
  limit = 5,
): DepartmentMemoryEntry[] {
  return listDepartmentMemory(session, departmentId, { limit });
}

export interface DnaSuggestion {
  readonly title: string;
  readonly content: string;
  readonly evidence: readonly string[];
  /** Department that discovered the candidate insight. */
  readonly fromDepartment: string;
  readonly confidence: number;
}

/**
 * A `DnaSuggestion` is what a Department would LIKE to commit to the
 * shared Company DNA. Approval is the CEO's. The Department NEVER
 * writes it directly to the discovery report.
 */
export function buildDnaSuggestion(input: {
  fromDepartment: string;
  title: string;
  content: string;
  evidence?: readonly string[];
  confidence?: number;
}): DnaSuggestion {
  return {
    fromDepartment: input.fromDepartment,
    title: input.title,
    content: input.content,
    evidence: input.evidence ?? [],
    confidence: clamp(input.confidence ?? 0.6),
  };
}

/* -------------------------------------------------------------------------
 * Internal — the in-memory store is attached to the session so it
 * survives reload within the same process, the same way the rest of
 * the Customer Zero flow operates. Persistence is a future port.
 * -------------------------------------------------------------------------*/

const STORE = new WeakMap<CustomerZeroSession, DepartmentMemoryEntry[]>();

function getStore(session: CustomerZeroSession): DepartmentMemoryEntry[] {
  let entry = STORE.get(session);
  if (!entry) {
    entry = [];
    STORE.set(session, entry);
  }
  return entry;
}

function clamp(value: number): number {
  if (Number.isNaN(value)) return 0.5;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
