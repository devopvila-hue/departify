/**
 * Business Discovery Package — Sprint 28
 *
 * The only authorized boundary for discovering a company in Departify.
 *
 * This package models the complete Business Discovery pipeline without
 * executing AI, scraping, or HTTP calls. It defines:
 *
 * - BusinessDiscoveryRequest: input for discovery
 * - BusinessDiscoverySession: discovery session tracking
 * - CompanyDiscoveryReport: comprehensive discovery outcome
 * - CompanyDNA: canonical company identity model
 * - FounderBrain: canonical founder psychology model
 * - Gap Analysis: deterministic gap detection
 * - Question Generator: deterministic adaptive question generation
 * - BusinessDiscoveryResult: final result envelope
 *
 * No AI. No scraping. No HTTP. Just contracts, composition, and rules.
 */

// Types
export type {
  BusinessDiscoveryId,
  DiscoverySessionId,
  OrganizationId,
  DiscoveryConfidenceLevel,
  DiscoverySource,
  BusinessDiscoveryRequest,
  BusinessDiscoverySession,
  DiscoverySessionStatus,
  DiscoveryPhase,
  DiscoveryFinding,
  FindingCategory,
  DiscoveryGap,
  DiscoveryQuestion,
} from "./contracts/discovery-types.js";

export type {
  BusinessDiscoveryStatus,
  DiscoveryError,
  PartialResultInfo,
  BusinessDiscoveryResult,
} from "./contracts/discovery-result.js";

// Company DNA
export type {
  DnaConfidence,
  CompanyMission,
  CompanyVision,
  CompanyValue,
  ValueProposition,
  CompanyProduct,
  CompanyService,
  CompanyMarket,
  IdealCustomer,
  CompanyTone,
  CompanyPositioning,
  CompanyStrength,
  CompanyWeakness,
  CompanyObjective,
  CompanyProcess,
  CompanyDNA,
  DnaCompleteness,
} from "./models/company-dna.js";

// Founder Brain
export type {
  BrainConfidence,
  LeadershipProfile,
  FounderPriority,
  BusinessPhilosophy,
  RiskToleranceLevel,
  RiskTolerance,
  DelegationStyle,
  DecisionSpeed,
  DecisionMaking,
  CommunicationStyle,
  FounderPreferences,
  FounderBrain,
  BrainCompleteness,
} from "./models/founder-brain.js";

// Discovery Report
export type {
  DiscoveryConfidence,
  DiscoveryMetadata,
  CompanyDiscoveryReport,
} from "./models/discovery-report.js";

// Validation errors
export {
  DiscoveryValidationError,
  validateBusinessDiscoveryRequest,
} from "./contracts/discovery-types.js";

// Company DNA functions
export {
  calculateDnaCompleteness,
  createMinimalConfidence,
  createVerifiedConfidence,
  buildEmptyCompanyDNA,
  validateCompanyDNA,
  CompanyDnaValidationError,
} from "./models/company-dna.js";

// Founder Brain functions
export {
  calculateBrainCompleteness,
  createMinimalBrainConfidence,
  createVerifiedBrainConfidence,
  buildEmptyFounderBrain,
  validateFounderBrain,
  FounderBrainValidationError,
} from "./models/founder-brain.js";

// Discovery Report functions
export {
  calculateDiscoveryConfidence,
  validateDiscoveryReport,
  DiscoveryReportValidationError,
} from "./models/discovery-report.js";

// Discovery Result functions
export {
  buildDiscoverySuccess,
  buildDiscoveryPartial,
  buildDiscoveryFailure,
  buildDiscoveryCancelled,
  createDiscoveryError,
  DiscoveryErrorCode,
} from "./contracts/discovery-result.js";

// Gap Analysis
export {
  analyzeGaps,
  getGapsByImportance,
  getBlockingGaps,
  meetsMinimumRequirements,
  getCompletenessSummary,
  type GapAnalysisResult,
} from "./analysis/gap-analysis.js";

// Question Generator
export {
  generateQuestions,
  generateQuestionsForCategory,
  getQuestionTemplateByCategory,
  getAllQuestionCategories,
  calculateQuestionPriority,
} from "./analysis/question-generator.js";

// Pipeline
export {
  createDiscoverySession,
  generateSessionId,
  executeDiscoveryPipeline,
  pipelineResultToDiscoveryResult,
  getPipelinePhases,
  isValidPhase,
  type PipelineContext,
  type PipelineResult,
  type DiscoveryInput,
} from "./pipeline/discovery-pipeline.js";

// Service
export {
  BusinessDiscoveryService,
  createBusinessDiscoveryService,
  defaultDiscoveryService,
  type BusinessDiscoveryServiceConfig,
} from "./service/discovery-service.js";
