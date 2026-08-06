/**
 * Company DNA — canonical model for understanding a company's essence.
 *
 * Company DNA captures the fundamental identity and characteristics that
 * make a company unique. It is the foundation for all Departify digital
 * employees to understand the business they serve.
 */

import type {
  DiscoveryConfidenceLevel,
  DiscoverySource,
} from "../contracts/discovery-types.js";

/**
 * Represents the confidence level for a specific piece of Company DNA.
 */
export interface DnaConfidence {
  readonly level: DiscoveryConfidenceLevel;
  readonly source: DiscoverySource;
  readonly lastVerified: Date;
}

/**
 * Company's mission statement — why the company exists beyond making money.
 */
export interface CompanyMission {
  readonly statement: string;
  readonly confidence: DnaConfidence;
}

/**
 * Company's vision — what the company aspires to become in the future.
 */
export interface CompanyVision {
  readonly statement: string;
  readonly timeframe?: string;
  readonly confidence: DnaConfidence;
}

/**
 * Core values that guide company behavior and decisions.
 */
export interface CompanyValue {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly confidence: DnaConfidence;
}

/**
 * Unique value the company provides to customers.
 */
export interface ValueProposition {
  readonly statement: string;
  readonly differentiation: readonly string[];
  readonly confidence: DnaConfidence;
}

/**
 * A product offered by the company.
 */
export interface CompanyProduct {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly targetAudience: string;
  readonly keyFeatures: readonly string[];
  readonly stage: "idea" | "development" | "launched" | "mature" | "declining";
  readonly confidence: DnaConfidence;
}

/**
 * A service offered by the company.
 */
export interface CompanyService {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly deliveryMethod: string;
  readonly sla?: string;
  readonly confidence: DnaConfidence;
}

/**
 * Market position and characteristics.
 */
export interface CompanyMarket {
  readonly industry: string;
  readonly industrySegment?: string;
  readonly marketSize?: string;
  readonly marketTrend?: "growing" | "stable" | "declining";
  readonly competition: "low" | "medium" | "high";
  readonly confidence: DnaConfidence;
}

/**
 * Ideal customer profile.
 */
export interface IdealCustomer {
  readonly demographics: readonly string[];
  readonly psychographics: readonly string[];
  readonly painPoints: readonly string[];
  readonly buyingBehavior: readonly string[];
  readonly confidence: DnaConfidence;
}

/**
 * Communication tone and style.
 */
export interface CompanyTone {
  readonly personality: readonly string[];
  readonly voice: string;
  readonly styleExamples: readonly string[];
  readonly confidence: DnaConfidence;
}

/**
 * Market positioning.
 */
export interface CompanyPositioning {
  readonly statement: string;
  readonly premiumTier?: "budget" | "mid_market" | "premium" | "luxury";
  readonly differentiation: readonly string[];
  readonly confidence: DnaConfidence;
}

/**
 * Company strengths (internal capabilities).
 */
export interface CompanyStrength {
  readonly id: string;
  readonly category: string;
  readonly description: string;
  readonly evidence: readonly string[];
  readonly confidence: DnaConfidence;
}

/**
 * Company weaknesses or areas for improvement.
 */
export interface CompanyWeakness {
  readonly id: string;
  readonly category: string;
  readonly description: string;
  readonly mitigation?: string;
  readonly confidence: DnaConfidence;
}

/**
 * Business objectives.
 */
export interface CompanyObjective {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly timeframe: string;
  readonly metrics?: readonly string[];
  readonly priority: "critical" | "high" | "medium" | "low";
  readonly status: "planned" | "in_progress" | "completed" | "paused";
  readonly confidence: DnaConfidence;
}

/**
 * Key business processes.
 */
export interface CompanyProcess {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly owner?: string;
  readonly tools?: readonly string[];
  readonly maturity: "ad_hoc" | "defined" | "measured" | "optimized";
  readonly confidence: DnaConfidence;
}

/**
 * Complete Company DNA aggregate.
 *
 * This is the canonical representation of a company's identity.
 * All Digital Employees use this as their ground truth for understanding
 * the business.
 */
