/**
 * Business Discovery domain model — Sprint 28.
 *
 * This package is the only authorized boundary for discovering a company.
 * It models the complete pipeline without executing AI, scraping, or HTTP calls.
 */

export type BusinessDiscoveryId = string;
export type DiscoverySessionId = string;
export type OrganizationId = string;

/**
 * Confidence level for a piece of discovered information.
 */
export type DiscoveryConfidenceLevel = "low" | "medium" | "high" | "verified";

/**
 * Source of discovered information.
 */
export type DiscoverySource =
  | "user_input"
  | "public_record"
  | "website"
  | "social_media"
  | "inferred";

/**
 * Request to initiate business discovery for an organization.
 */
export interface BusinessDiscoveryRequest {
  readonly organizationId: OrganizationId;
  readonly requestedAt: Date;
  readonly priority: "low" | "normal" | "high";
  readonly options: Readonly<{
    readonly includeFounderBrain: boolean;
    readonly includeCompetitorAnalysis: boolean;
    readonly includeMarketAnalysis: boolean;
    readonly depth: "basic" | "standard" | "comprehensive";
  }>;
}

/**
 * Represents a session of business discovery.
 */
export interface BusinessDiscoverySession {
  readonly sessionId: DiscoverySessionId;
  readonly organizationId: OrganizationId;
  readonly request: BusinessDiscoveryRequest;
  readonly startedAt: Date;
  readonly completedAt?: Date;
  readonly status: DiscoverySessionStatus;
  readonly currentPhase: DiscoveryPhase;
  readonly phasesCompleted: readonly DiscoveryPhase[];
}

export type DiscoverySessionStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled";

export type DiscoveryPhase =
  | "initialization"
  | "data_collection"
  | "company_dna_analysis"
  | "founder_brain_analysis"
  | "gap_analysis"
  | "question_generation"
  | "finalization";

/**
 * Represents a specific finding during discovery.
 */
export interface DiscoveryFinding {
  readonly id: string;
  readonly category: FindingCategory;
  readonly title: string;
  readonly description: string;
  readonly confidence: DiscoveryConfidenceLevel;
  readonly source: DiscoverySource;
  readonly evidence: readonly string[];
  readonly discoveredAt: Date;
}

export type FindingCategory =
  | "mission"
  | "vision"
  | "values"
  | "value_proposition"
  | "products"
  | "services"
  | "market"
  | "ideal_customer"
  | "tone"
  | "positioning"
  | "strengths"
  | "weaknesses"
  | "objectives"
  | "processes"
  | "leadership_style"
  | "priorities"
  | "philosophy"
  | "risk_tolerance"
  | "delegation_style"
  | "decision_making"
  | "communication"
  | "preferences";

/**
 * Represents a gap in discovered information.
 */
export interface DiscoveryGap {
  readonly id: string;
  readonly category: FindingCategory;
  readonly description: string;
  readonly importance: "critical" | "high" | "medium" | "low";
  readonly blockingAction: boolean;
}

/**
 * Question importance level (internal use).
 */
export type QuestionImportance = "critical" | "high" | "medium" | "low";

/**
 * An adaptive question generated to fill a gap.
 */
export interface DiscoveryQuestion {
  readonly id: string;
  readonly gapId: string;
  readonly category: FindingCategory;
  readonly question: string;
  readonly type: "open" | "multiple_choice" | "yes_no" | "ranking";
  readonly options?: readonly string[];
  readonly priority: number;
  readonly context: string;
  readonly importance: QuestionImportance;
}

/**
 * Validation error for discovery types.
 */
export class DiscoveryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscoveryValidationError";
  }
}

export function validateBusinessDiscoveryRequest(
  input: unknown,
): BusinessDiscoveryRequest {
  if (typeof input !== "object" || input === null) {
    throw new DiscoveryValidationError("Discovery request must be an object.");
  }

  const candidate = input as Record<string, unknown>;

  if (typeof candidate.organizationId !== "string") {
    throw new DiscoveryValidationError(
      "Discovery request requires a valid organizationId.",
    );
  }

  const requestedAt = candidate.requestedAt;
  if (!(requestedAt instanceof Date) && typeof requestedAt !== "string") {
    throw new DiscoveryValidationError(
      "Discovery request requires a valid requestedAt timestamp.",
    );
  }

  if (typeof requestedAt === "string" && Number.isNaN(Date.parse(requestedAt))) {
    throw new DiscoveryValidationError(
      "Discovery request requires a valid requestedAt timestamp.",
    );
  }

  if (requestedAt instanceof Date && Number.isNaN(requestedAt.getTime())) {
    throw new DiscoveryValidationError(
      "Discovery request requires a valid requestedAt timestamp.",
    );
  }

  const priority = candidate.priority;
  if (
    typeof priority !== "string" ||
    !["low", "normal", "high"].includes(priority)
  ) {
    throw new DiscoveryValidationError(
      "Discovery request requires a valid priority (low, normal, high).",
    );
  }

  const options = candidate.options;
  if (typeof options !== "object" || options === null) {
    throw new DiscoveryValidationError(
      "Discovery request requires valid options.",
    );
  }

  return {
    organizationId: candidate.organizationId as OrganizationId,
    requestedAt:
      requestedAt instanceof Date ? requestedAt : new Date(requestedAt as string),
    priority: priority as BusinessDiscoveryRequest["priority"],
    options: {
      includeFounderBrain: (options as Record<string, unknown>).includeFounderBrain === true,
      includeCompetitorAnalysis: (options as Record<string, unknown>).includeCompetitorAnalysis === true,
      includeMarketAnalysis: (options as Record<string, unknown>).includeMarketAnalysis === true,
      depth:
        typeof (options as Record<string, unknown>).depth === "string" &&
        ["basic", "standard", "comprehensive"].includes(
          (options as Record<string, unknown>).depth as string,
        )
          ? ((options as Record<string, unknown>).depth as "basic" | "standard" | "comprehensive")
          : "standard",
    },
  };
}
