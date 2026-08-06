/**
 * Founder Brain — canonical model for understanding founder psychology.
 *
 * Founder Brain captures how the founder thinks, leads, and makes decisions.
 * This enables Departify digital employees to align with founder preferences
 * and communication style.
 */

import type {
  DiscoveryConfidenceLevel,
  DiscoverySource,
} from "../contracts/discovery-types.js";

/**
 * Represents confidence for a piece of Founder Brain data.
 */
export interface BrainConfidence {
  readonly level: DiscoveryConfidenceLevel;
  readonly source: DiscoverySource;
  readonly lastVerified: Date;
}

/**
 * Leadership style approaches.
 */
export type LeadershipStyle =
  | "visionary"
  | "transformational"
  | "transactional"
  | "servant"
  | "democratic"
  | "autocratic"
  | "laissez_faire"
  | "situational";

/**
 * Founder's leadership approach.
 */
export interface LeadershipProfile {
  readonly style: LeadershipStyle;
  readonly description: string;
  readonly microManagement: "high" | "medium" | "low";
  readonly teamInvolvement: "high" | "medium" | "low";
  readonly confidence: BrainConfidence;
}

/**
 * Strategic priorities.
 */
export interface FounderPriority {
  readonly id: string;
  readonly area: string;
  readonly description: string;
  readonly rank: number;
  readonly timeHorizon: "immediate" | "short_term" | "medium_term" | "long_term";
  readonly confidence: BrainConfidence;
}

/**
 * Business philosophy and beliefs.
 */
export interface BusinessPhilosophy {
  readonly coreBeliefs: readonly string[];
  readonly principles: readonly string[];
  readonly nonNegotiables: readonly string[];
  readonly attitudeTowardsGrowth: "aggressive" | "balanced" | "conservative";
  readonly attitudeTowardsRisk: string;
  readonly confidence: BrainConfidence;
}

/**
 * Risk tolerance levels.
 */
export type RiskToleranceLevel = "minimal" | "low" | "moderate" | "high" | "aggressive";

/**
 * Risk tolerance by category.
 */
export interface RiskTolerance {
  readonly overall: RiskToleranceLevel;
  readonly byCategory: {
    readonly financial: RiskToleranceLevel;
    readonly operational: RiskToleranceLevel;
    readonly reputational: RiskToleranceLevel;
    readonly innovation: RiskToleranceLevel;
  };
  readonly rationale?: string;
  readonly confidence: BrainConfidence;
}

/**
 * Delegation approach.
 */
export interface DelegationStyle {
  readonly preference: "micromanage" | "involved" | "hands_off" | "empower";
  readonly whatDelegates: readonly string[];
  readonly whatRetains: readonly string[];
  readonly trustBuilding: string;
  readonly feedbackFrequency: "daily" | "weekly" | "biweekly" | "monthly";
  readonly confidence: BrainConfidence;
}

/**
 * Decision making style.
 */
export type DecisionSpeed = "immediate" | "fast" | "measured" | "deliberate" | "consensus";

export interface DecisionMaking {
  readonly speed: DecisionSpeed;
  readonly style: "intuitive" | "analytical" | "collaborative" | "consultative" | "command";
  readonly informationRequirement: "minimal" | "standard" | "comprehensive" | "exhaustive";
  readonly decisionCriteria: readonly string[];
  readonly postDecisionReview: boolean;
  readonly confidence: BrainConfidence;
}

/**
 * Communication preferences.
 */
export interface CommunicationStyle {
  readonly preferredChannel: "email" | "slack" | "video" | "in_person" | "async";
  readonly frequency: "real_time" | "daily" | "weekly" | "as_needed";
  readonly format: "formal" | "semi_formal" | "casual";
  readonly detailLevel: "executive_summary" | "key_points" | "comprehensive" | "raw_data";
  readonly meetingPreference: "minimal" | "scheduled" | "standup" | "ad_hoc";
  readonly feedbackStyle: "direct" | "diplomatic" | "coaching";
  readonly availability: string;
  readonly responseTimeExpectation: string;
  readonly confidence: BrainConfidence;
}

/**
 * Personal preferences that affect work.
 */