export interface CompanyDNA {
  readonly organizationId: string;
  readonly mission?: CompanyMission;
  readonly vision?: CompanyVision;
  readonly values: readonly CompanyValue[];
  readonly valueProposition?: ValueProposition;
  readonly products: readonly CompanyProduct[];
  readonly services: readonly CompanyService[];
  readonly market?: CompanyMarket;
  readonly idealCustomer?: IdealCustomer;
  readonly tone?: CompanyTone;
  readonly positioning?: CompanyPositioning;
  readonly strengths: readonly CompanyStrength[];
  readonly weaknesses: readonly CompanyWeakness[];
  readonly objectives: readonly CompanyObjective[];
  readonly processes: readonly CompanyProcess[];
  readonly lastUpdated: Date;
  readonly completeness: DnaCompleteness;
}

/**
 * Tracks which sections of Company DNA are populated.
 */
export interface DnaCompleteness {
  readonly mission: boolean;
  readonly vision: boolean;
  readonly values: boolean;
  readonly valueProposition: boolean;
  readonly products: boolean;
  readonly services: boolean;
  readonly market: boolean;
  readonly idealCustomer: boolean;
  readonly tone: boolean;
  readonly positioning: boolean;
  readonly strengths: boolean;
  readonly weaknesses: boolean;
  readonly objectives: boolean;
  readonly processes: boolean;
  readonly overallPercentage: number;
}

/**
 * Validation error for Company DNA.
 */
export class CompanyDnaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanyDnaValidationError";
  }
}

/**
 * Calculate completeness percentage for Company DNA.
 */
export function calculateDnaCompleteness(dna: CompanyDNA): DnaCompleteness {
  const checks = {
    mission: !!dna.mission,
    vision: !!dna.vision,
    values: dna.values.length > 0,
    valueProposition: !!dna.valueProposition,
    products: dna.products.length > 0,
    services: dna.services.length > 0,
    market: !!dna.market,
    idealCustomer: !!dna.idealCustomer,
    tone: !!dna.tone,
    positioning: !!dna.positioning,
    strengths: dna.strengths.length > 0,
    weaknesses: dna.weaknesses.length > 0,
    objectives: dna.objectives.length > 0,
    processes: dna.processes.length > 0,
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
export function createMinimalConfidence(
  source: DiscoverySource,
): DnaConfidence {
  return {
    level: "low",
    source,
    lastVerified: new Date(),
  };
}

/**
 * Create a verified confidence object.
 */
export function createVerifiedConfidence(
  source: DiscoverySource,
): DnaConfidence {
  return {
    level: "verified",
    source,
    lastVerified: new Date(),
  };
}

/**
 * Build a new empty Company DNA structure.
 */
export function buildEmptyCompanyDNA(
  organizationId: string,
): CompanyDNA {
  const baseDna: CompanyDNA = {
    organizationId,
    values: [],
    products: [],
    services: [],
    strengths: [],
    weaknesses: [],
    objectives: [],
    processes: [],
    lastUpdated: new Date(),
    completeness: {
      mission: false,
      vision: false,
      values: false,
      valueProposition: false,
      products: false,
      services: false,
      market: false,
      idealCustomer: false,
      tone: false,
      positioning: false,
      strengths: false,
      weaknesses: false,
      objectives: false,
      processes: false,
      overallPercentage: 0,
    },
  };

  const completeness = calculateDnaCompleteness(baseDna);
  return { ...baseDna, completeness };
}

/**
 * Validate Company DNA structure.
 */
export function validateCompanyDNA(dna: unknown): CompanyDNA {
  if (typeof dna !== "object" || dna === null) {
    throw new CompanyDnaValidationError("Company DNA must be an object.");
  }

  const candidate = dna as Record<string, unknown>;

  if (typeof candidate.organizationId !== "string") {
    throw new CompanyDnaValidationError(
      "Company DNA requires a valid organizationId.",
    );
  }

  if (!(candidate.lastUpdated instanceof Date)) {
    throw new CompanyDnaValidationError(
      "Company DNA requires a valid lastUpdated timestamp.",
    );
  }

  if (
    typeof candidate.completeness !== "object" ||
    candidate.completeness === null
  ) {
    throw new CompanyDnaValidationError(
      "Company DNA requires a completeness record.",
    );
  }

  return candidate as unknown as CompanyDNA;
}
