/**
 * Gap Analysis — deterministic detection of missing information.
 *
 * Gap Analysis identifies what information is known, what is missing,
 * and how confident we are in each area. It uses deterministic rules,
 * not AI inference.
 */

import type {
  DiscoveryGap,
  FindingCategory,
  DiscoveryConfidenceLevel,
} from "../contracts/discovery-types.js";
import type { CompanyDNA } from "../models/company-dna.js";
import type { FounderBrain } from "../models/founder-brain.js";

/**
 * Result of gap analysis.
 */
export interface GapAnalysisResult {
  readonly gaps: readonly DiscoveryGap[];
  readonly knownCategories: readonly FindingCategory[];
  readonly missingCategories: readonly FindingCategory[];
  readonly confidenceByCategory: Readonly<Record<FindingCategory, DiscoveryConfidenceLevel>>;
  readonly criticalGaps: readonly DiscoveryGap[];
  readonly overallCompleteness: number;
}

/**
 * Gap category configuration.
 */
interface GapCategoryConfig {
  readonly category: FindingCategory;
  readonly name: string;
  readonly critical: boolean;
  readonly checkRequired: (dna: CompanyDNA, brain?: FounderBrain) => boolean;
  readonly checkConfidence: (dna: CompanyDNA, brain?: FounderBrain) => DiscoveryConfidenceLevel;
}

/**
 * Define all DNA gap categories with deterministic checks.
 */
const DNA_GAP_CATEGORIES: readonly GapCategoryConfig[] = [
  {
    category: "mission",
    name: "Mission Statement",
    critical: true,
    checkRequired: (dna) => !dna.mission || dna.mission.statement.trim().length === 0,
    checkConfidence: (dna) => (dna.mission ? dna.mission.confidence.level : "low"),
  },
  {
    category: "vision",
    name: "Vision Statement",
    critical: true,
    checkRequired: (dna) => !dna.vision || dna.vision.statement.trim().length === 0,
    checkConfidence: (dna) => (dna.vision ? dna.vision.confidence.level : "low"),
  },
  {
    category: "values",
    name: "Core Values",
    critical: true,
    checkRequired: (dna) => dna.values.length === 0,
    checkConfidence: (dna) => (dna.values.length > 2 ? "high" : dna.values.length > 0 ? "medium" : "low"),
  },
  {
    category: "value_proposition",
    name: "Value Proposition",
    critical: true,
    checkRequired: (dna) => !dna.valueProposition || dna.valueProposition.statement.trim().length === 0,
    checkConfidence: (dna) => (dna.valueProposition ? dna.valueProposition.confidence.level : "low"),
  },
  {
    category: "products",
    name: "Products",
    critical: true,
    checkRequired: (dna) => dna.products.length === 0,
    checkConfidence: (dna) => (dna.products.length > 0 ? "high" : "low"),
  },
  {
    category: "services",
    name: "Services",
    critical: false,
    checkRequired: (dna) => dna.services.length === 0,
    checkConfidence: (dna) => (dna.services.length > 0 ? "high" : "low"),
  },
  {
    category: "market",
    name: "Market Information",
    critical: true,
    checkRequired: (dna) => !dna.market || !dna.market.industry || dna.market.industry.trim().length === 0,
    checkConfidence: (dna) => (dna.market ? dna.market.confidence.level : "low"),
  },
  {
    category: "ideal_customer",
    name: "Ideal Customer Profile",
    critical: true,
    checkRequired: (dna) => !dna.idealCustomer || dna.idealCustomer.demographics.length === 0,
    checkConfidence: (dna) => (dna.idealCustomer ? dna.idealCustomer.confidence.level : "low"),
  },
  {
    category: "tone",
    name: "Brand Tone",
    critical: false,
    checkRequired: (dna) => !dna.tone || dna.tone.personality.length === 0,
    checkConfidence: (dna) => (dna.tone ? dna.tone.confidence.level : "low"),
  },
  {
    category: "positioning",
    name: "Market Positioning",
    critical: true,
    checkRequired: (dna) => !dna.positioning || dna.positioning.statement.trim().length === 0,
    checkConfidence: (dna) => (dna.positioning ? dna.positioning.confidence.level : "low"),
  },
  {
    category: "strengths",
    name: "Company Strengths",
    critical: false,
    checkRequired: (dna) => dna.strengths.length === 0,
    checkConfidence: (dna) => (dna.strengths.length > 2 ? "high" : dna.strengths.length > 0 ? "medium" : "low"),
  },
  {
    category: "weaknesses",
    name: "Company Weaknesses",
    critical: false,
    checkRequired: (dna) => dna.weaknesses.length === 0,
    checkConfidence: (dna) => (dna.weaknesses.length > 0 ? "medium" : "low"),
  },
  {
    category: "objectives",
    name: "Business Objectives",
    critical: true,
    checkRequired: (dna) => dna.objectives.length === 0,
    checkConfidence: (dna) => (dna.objectives.length > 2 ? "high" : dna.objectives.length > 0 ? "medium" : "low"),
  },
  {
    category: "processes",
    name: "Business Processes",
    critical: false,
    checkRequired: (dna) => dna.processes.length === 0,
    checkConfidence: (dna) => (dna.processes.length > 0 ? "medium" : "low"),
  },
] as const;

