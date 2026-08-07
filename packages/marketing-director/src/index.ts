export {
  type MarketingDiagnosis,
  type MarketingDiagnosisInput,
  type MarketingFinding,
  type MarketingOpportunity,
  type MarketingCapabilityGap,
  type DiagnosisConfidence,
  validateDiagnosis,
} from "./models/marketing-diagnosis.js";

export {
  type MarketingCapability,
  createMarketingCapability,
} from "./models/marketing-capability.js";

export {
  type MarketingSkill,
  type MarketingSpecialist,
  type MarketingTool,
  getSpecialistCapabilities,
} from "./models/marketing-specialist.js";

export {
  type SolutionEntry,
  type SolutionCatalog,
  createSolutionCatalog,
  findSolutions,
  findBestSolution,
} from "./models/solution-catalog.js";

export {
  type Recommendation,
  type ConnectionReason,
  buildRecommendation,
  buildConnectionReason,
} from "./models/recommendation.js";

export {
  MARKETING_CAPABILITIES,
  MARKETING_SPECIALISTS,
  SOLUTION_CATALOGS,
  buildCapabilityMap,
  buildSpecialistMap,
  getExistingToolCapabilities,
} from "./catalog/marketing-capabilities.js";

export {
  produceMarketingDiagnosis,
  detectGoalCategory,
} from "./engine/diagnosis-engine.js";

export {
  formTeam,
  getTeamCapabilityList,
  type TeamFormationResult,
  type TeamMember,
} from "./engine/team-engine.js";

export {
  analyzeCapabilityGaps,
  type GapAnalysisResult,
} from "./engine/gap-engine.js";
