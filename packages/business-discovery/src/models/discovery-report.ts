/**
 * Company Discovery Report — comprehensive discovery outcome.
 *
 * The Discovery Report is the envelope that contains the complete results
 * of a business discovery session, including Company DNA, Founder Brain,
 * findings, gaps, and questions.
 */

import type {
  DiscoveryFinding,
  DiscoveryGap,
  DiscoveryQuestion,
  DiscoverySessionId,
  OrganizationId,
} from "../contracts/discovery-types.js";
import type { CompanyDNA } from "./company-dna.js";
import type { FounderBrain } from "./founder-brain.js";

/**
 * Overall confidence in the discovery results.
 */
export interface DiscoveryConfidence {
  readonly overall: "low" | "medium" | "high";
  readonly companyDna: number;
  readonly founderBrain: number;
  readonly breakdown: {
    readonly mission: number;
    readonly vision: number;
    readonly values: number;
    readonly valueProposition: number;
    readonly products: number;
    readonly services: number;
    readonly market: number;
    readonly idealCustomer: number;
    readonly tone: number;
    readonly positioning: number;
    readonly strengths: number;
    readonly weaknesses: number;
    readonly objectives: number;
    readonly processes: number;
    readonly leadership: number;
    readonly priorities: number;
    readonly philosophy: number;
    readonly riskTolerance: number;
    readonly delegation: number;
    readonly decisionMaking: number;
    readonly communication: number;
    readonly preferences: number;
  };
}

/**
 * Metadata about the discovery process.
 */
export interface DiscoveryMetadata {
  readonly sessionId: DiscoverySessionId;
  readonly startedAt: Date;
  readonly completedAt: Date;
  readonly durationMs: number;
  readonly sources: readonly string[];
  readonly dataPoints: number;
  readonly questionsAsked: number;
  readonly questionsAnswered: number;
}

/**
 * The complete discovery report.
 */
export interface CompanyDiscoveryReport {
  readonly organizationId: OrganizationId;
  readonly sessionId: DiscoverySessionId;
  readonly metadata: DiscoveryMetadata;
  readonly companyDna: CompanyDNA;
  readonly founderBrain?: FounderBrain;
  readonly findings: readonly DiscoveryFinding[];
  readonly gaps: readonly DiscoveryGap[];
  readonly questions: readonly DiscoveryQuestion[];
  readonly confidence: DiscoveryConfidence;
  readonly generatedAt: Date;
}

/**
 * Validation error for Discovery Report.
 */
export class DiscoveryReportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscoveryReportValidationError";
  }
}

/**
 * Calculate overall confidence from Company DNA and Founder Brain.
 */
export function calculateDiscoveryConfidence(
  companyDna: CompanyDNA,
  founderBrain?: FounderBrain,
): DiscoveryConfidence {
  const breakdown = {
    mission: companyDna.mission ? 100 : 0,
    vision: companyDna.vision ? 100 : 0,
    values: companyDna.values.length > 0 ? 100 : 0,
    valueProposition: companyDna.valueProposition ? 100 : 0,
    products: companyDna.products.length > 0 ? 100 : 0,
    services: companyDna.services.length > 0 ? 100 : 0,
    market: companyDna.market ? 100 : 0,
    idealCustomer: companyDna.idealCustomer ? 100 : 0,
    tone: companyDna.tone ? 100 : 0,
    positioning: companyDna.positioning ? 100 : 0,
    strengths: companyDna.strengths.length > 0 ? 100 : 0,
    weaknesses: companyDna.weaknesses.length > 0 ? 100 : 0,
    objectives: companyDna.objectives.length > 0 ? 100 : 0,
    processes: companyDna.processes.length > 0 ? 100 : 0,
    leadership: founderBrain?.leadership ? 100 : 0,
    priorities: founderBrain?.priorities && founderBrain.priorities.length > 0 ? 100 : 0,
    philosophy: founderBrain?.philosophy ? 100 : 0,
    riskTolerance: founderBrain?.riskTolerance ? 100 : 0,
    delegation: founderBrain?.delegation ? 100 : 0,
    decisionMaking: founderBrain?.decisionMaking ? 100 : 0,
    communication: founderBrain?.communication ? 100 : 0,
    preferences: founderBrain?.preferences ? 100 : 0,
  };

  const dnaAverage =
    Object.values(breakdown).slice(0, 13).reduce((a, b) => a + b, 0) / 13;
  const brainAverage = founderBrain
    ? Object.values(breakdown).slice(13).reduce((a, b) => a + b, 0) / 8
    : 0;

  const overall = (dnaAverage + brainAverage) / 2;

  let overallLevel: "low" | "medium" | "high";
  if (overall < 40) overallLevel = "low";
  else if (overall < 70) overallLevel = "medium";
  else overallLevel = "high";

  return {
    overall: overallLevel,
    companyDna: Math.round(dnaAverage),
    founderBrain: Math.round(brainAverage),
    breakdown,
  };
}

/**
 * Validate Discovery Report structure.
 */
export function validateDiscoveryReport(
  report: unknown,
): CompanyDiscoveryReport {
  if (typeof report !== "object" || report === null) {
    throw new DiscoveryReportValidationError(
      "Discovery Report must be an object.",
    );
  }

  const candidate = report as Record<string, unknown>;

  if (typeof candidate.organizationId !== "string") {
    throw new DiscoveryReportValidationError(
      "Discovery Report requires a valid organizationId.",
    );
  }

  if (typeof candidate.sessionId !== "string") {
    throw new DiscoveryReportValidationError(
      "Discovery Report requires a valid sessionId.",
    );
  }

  return candidate as unknown as CompanyDiscoveryReport;
}
