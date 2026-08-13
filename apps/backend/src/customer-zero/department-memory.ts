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
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AuthConfig } from "@departify/config";
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

export interface DepartmentMemoryStore {
  upsert(entry: DepartmentMemoryEntry): Promise<void>;
  list(organizationId: string, departmentId: string, limit?: number): Promise<DepartmentMemoryEntry[]>;
}

/** Durable adapter; the in-memory MemoryRecord store remains the hot cache. */
export class SupabaseDepartmentMemoryStore implements DepartmentMemoryStore {
  private readonly admin: SupabaseClient;
  constructor(config: AuthConfig) {
    this.admin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
  }
  async upsert(entry: DepartmentMemoryEntry): Promise<void> {
    const { error } = await this.admin.from("department_memory").upsert({
      id: entry.id,
      organization_id: entry.organizationId,
      department_id: entry.departmentId,
      kind: entry.kind,
      title: entry.title,
      content: entry.content,
      provenance: entry.provenance,
      source: entry.source ?? null,
      importance: entry.importance,
      tags: entry.tags,
      created_at: entry.createdAt.toISOString(),
      updated_at: entry.updatedAt.toISOString(),
    });
    if (error) throw error;
  }
  async list(organizationId: string, departmentId: string, limit = 100): Promise<DepartmentMemoryEntry[]> {
    const { data, error } = await this.admin.from("department_memory").select("*")
      .eq("organization_id", organizationId).eq("department_id", departmentId)
      .order("created_at", { ascending: false }).limit(Math.min(limit, 200));
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: String(row.id), organizationId: String(row.organization_id), departmentId: String(row.department_id),
      kind: row.kind as DepartmentMemoryKind, title: String(row.title), content: String(row.content),
      provenance: row.provenance as DepartmentMemoryProvenance,
      ...(row.source ? { source: String(row.source) } : {}), importance: Number(row.importance),
      tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
      createdAt: new Date(String(row.created_at)), updatedAt: new Date(String(row.updated_at)),
    }));
  }
}

export interface DnaSuggestion {
  readonly title: string;
  readonly content: string;
  readonly evidence: readonly string[];
  readonly fromDepartment: string;
  readonly confidence: number;
  /** IDs of the canonical memory records that back this suggestion. */
  readonly sourceMemoryIds: readonly string[];
  /** Department memory kind — determines which Company DNA field to target. */
  readonly kind: DepartmentMemoryKind;
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
  const entry = {
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
  if (session.departmentMemory) void session.departmentMemory.upsert(entry);
  return entry;
}

export async function hydrateDepartmentMemory(
  session: CustomerZeroSession,
  departmentId = "marketing",
): Promise<void> {
  if (!session.departmentMemory) return;
  const entries = await session.departmentMemory.list(session.organizationId, departmentId, 100);
  for (const entry of entries) {
    const record = MemoryRecord.create({
      id: entry.id,
      organizationId: entry.organizationId,
      departmentId: entry.departmentId,
      kind: "department",
      scope: "department",
      content: entry.title ? `[${entry.title}] ${entry.content}` : entry.content,
      priority: toPriority(entry.importance),
      tags: buildCanonicalTags(entry.kind, entry.provenance, entry.tags),
    });
    await session.memoryStore.create(record.toSnapshot());
  }
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
  kind: DepartmentMemoryKind;
  evidence?: readonly string[];
  confidence?: number;
  sourceMemoryIds?: readonly string[];
}): DnaSuggestion {
  return {
    fromDepartment: input.fromDepartment,
    title: input.title,
    content: input.content,
    kind: input.kind,
    evidence: input.evidence ?? [],
    confidence: clamp(input.confidence ?? 0.6),
    sourceMemoryIds: input.sourceMemoryIds ?? [],
  };
}

/** Maps department memory kinds to their canonical Company DNA target fields.
 *  Kinds mapped to `null` have no semantically valid promotion path yet. */
export const KIND_TO_DNA_TARGET: Readonly<
  Record<DepartmentMemoryKind, string | null>
> = {
  audience: "idealCustomer",
  positioning: "positioning",
  messaging: "tone",
  campaign: null,
  channel: null,
  experiment: null,
  content: null,
  result: "strengths",
  decision: "objectives",
  note: null,
};

export class DnaPromotionError extends Error {
  constructor(public readonly kind: DepartmentMemoryKind) {
    super(
      `Department memory kind '${kind}' has no canonical Company DNA mapping.`,
    );
    this.name = "DnaPromotionError";
  }
}

/**
 * Produces a `RawCompanyDna`-shaped payload for the discovery pipeline.
 * Maps the suggestion's department memory `kind` to the correct canonical
 * Company DNA field. Kinds with no mapping throw `DnaPromotionError`.
 */
export function buildDnaRawDataFromSuggestion(
  suggestion: Pick<
    DnaSuggestion,
    "title" | "content" | "fromDepartment" | "kind"
  >,
): Readonly<Record<string, unknown>> {
  const target = KIND_TO_DNA_TARGET[suggestion.kind];
  if (!target) {
    throw new DnaPromotionError(suggestion.kind);
  }

  const text = suggestion.title
    ? `[Promovido desde ${suggestion.fromDepartment}] ${suggestion.title}: ${suggestion.content}`
    : suggestion.content;

  switch (target) {
    case "idealCustomer":
      return {
        idealCustomer: {
          demographics: [text],
          psychographics: [],
          painPoints: [],
          buyingBehavior: [],
          confidence: "medium",
        },
      };
    case "positioning":
      return {
        positioning: {
          statement: text,
          differentiation: [],
          confidence: "medium",
        },
      };
    case "tone":
      return {
        tone: {
          personality: [],
          voice: text,
          styleExamples: [],
          confidence: "medium",
        },
      };
    case "strengths":
      return {
        strengths: [
          {
            id: `str_prom_${Date.now().toString(36)}`,
            category: suggestion.fromDepartment,
            description: text,
            evidence: [],
            confidence: "medium",
          },
        ],
      };
    case "objectives":
      return {
        objectives: [
          {
            id: `obj_prom_${Date.now().toString(36)}`,
            title: suggestion.title,
            description: suggestion.content,
            timeframe: "current",
            priority: "medium" as const,
            status: "planned" as const,
            confidence: "medium",
          },
        ],
      };
    default:
      throw new DnaPromotionError(suggestion.kind);
  }
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