/**
 * Define all Founder Brain gap categories with deterministic checks.
 */
const BRAIN_GAP_CATEGORIES: readonly GapCategoryConfig[] = [
  {
    category: "leadership_style",
    name: "Leadership Style",
    critical: false,
    checkRequired: (_dna, brain) => !brain?.leadership,
    checkConfidence: (_dna, brain) => (brain?.leadership ? brain.leadership.confidence.level : "low"),
  },
  {
    category: "priorities",
    name: "Founder Priorities",
    critical: true,
    checkRequired: (_dna, brain) => !brain?.priorities || brain.priorities.length === 0,
    checkConfidence: (_dna, brain) => (brain?.priorities && brain.priorities.length > 2 ? "high" : brain?.priorities && brain.priorities.length > 0 ? "medium" : "low"),
  },
  {
    category: "philosophy",
    name: "Business Philosophy",
    critical: false,
    checkRequired: (_dna, brain) => !brain?.philosophy,
    checkConfidence: (_dna, brain) => (brain?.philosophy ? brain.philosophy.confidence.level : "low"),
  },
  {
    category: "risk_tolerance",
    name: "Risk Tolerance",
    critical: true,
    checkRequired: (_dna, brain) => !brain?.riskTolerance,
    checkConfidence: (_dna, brain) => (brain?.riskTolerance ? brain.riskTolerance.confidence.level : "low"),
  },
  {
    category: "delegation_style",
    name: "Delegation Style",
    critical: false,
    checkRequired: (_dna, brain) => !brain?.delegation,
    checkConfidence: (_dna, brain) => (brain?.delegation ? brain.delegation.confidence.level : "low"),
  },
  {
    category: "decision_making",
    name: "Decision Making",
    critical: true,
    checkRequired: (_dna, brain) => !brain?.decisionMaking,
    checkConfidence: (_dna, brain) => (brain?.decisionMaking ? brain.decisionMaking.confidence.level : "low"),
  },
  {
    category: "communication",
    name: "Communication Style",
    critical: true,
    checkRequired: (_dna, brain) => !brain?.communication,
    checkConfidence: (_dna, brain) => (brain?.communication ? brain.communication.confidence.level : "low"),
  },
  {
    category: "preferences",
    name: "Founder Preferences",
    critical: false,
    checkRequired: (_dna, brain) => !brain?.preferences,
    checkConfidence: (_dna, brain) => (brain?.preferences ? brain.preferences.confidence.level : "low"),
  },
] as const;

/**
 * Generate a unique gap ID.
 */
function generateGapId(category: FindingCategory): string {
  return `gap_${category}_${Date.now()}`;
}

/**
 * Determine gap importance based on category criticality and confidence.
 */
function determineGapImportance(
  critical: boolean,
  confidence: DiscoveryConfidenceLevel,
): DiscoveryGap["importance"] {
  if (critical && confidence === "low") return "critical";
  if (critical) return "high";
  if (confidence === "low") return "medium";
  return "low";
}

