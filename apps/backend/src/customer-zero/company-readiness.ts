/**
 * Company readiness — Customer Zero P0.
 *
 * THE CONTRACT THIS ENFORCES
 *
 * Departify may not start working for a company before it actually
 * understands the company. "Understands" is not a screen the CEO walked
 * past — it is a set of durable facts that survive a browser reload, a
 * backend restart and a production deploy.
 *
 * This module evaluates the five readiness facts from DURABLE storage
 * only. It never reads the in-memory Customer Zero session. That is the
 * whole point: if the answer depends on process memory, it proves
 * nothing about whether the brain exists.
 *
 * The gate itself (`evaluateReadiness`) is unchanged and still has
 * exactly five facts. What changes is their SEMANTICS:
 *
 *   hasCompanyDna            was `Boolean(anyReportObject)`
 *                            now  research really completed AND the
 *                                 record passes the completeness contract
 *
 *   ceoConfirmed             was a stage id that no code ever set —
 *                                 permanently false for every company
 *                            now  a durable confirmation that is still
 *                                 NEWER than the facts it confirmed
 *
 *   blockingDiscoveryComplete was in-memory answered-question set
 *                            now  a durable milestone
 *
 *   departmentProvisioned    was an in-memory department list
 *                            now  a durable milestone
 */

import {
  evaluateDnaCompleteness,
  getFallbackCompanyDnaStore,
  isConfirmationCurrent,
  type CompanyDnaRecord,
  type CompanyDnaStore,
  type FactProvenance,
} from "./company-dna.js";
import {
  evaluateReadiness,
  type ReadinessFacts,
  type ReadinessReport,
} from "./context-readiness.js";
import type { InterpretedBusiness } from "./web-analysis.js";
import type { OnboardingIntake } from "./customer-zero-session.js";

export interface DurableReadiness extends ReadinessReport {
  /** The durable record the verdict was computed from (null if none). */
  readonly record: CompanyDnaRecord | null;
  readonly facts: ReadinessFacts;
}

/**
 * The CANONICAL onboarding stage, derived from DURABLE evidence alone.
 *
 * This is the single product path:
 *
 *   intake         → no durable company record yet (or no intake facts)
 *   research       → intake durable, research not completed
 *   discovery      → research completed, blocking discovery not done
 *   understanding  → discovery done, CEO confirmation not (current)
 *   ready          → CEO confirmation current → chat
 *
 * The portal routes by this stage; the legacy conversation→handoff
 * terminal is no longer a product state. Existing organizations resume
 * at the earliest truthful incomplete stage.
 */
export type OnboardingStage =
  | "intake"
  | "research"
  | "discovery"
  | "understanding"
  | "ready";

export function durableOnboardingStage(
  record: CompanyDnaRecord | null,
  facts: ReadinessFacts,
): OnboardingStage {
  if (!record || !facts.hasIntake) return "intake";
  if (!facts.hasCompanyDna) return "research";
  if (!facts.blockingDiscoveryComplete) return "discovery";
  if (!facts.ceoConfirmed) return "understanding";
  return "ready";
}

