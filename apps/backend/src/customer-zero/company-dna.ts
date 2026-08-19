/**
 * Company DNA — the canonical, durable understanding of a company.
 *
 * WHY THIS EXISTS
 *
 * Departify must not start working for a company before it actually
 * understands the company. Until now that understanding lived only in a
 * process-local `Map`: it died on every backend restart, it could not be
 * reconstructed, and the readiness gate was therefore evaluating facts
 * that proved nothing durable.
 *
 * This module is the single source of truth for:
 *
 *   1. WHAT Departify knows about the company (durable business facts).
 *   2. WHETHER that knowledge is complete enough to operate on
 *      (`evaluateDnaCompleteness`).
 *   3. HOW that knowledge was established (the readiness milestones).
 *
 * BOUNDARIES — Company DNA is NOT a dumping ground.
 *
 * It holds durable business facts only. It never absorbs email bodies,
 * documents, chat transcripts, credentials, OAuth tokens, secrets or
 * infrastructure instructions. Conversation history stays in the
 * conversation store; department memory stays in department memory;
 * credentials stay in the credential layer. `declaredTools` records what
 * the CEO SAYS the company uses — a business fact, never a claim that a
 * tool is connected. Real connection health lives in the tool state
 * store and is never inferred from here.
 */

/** Where a fact came from. Never invented. */
export type FactProvenance = "research" | "ceo" | "inferred";

/**
 * The canonical durable Company DNA record.
 *
 * Absent fields mean "not known" — never "assumed". A field is only
 * populated when there is real evidence for it.
 */
export interface CompanyDnaRecord {
  readonly organizationId: string;

  /** Basic intake. */
  readonly companyName: string;
  readonly website?: string;
  readonly description?: string;
  readonly country?: string;
  readonly companySize?: string;
  readonly objective?: string;

  /** Business understanding, grounded in research or the CEO's words. */
  readonly products: readonly string[];
  readonly customers: readonly string[];
  readonly geography?: string;
  readonly businessModel?: string;
  readonly positioning?: string;
  readonly channels: readonly string[];

  /** What the CEO declared they use. NOT connection state. */
  readonly declaredTools: readonly string[];

  /** What Departify honestly does not know yet. */
  readonly uncertainties: readonly string[];

  /** Per-field origin, for honesty about what was inferred. */
  readonly provenance: Readonly<Record<string, FactProvenance>>;

  /** Durable readiness milestones — proof, not frontend progress. */
  readonly researchCompletedAt?: string;
  readonly blockingDiscoveryCompletedAt?: string;
  readonly ceoConfirmedAt?: string;
  readonly departmentProvisionedAt?: string;

  /**
   * Moves whenever canonical business facts change. A confirmation is
   * only valid while `ceoConfirmedAt >= factsUpdatedAt` — correcting the
   * company after confirming invalidates the confirmation.
   */
  readonly factsUpdatedAt: string;

  /**
   * Sprint 67 P0.1-A — Personal identity. How the entrepreneur wants to
   * be called, captured once by the chat. This is NOT a business fact:
   * writing it never moves `factsUpdatedAt` and never invalidates a CEO
   * confirmation. Absent/null means "not known yet".
   */
  readonly entrepreneurPreferredName?: string | null;
  /**
   * Sprint 67 P0.1-A — when Departify last had its one chance to ask
   * for the name. Bounds the ask to at most once, durably, across
   * reloads and conversations. Not a business fact either.
   */
  readonly entrepreneurNameRequestedAt?: string | null;
}

/**
 * Durable Company DNA persistence. Implemented by Supabase in
 * production and in-memory in tests.
 */
export interface CompanyDnaStore {
  get(organizationId: string): Promise<CompanyDnaRecord | null>;
  upsert(record: CompanyDnaRecord): Promise<void>;
}

/** A missing piece of the minimum operational understanding. */
export type DnaGap =
  | "company_name"
  | "what_the_company_does"
  | "objective"
  | "geography";

export interface DnaCompleteness {
  readonly complete: boolean;
  readonly missing: readonly DnaGap[];
}

function hasText(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * THE COMPANY DNA COMPLETENESS CONTRACT.
 *
 * `hasCompanyDna` must never mean "a row exists" or "a company name was
 * typed". It means: the record carries the minimum operational business
 * facts the product actually needs to work for this company.
 *
 * The minimum is deliberately small — four facts, each one genuinely
 * required to ground a department's work:
 *
 *   - the company's name;
 *   - what the company does (a description or at least one product);
 *   - the CEO's current objective (what "working" means right now);
 *   - where it operates (geography or country).
 *
 * Everything else is enrichment: valuable, but not a reason to keep the
 * CEO waiting at the door.
 */
export function evaluateDnaCompleteness(
  record: CompanyDnaRecord | null,
): DnaCompleteness {
  if (!record) {
    return {
      complete: false,
      missing: ["company_name", "what_the_company_does", "objective", "geography"],
    };
  }
  const missing: DnaGap[] = [];
  if (!hasText(record.companyName)) missing.push("company_name");
  if (!hasText(record.description) && record.products.length === 0) {
    missing.push("what_the_company_does");
  }
  if (!hasText(record.objective)) missing.push("objective");
  if (!hasText(record.geography) && !hasText(record.country)) {
    missing.push("geography");
  }
  return { complete: missing.length === 0, missing };
}

/**
 * A confirmation only counts while it is NEWER than the facts it
 * confirmed. If the CEO corrects the company afterwards, the
 * confirmation is stale and readiness must fall back to false until they
 * confirm the corrected understanding.
 */
export function isConfirmationCurrent(record: CompanyDnaRecord | null): boolean {
  if (!record?.ceoConfirmedAt) return false;
  return (
    new Date(record.ceoConfirmedAt).getTime() >=
    new Date(record.factsUpdatedAt).getTime()
  );
}

/** In-memory Company DNA store — tests and local slices. */
export class InMemoryCompanyDnaStore implements CompanyDnaStore {
  private readonly rows = new Map<string, CompanyDnaRecord>();

  async get(organizationId: string): Promise<CompanyDnaRecord | null> {
    return this.rows.get(organizationId) ?? null;
  }

  async upsert(record: CompanyDnaRecord): Promise<void> {
    this.rows.set(record.organizationId, record);
  }
}

/**
 * Process-level fallback used when no durable store is wired (dev and
 * tests). Production always injects the Supabase store through
 * `ServerDeps.companyDna`.
 *
 * It is deliberately a real store rather than a no-op: the readiness
 * contract must behave identically in tests, otherwise the tests would
 * prove nothing about production.
 */
let fallbackStore: CompanyDnaStore = new InMemoryCompanyDnaStore();

export function getFallbackCompanyDnaStore(): CompanyDnaStore {
  return fallbackStore;
}

/** Test support: clears the fallback store (simulates a fresh process). */
export function resetFallbackCompanyDnaStoreForTest(): void {
  fallbackStore = new InMemoryCompanyDnaStore();
}

/** Creates an empty DNA record for a brand-new organization. */
export function createCompanyDnaRecord(
  organizationId: string,
  companyName: string,
  now: string,
): CompanyDnaRecord {
  return {
    organizationId,
    companyName,
    products: [],
    customers: [],
    channels: [],
    declaredTools: [],
    uncertainties: [],
    provenance: {},
    factsUpdatedAt: now,
  };
}