export interface FounderPreferences {
  readonly workingHours?: string;
  readonly deepWorkWindows?: readonly string[];
  readonly preferredMeetingTimes?: readonly string[];
  readonly communicationBlackout?: readonly string[];
  readonly reportingCadence?: "daily" | "weekly" | "biweekly" | "monthly";
  readonly dashboards: readonly string[];
  readonly alerts: readonly string[];
  readonly confidence: BrainConfidence;
}

/**
 * Complete Founder Brain aggregate.
 *
 * This is the canonical representation of how the founder thinks and works.
 * Digital Employees use this to tailor their approach and outputs.
 */
export interface FounderBrain {
  readonly organizationId: string;
  readonly leadership?: LeadershipProfile;
  readonly priorities: readonly FounderPriority[];
  readonly philosophy?: BusinessPhilosophy;
  readonly riskTolerance?: RiskTolerance;
  readonly delegation?: DelegationStyle;
  readonly decisionMaking?: DecisionMaking;
  readonly communication?: CommunicationStyle;
  readonly preferences?: FounderPreferences;
  readonly lastUpdated: Date;
  readonly completeness: BrainCompleteness;
}

/**
 * Tracks which sections of Founder Brain are populated.
 */
export interface BrainCompleteness {
  readonly leadership: boolean;
  readonly priorities: boolean;
  readonly philosophy: boolean;
  readonly riskTolerance: boolean;
  readonly delegation: boolean;
  readonly decisionMaking: boolean;
  readonly communication: boolean;
  readonly preferences: boolean;
  readonly overallPercentage: number;
}

/**
 * Validation error for Founder Brain.
 */
export class FounderBrainValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FounderBrainValidationError";
  }
}

/**
 * Calculate completeness percentage for Founder Brain.
 */
export function calculateBrainCompleteness(brain: FounderBrain): BrainCompleteness {
  const checks = {
    leadership: !!brain.leadership,
    priorities: brain.priorities.length > 0,
    philosophy: !!brain.philosophy,
    riskTolerance: !!brain.riskTolerance,
    delegation: !!brain.delegation,
    decisionMaking: !!brain.decisionMaking,
    communication: !!brain.communication,
    preferences: !!brain.preferences,
  };

  const trueCount = Object.values(checks).filter(Boolean).length;
  const totalCount = Object.keys(checks).length;

  return {
    ...checks,
    overallPercentage: Math.round((trueCount / totalCount) * 100),
  };
}

/**
 * Create a minimal confidence object.
 */
export function createMinimalBrainConfidence(
  source: DiscoverySource,
): BrainConfidence {
  return {
    level: "low",
    source,
    lastVerified: new Date(),
  };
}

/**
 * Create a verified confidence object.
 */
export function createVerifiedBrainConfidence(
  source: DiscoverySource,
): BrainConfidence {
  return {
    level: "verified",
    source,
    lastVerified: new Date(),
  };
}

/**
 * Build a new empty Founder Brain structure.
 */
export function buildEmptyFounderBrain(
  organizationId: string,
): FounderBrain {
  const baseBrain: FounderBrain = {
    organizationId,
    priorities: [],
    lastUpdated: new Date(),
    completeness: {
      leadership: false,
      priorities: false,
      philosophy: false,
      riskTolerance: false,
      delegation: false,
      decisionMaking: false,
      communication: false,
      preferences: false,
      overallPercentage: 0,
    },
  };

  const completeness = calculateBrainCompleteness(baseBrain);
  return { ...baseBrain, completeness };
}

/**
 * Validate Founder Brain structure.
 */
export function validateFounderBrain(brain: unknown): FounderBrain {
  if (typeof brain !== "object" || brain === null) {
    throw new FounderBrainValidationError("Founder Brain must be an object.");
  }

  const candidate = brain as Record<string, unknown>;

  if (typeof candidate.organizationId !== "string") {
    throw new FounderBrainValidationError(
      "Founder Brain requires a valid organizationId.",
    );
  }

  if (!(candidate.lastUpdated instanceof Date)) {
    throw new FounderBrainValidationError(
      "Founder Brain requires a valid lastUpdated timestamp.",
    );
  }

  if (
    typeof candidate.completeness !== "object" ||
    candidate.completeness === null
  ) {
    throw new FounderBrainValidationError(
      "Founder Brain requires a completeness record.",
    );
  }

  return candidate as unknown as FounderBrain;
}