function hasText(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Resolves the durable Company DNA store from server dependencies.
 *
 * Production always injects the Supabase store. Dev and tests fall back
 * to a real process-level in-memory store so the readiness contract
 * behaves identically — a no-op fallback would make the tests prove
 * nothing about production.
 *
 * Structurally typed on purpose: the domain layer must not depend on the
 * server's `ServerDeps` shape.
 */
export function resolveCompanyDnaStore(deps: {
  companyDna?: CompanyDnaStore;
}): CompanyDnaStore {
  return deps.companyDna ?? getFallbackCompanyDnaStore();
}

/**
 * Builds the five readiness facts from a durable Company DNA record.
 *
 * A null record means a brand-new organization: every fact is false.
 */
export function readinessFactsFromRecord(
  record: CompanyDnaRecord | null,
): ReadinessFacts {
  if (!record) {
    return {
      hasIntake: false,
      hasCompanyDna: false,
      ceoConfirmed: false,
      blockingDiscoveryComplete: false,
      departmentProvisioned: false,
    };
  }
  const completeness = evaluateDnaCompleteness(record);
  return {
    // Intake is real only when the CEO gave us a name AND something to
    // work from — a website or their own description.
    hasIntake:
      hasText(record.companyName) &&
      (hasText(record.website) || hasText(record.description)),
    // Research really finished AND the record carries the minimum
    // operational business facts. A row is not DNA.
    hasCompanyDna: Boolean(record.researchCompletedAt) && completeness.complete,
    // Confirmed, and not invalidated by a later correction.
    ceoConfirmed: isConfirmationCurrent(record),
    blockingDiscoveryComplete: Boolean(record.blockingDiscoveryCompletedAt),
    departmentProvisioned: Boolean(record.departmentProvisionedAt),
  };
}

/**
 * Evaluates readiness for an organization from durable storage alone.
 */
export async function evaluateDurableReadiness(
  organizationId: string,
  store: CompanyDnaStore,
): Promise<DurableReadiness> {
  const record = await store.get(organizationId);
  const facts = readinessFactsFromRecord(record);
  const report = evaluateReadiness(facts);
  return { ...report, record, facts };
}

/**
 * Rehydrates a fresh in-memory session from the durable Company DNA.
 *
 * THIS IS WHAT MAKES THE BRAIN SURVIVE A RESTART.
 *
 * After a Railway deploy the session `Map` is empty. Without this, the
 * department context compiler would rebuild an empty company — Elvira
 * would greet a CEO she no longer recognises, even though the company is
 * sitting in the database.
 *
 * Deliberately NOT a second brain: it repopulates the SAME session
 * fields the existing compiler already reads, so operational context is
 * compiled by the existing architecture from durable facts. Company DNA
 * is not duplicated into a parallel store.
 *
 * In-memory state always wins when present — a live onboarding session
 * is fresher than the last durable snapshot.
 */
export async function hydrateSessionFromCompanyDna(
  session: {
    organizationId: string;
    state: {
      onboarding?: OnboardingIntake;
      companyName?: string;
      url?: string;
      understood?: InterpretedBusiness;
      dnaHydrated?: boolean;
      entrepreneurPreferredName?: string | null;
    };
  },
  store: CompanyDnaStore,
): Promise<void> {
  if (session.state.dnaHydrated) return;
  session.state.dnaHydrated = true;

  const record = await store.get(session.organizationId);

  // Sprint 67 P0.1-A — the preferred name hydrates independently of the
  // onboarding projection: a session that already carries onboarding
  // (e.g. hydrated by an earlier step) still needs the person's name.
  session.state.entrepreneurPreferredName =
    record?.entrepreneurPreferredName ?? null;

  if (session.state.onboarding) return;
  if (!record) return;

  session.state.onboarding = {
    companyName: record.companyName,
    hasWebsite: Boolean(record.website),
    ...(record.website ? { url: record.website } : {}),
    ...(record.description ? { description: record.description } : {}),
    ...(record.country ? { country: record.country } : {}),
    ...(record.companySize ? { companySize: record.companySize } : {}),
    goal: record.objective ?? "",
  };
  session.state.companyName = record.companyName;
  if (record.website) session.state.url = record.website;
  session.state.understood = {
    ...(record.description ? { activity: record.description } : {}),
    ...(record.products.length > 0 ? { products: record.products } : {}),
    ...(record.customers.length > 0 ? { targetAudience: record.customers } : {}),
    ...(record.geography ? { locations: [record.geography] } : {}),
    ...(record.positioning ? { positioning: record.positioning } : {}),
    ...(record.businessModel ? { market: record.businessModel } : {}),
  };
}

/** Marks a durable milestone without disturbing the business facts. */
export type ReadinessMilestone =
  | "researchCompletedAt"
  | "blockingDiscoveryCompletedAt"
  | "departmentProvisionedAt";

export async function markMilestone(
  organizationId: string,
  store: CompanyDnaStore,
  milestone: ReadinessMilestone,
  now: string,
): Promise<CompanyDnaRecord | null> {
  const record = await store.get(organizationId);
  if (!record) return null;
  const updated: CompanyDnaRecord = { ...record, [milestone]: now };
  await store.upsert(updated);
  return updated;
}

/**
 * Projects the durable intake into a Company DNA record.
 *
 * Called when the CEO submits the intake, so the company survives a
 * reload from the very first step — long before research finishes.
 */
export function projectIntakeToDna(
  organizationId: string,
  intake: OnboardingIntake,
  now: string,
  existing: CompanyDnaRecord | null,
): CompanyDnaRecord {
  const provenance: Record<string, FactProvenance> = {
    ...(existing?.provenance ?? {}),
    companyName: "ceo",
    ...(intake.url ? { website: "ceo" as FactProvenance } : {}),
    ...(intake.description ? { description: "ceo" as FactProvenance } : {}),
    ...(intake.country ? { country: "ceo" as FactProvenance } : {}),
    ...(intake.goal ? { objective: "ceo" as FactProvenance } : {}),
  };
  return {
    ...(existing ?? {
      organizationId,
      products: [],
      customers: [],
      channels: [],
      declaredTools: [],
      uncertainties: [],
    }),
    organizationId,
    companyName: intake.companyName,
    ...(intake.url ? { website: intake.url } : {}),
    ...(intake.description ? { description: intake.description } : {}),
    ...(intake.country ? { country: intake.country } : {}),
    ...(intake.companySize ? { companySize: intake.companySize } : {}),
    ...(hasText(intake.goal) ? { objective: intake.goal } : {}),
    products: existing?.products ?? [],
    customers: existing?.customers ?? [],
    channels: existing?.channels ?? [],
    declaredTools: existing?.declaredTools ?? [],
    uncertainties: existing?.uncertainties ?? [],
    provenance,
    factsUpdatedAt: now,
  };
}

/**
 * Projects the REAL research output into the canonical Company DNA.
 *
 * Only facts the research genuinely produced are written. Nothing is
 * invented to make the record look complete: an interpretation that
 * found no products leaves `products` empty, and the gap surfaces
 * honestly through the completeness contract instead of being papered
 * over.
 */
export function projectResearchToDna(
  record: CompanyDnaRecord,
  interpreted: InterpretedBusiness,
  now: string,
): CompanyDnaRecord {
  const products = [
    ...(interpreted.products ?? []),
    ...(interpreted.services ?? []),
  ].filter((value) => hasText(value));
  const customers = (interpreted.targetAudience ?? []).filter((value) =>
    hasText(value),
  );
  const geography = (interpreted.locations ?? []).filter((value) =>
    hasText(value),
  )[0];

  const provenance: Record<string, FactProvenance> = { ...record.provenance };
  if (products.length > 0) provenance.products = "research";
  if (customers.length > 0) provenance.customers = "research";
  if (geography) provenance.geography = "research";
  if (hasText(interpreted.positioning)) provenance.positioning = "research";
  if (hasText(interpreted.market)) provenance.businessModel = "research";
  // The CEO's own description always wins over a guessed activity.
  if (!hasText(record.description) && hasText(interpreted.activity)) {
    provenance.description = "research";
  }

  const uncertainties: string[] = [];
  if (products.length === 0) uncertainties.push("products");
  if (customers.length === 0) uncertainties.push("customers");
  if (!geography && !hasText(record.country)) uncertainties.push("geography");

  return {
    ...record,
    ...(products.length > 0 ? { products } : {}),
    ...(customers.length > 0 ? { customers } : {}),
    ...(geography ? { geography } : {}),
    ...(hasText(interpreted.positioning)
      ? { positioning: interpreted.positioning }
      : {}),
    ...(hasText(interpreted.market) ? { businessModel: interpreted.market } : {}),
    ...(!hasText(record.description) && hasText(interpreted.activity)
      ? { description: interpreted.activity }
      : {}),
    uncertainties,
    provenance,
    researchCompletedAt: now,
    // Research changed the canonical facts — any prior confirmation is
    // now stale and must be re-earned.
    factsUpdatedAt: now,
  };
}

/**
 * Applies the CEO's corrections and records the confirmation.
 *
 * Confirmation is stamped AFTER the corrections are merged, so the
 * confirmation always refers to the facts we actually stored — the
 * exact failure mode the readiness contract has to rule out.
 */
export interface CeoCorrections {
  readonly companyName?: string;
  readonly description?: string;
  readonly objective?: string;
  readonly geography?: string;
  readonly products?: readonly string[];
  readonly customers?: readonly string[];
  readonly declaredTools?: readonly string[];
}

export function applyCeoConfirmation(
  record: CompanyDnaRecord,
  corrections: CeoCorrections,
  now: string,
): CompanyDnaRecord {
  const provenance: Record<string, FactProvenance> = { ...record.provenance };
  const corrected: {
    -readonly [K in keyof CompanyDnaRecord]?: CompanyDnaRecord[K];
  } = {};

  const companyName = corrections.companyName?.trim();
  if (companyName) {
    corrected.companyName = companyName;
    provenance.companyName = "ceo";
  }
  const description = corrections.description?.trim();
  if (description) {
    corrected.description = description;
    provenance.description = "ceo";
  }
  const objective = corrections.objective?.trim();
  if (objective) {
    corrected.objective = objective;
    provenance.objective = "ceo";
  }
  const geography = corrections.geography?.trim();
  if (geography) {
    corrected.geography = geography;
    provenance.geography = "ceo";
  }
  if (corrections.products && corrections.products.length > 0) {
    corrected.products = corrections.products.filter((v) => hasText(v));
    provenance.products = "ceo";
  }
  if (corrections.customers && corrections.customers.length > 0) {
    corrected.customers = corrections.customers.filter((v) => hasText(v));
    provenance.customers = "ceo";
  }
  if (corrections.declaredTools) {
    // Declared tooling is a BUSINESS FACT. It never implies a working
    // connection — connection health lives in the tool state store.
    corrected.declaredTools = corrections.declaredTools.filter((v) =>
      hasText(v),
    );
    provenance.declaredTools = "ceo";
  }

  const merged: CompanyDnaRecord = {
    ...record,
    ...corrected,
    provenance,
    // Facts and confirmation move together: the CEO confirmed exactly
    // this version of the company.
    factsUpdatedAt: now,
    ceoConfirmedAt: now,
  };
  return merged;
}