/**
 * Perform gap analysis on Company DNA and Founder Brain.
 */
export function analyzeGaps(
  companyDna: CompanyDNA,
  founderBrain?: FounderBrain,
): GapAnalysisResult {
  const gaps: DiscoveryGap[] = [];
  const knownCategories: FindingCategory[] = [];
  const missingCategories: FindingCategory[] = [];
  const confidenceByCategory: Partial<Record<FindingCategory, DiscoveryConfidenceLevel>> = {};
  const criticalGaps: DiscoveryGap[] = [];

  const activeCategories = founderBrain
    ? [...DNA_GAP_CATEGORIES, ...BRAIN_GAP_CATEGORIES]
    : DNA_GAP_CATEGORIES;

  for (const config of activeCategories) {
    const isRequired = founderBrain
      ? config.checkRequired(companyDna, founderBrain)
      : config.checkRequired(companyDna);
    const confidence = founderBrain
      ? config.checkConfidence(companyDna, founderBrain)
      : config.checkConfidence(companyDna);
    confidenceByCategory[config.category] = confidence;

    if (isRequired) {
      const importance = determineGapImportance(config.critical, confidence);
      const gap: DiscoveryGap = {
        id: generateGapId(config.category),
        category: config.category,
        description: `Missing ${config.name}. This information is ${config.critical ? "critical" : "important"} for understanding the business.`,
        importance,
        blockingAction: config.critical,
      };
      gaps.push(gap);
      missingCategories.push(config.category);

      if (importance === "critical") {
        criticalGaps.push(gap);
      }
    } else {
      knownCategories.push(config.category);
    }
  }

  const totalCategories = activeCategories.length;
  const knownPercentage = Math.round((knownCategories.length / totalCategories) * 100);

  return {
    gaps,
    knownCategories,
    missingCategories,
    confidenceByCategory: confidenceByCategory as Readonly<Record<FindingCategory, DiscoveryConfidenceLevel>>,
    criticalGaps,
    overallCompleteness: knownPercentage,
  };
}

/**
 * Get gap categories by importance.
 */
export function getGapsByImportance(
  analysis: GapAnalysisResult,
  importance: DiscoveryGap["importance"],
): readonly DiscoveryGap[] {
  return analysis.gaps.filter((gap) => gap.importance === importance);
}

/**
 * Get blocking gaps.
 */
export function getBlockingGaps(analysis: GapAnalysisResult): readonly DiscoveryGap[] {
  return analysis.gaps.filter((gap) => gap.blockingAction);
}

/**
 * Check if gap analysis passes minimum requirements.
 */
export function meetsMinimumRequirements(analysis: GapAnalysisResult): boolean {
  const criticalGapsCount = analysis.criticalGaps.length;
  const completeness = analysis.overallCompleteness;

  // Minimum requirements: no critical gaps and at least 50% complete
  return criticalGapsCount === 0 && completeness >= 50;
}

/**
 * Get completeness summary.
 */
export function getCompletenessSummary(
  analysis: GapAnalysisResult,
): {
  readonly companyDna: number;
  readonly founderBrain: number;
  readonly overall: number;
} {
  const dnaCategories: FindingCategory[] = [
    "mission",
    "vision",
    "values",
    "value_proposition",
    "products",
    "services",
    "market",
    "ideal_customer",
    "tone",
    "positioning",
    "strengths",
    "weaknesses",
    "objectives",
    "processes",
  ];

  const brainCategories: FindingCategory[] = [
    "leadership_style",
    "priorities",
    "philosophy",
    "risk_tolerance",
    "delegation_style",
    "decision_making",
    "communication",
    "preferences",
  ];

  const dnaKnown = analysis.knownCategories.filter((c) => dnaCategories.includes(c)).length;
  const brainKnown = analysis.knownCategories.filter((c) => brainCategories.includes(c)).length;

  return {
    companyDna: Math.round((dnaKnown / dnaCategories.length) * 100),
    founderBrain: Math.round((brainKnown / brainCategories.length) * 100),
    overall: analysis.overallCompleteness,
  };
}
