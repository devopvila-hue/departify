/**
 * Customer Zero readiness gate — HOTFIX.
 *
 * Structural backend gate that determines whether the CEO's
 * organization has completed Customer Zero onboarding. The gate is
 * consulted by:
 *
 *   - `RootRoute` (portal) — to decide whether to land on
 *     CustomerZeroRoute (continue onboarding) or /chat (central
 *     operating surface).
 *   - `MarketingService.getDepartmentStatus` (backend) — to mark
 *     the department as `not_provisioned` instead of returning a
 *     seeded 12-person team.
 *   - The chat polling — to block the command center while
 *     Customer Zero is still in progress.
 *
 * The gate is PURE: no I/O, no clock, no env. The caller passes in
 * the snapshot of facts it has already read from the durable store.
 *
 * Required facts to be considered ready:
 *
 *   - The CEO has submitted the minimum intake (companyName).
 *   - The research pipeline has produced at least one piece of
 *     Company DNA (the LLM has read the website / description).
 *   - The CEO has confirmed or corrected the research output.
 *   - The CEO has answered the blocking discovery questions
 *     (objective + primary tools / CRM).
 *   - The Marketing department has been provisioned through the
 *     canonical handoff (findMarketingDepartment returns non-null).
 *
 * When any of those are missing, the gate returns `false` and the
 * CEO stays in Customer Zero.
 */

export interface ReadinessFacts {
  readonly hasIntake: boolean;
  readonly hasCompanyDna: boolean;
  readonly ceoConfirmed: boolean;
  readonly blockingDiscoveryComplete: boolean;
  readonly departmentProvisioned: boolean;
}

export interface ReadinessReport {
  readonly ready: boolean;
  readonly missing: readonly ReadinessMissing[];
}

export type ReadinessMissing =
  | "intake"
  | "research"
  | "confirmation"
  | "blocking_discovery"
  | "department";

const ALL_MISSING: readonly ReadinessMissing[] = [
  "intake",
  "research",
  "confirmation",
  "blocking_discovery",
  "department",
];

/**
 * Pure gate. Returns the readiness report for the given facts.
 */
export function evaluateReadiness(facts: ReadinessFacts): ReadinessReport {
  const missing: ReadinessMissing[] = [];
  if (!facts.hasIntake) missing.push("intake");
  if (!facts.hasCompanyDna) missing.push("research");
  if (!facts.ceoConfirmed) missing.push("confirmation");
  if (!facts.blockingDiscoveryComplete) missing.push("blocking_discovery");
  if (!facts.departmentProvisioned) missing.push("department");
  return {
    ready: missing.length === 0,
    missing,
  };
}

/**
 * Convenience helper for tests / portals: returns a fully-unready
 * facts object representing a brand-new organization.
 */
export function freshOrganizationFacts(): ReadinessFacts {
  return {
    hasIntake: false,
    hasCompanyDna: false,
    ceoConfirmed: false,
    blockingDiscoveryComplete: false,
    departmentProvisioned: false,
  };
}

export { ALL_MISSING };
