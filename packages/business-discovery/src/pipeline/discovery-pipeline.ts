/**
 * Business Discovery Pipeline — canonical discovery orchestration.
 *
 * The pipeline defines the complete flow from input to result.
 * It models each phase without executing AI, scraping, or HTTP calls.
 */

import type {
  BusinessDiscoveryRequest,
  BusinessDiscoverySession,
  DiscoverySessionId,
  DiscoveryPhase,
  OrganizationId,
} from "../contracts/discovery-types.js";
import type { CompanyDNA } from "../models/company-dna.js";
import type { FounderBrain } from "../models/founder-brain.js";
import type { CompanyDiscoveryReport } from "../models/discovery-report.js";
import type { BusinessDiscoveryResult } from "../contracts/discovery-result.js";
import { analyzeGaps } from "../analysis/gap-analysis.js";
import { generateQuestions } from "../analysis/question-generator.js";
import { buildDiscoverySuccess, buildDiscoveryFailure, createDiscoveryError, type DiscoveryError } from "../contracts/discovery-result.js";

/**
 * Pipeline phase result.
 */
interface PhaseResult {
  readonly phase: DiscoveryPhase;
  readonly startedAt: Date;
  readonly completedAt: Date;
  readonly success: boolean;
  readonly errors: readonly DiscoveryError[];
}

/**
 * Pipeline execution context.
 */
export interface PipelineContext {
  readonly organizationId: OrganizationId;
  readonly sessionId: DiscoverySessionId;
  readonly request: BusinessDiscoveryRequest;
  readonly now: () => Date;
}

/**
 * Input data for the pipeline (normally collected, but model-only for now).
 */
export interface DiscoveryInput {
  readonly organizationId: OrganizationId;
  readonly rawData: Readonly<Record<string, unknown>>;
  readonly sources: readonly string[];
}

/**
 * Pipeline result envelope.
 */
export interface PipelineResult {
  readonly session: BusinessDiscoverySession;
  readonly report: CompanyDiscoveryReport | null;
  readonly errors: readonly DiscoveryError[];
  readonly phases: readonly PhaseResult[];
}

/**
 * Create a new discovery session.
 */
export function createDiscoverySession(
  request: BusinessDiscoveryRequest,
  sessionId: DiscoverySessionId,
): BusinessDiscoverySession {
  return {
    sessionId,
    organizationId: request.organizationId,
    request,
    startedAt: new Date(),
    status: "pending",
    currentPhase: "initialization",
    phasesCompleted: [],
  };
}

/**
 * Generate a session ID.
 */
export function generateSessionId(): DiscoverySessionId {
  return `discovery_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Execute a pipeline phase.
 */
async function executePhase(
  phase: DiscoveryPhase,
  context: PipelineContext,
  executor: () => Promise<void>,
): Promise<PhaseResult> {
  const startedAt = new Date();
  const errors: DiscoveryError[] = [];
  let success = false;

  try {
    await executor();
    success = true;
  } catch (error) {
    errors.push(
      createDiscoveryError(
        `PHASE_FAILED_${phase.toUpperCase()}`,
        phase,
        error instanceof Error ? error.message : "Unknown error",
        { error },
        true,
      ),
    );
  }

  return {
    phase,
    startedAt,
    completedAt: new Date(),
    success,
    errors,
  };
}

/**
 * Phase: Initialization.
 */
async function phaseInitialization(
  context: PipelineContext,
): Promise<{ input: DiscoveryInput }> {
  return {
    input: {
      organizationId: context.organizationId,
      // Sprint 55 — the CEO / host provides the real company information
      // through the request; the pipeline carries it into DNA analysis.
      rawData: context.request.rawData ?? {},
      sources: [],
    },
  };
}

/**
 * Phase: Data Collection.
 * NOTE: No scraping or HTTP calls in Sprint 28.
 */
async function phaseDataCollection(
  context: PipelineContext,
  input: DiscoveryInput,
): Promise<DiscoveryInput> {
  // Placeholder for data collection
  // In future sprints, this would collect from website, social media, etc.
  return input;
}

/**
 * Phase: Company DNA Analysis.
 */
async function phaseCompanyDnaAnalysis(
  context: PipelineContext,
  input: DiscoveryInput,
): Promise<{ companyDna: CompanyDNA }> {
  // Import dynamically to avoid circular dependency
  const { buildEmptyCompanyDNA, mergeRawDna } = await import(
    "../models/company-dna.js"
  );

  const base = buildEmptyCompanyDNA(context.organizationId);
  // Sprint 55 — when the host provided real company information, merge it
  // into the Company DNA so the gap analysis works on real data instead of
  // an empty model.
  const companyDna =
    Object.keys(input.rawData).length > 0
      ? mergeRawDna(base, input.rawData)
      : base;
  return { companyDna };
}

/**
 * Phase: Founder Brain Analysis.
 */
async function phaseFounderBrainAnalysis(
  context: PipelineContext,
): Promise<{ founderBrain: FounderBrain | undefined }> {
  if (!context.request.options.includeFounderBrain) {
    return { founderBrain: undefined };
  }

  const { buildEmptyFounderBrain } = await import("../models/founder-brain.js");

  const founderBrain = buildEmptyFounderBrain(context.organizationId);
  return { founderBrain };
}

/**
 * Phase: Gap Analysis.
 */
async function phaseGapAnalysis(
  context: PipelineContext,
  companyDna: CompanyDNA,
  founderBrain?: FounderBrain,
): Promise<{ gaps: ReturnType<typeof analyzeGaps> }> {
  return { gaps: analyzeGaps(companyDna, founderBrain) };
}

/**
 * Phase: Question Generation.
 */
async function phaseQuestionGeneration(
  context: PipelineContext,
  gapAnalysis: ReturnType<typeof analyzeGaps>,
): Promise<{ questions: ReturnType<typeof generateQuestions> }> {
  const questions = generateQuestions(gapAnalysis, {
    maxQuestionsPerGap: 3,
    includeLowPriority: false,
    maxTotalQuestions: 20,
  });

  return { questions };
}

/**
 * Phase: Finalization.
 */
async function phaseFinalization(
  context: PipelineContext,
  companyDna: CompanyDNA,
  founderBrain: FounderBrain | undefined,
  gapAnalysis: ReturnType<typeof analyzeGaps>,
  questions: ReturnType<typeof generateQuestions>,
): Promise<{ report: CompanyDiscoveryReport }> {
  const { calculateDiscoveryConfidence } = await import("../models/discovery-report.js");

  const baseReport: Omit<CompanyDiscoveryReport, "founderBrain"> = {
    organizationId: context.organizationId,
    sessionId: context.sessionId,
    metadata: {
      sessionId: context.sessionId,
      startedAt: context.request.requestedAt,
      completedAt: context.now(),
      durationMs: context.now().getTime() - context.request.requestedAt.getTime(),
      sources: [],
      dataPoints: 0,
      questionsAsked: questions.length,
      questionsAnswered: 0,
    },
    companyDna,
    findings: [],
    gaps: gapAnalysis.gaps,
    questions,
    confidence: calculateDiscoveryConfidence(companyDna, founderBrain),
    generatedAt: context.now(),
  };

  if (founderBrain) {
    const report: CompanyDiscoveryReport = { ...baseReport, founderBrain };
    return { report };
  }

  const report: CompanyDiscoveryReport = baseReport;
  return { report };
}

/**
 * Execute the complete Business Discovery pipeline.
 */
export async function executeDiscoveryPipeline(
  request: BusinessDiscoveryRequest,
  context: PipelineContext,
): Promise<PipelineResult> {
  const phases: PhaseResult[] = [];
  const errors: DiscoveryError[] = [];

  // Create session
  let session: BusinessDiscoverySession = createDiscoverySession(request, context.sessionId);
  session = { ...session, status: "in_progress" as const };

  // Phase 1: Initialization
  const initResult = await executePhase("initialization", context, async () => {
    // Phase logic handled outside
  });
  phases.push(initResult);
  if (!initResult.success) {
    errors.push(...initResult.errors);
    session = { ...session, status: "failed" as const };
    return { session, report: null, errors, phases };
  }
  session = {
    ...session,
    currentPhase: "initialization" as const,
    phasesCompleted: [...session.phasesCompleted, "initialization" as const],
  };

  const { input } = await phaseInitialization(context);

  // Phase 2: Data Collection
  const dataResult = await executePhase("data_collection", context, async () => {
    // Phase logic handled outside
  });
  phases.push(dataResult);
  session = {
    ...session,
    currentPhase: "data_collection" as const,
    phasesCompleted: [...session.phasesCompleted, "data_collection" as const],
  };
  await phaseDataCollection(context, input);

  // Phase 3: Company DNA Analysis
  const dnaResult = await executePhase("company_dna_analysis", context, async () => {
    // Phase logic handled outside
  });
  phases.push(dnaResult);
  session = {
    ...session,
    currentPhase: "company_dna_analysis" as const,
    phasesCompleted: [...session.phasesCompleted, "company_dna_analysis" as const],
  };
  const { companyDna } = await phaseCompanyDnaAnalysis(context, input);

  // Phase 4: Founder Brain Analysis
  const brainResult = await executePhase("founder_brain_analysis", context, async () => {
    // Phase logic handled outside
  });
  phases.push(brainResult);
  session = {
    ...session,
    currentPhase: "founder_brain_analysis" as const,
    phasesCompleted: [...session.phasesCompleted, "founder_brain_analysis" as const],
  };
  const { founderBrain } = await phaseFounderBrainAnalysis(context);

  // Phase 5: Gap Analysis
  const gapResult = await executePhase("gap_analysis", context, async () => {
    // Phase logic handled outside
  });
  phases.push(gapResult);
  session = {
    ...session,
    currentPhase: "gap_analysis" as const,
    phasesCompleted: [...session.phasesCompleted, "gap_analysis" as const],
  };
  const { gaps: gapAnalysis } = await phaseGapAnalysis(context, companyDna, founderBrain);

  // Phase 6: Question Generation
  const questionResult = await executePhase("question_generation", context, async () => {
    // Phase logic handled outside
  });
  phases.push(questionResult);
  session = {
    ...session,
    currentPhase: "question_generation" as const,
    phasesCompleted: [...session.phasesCompleted, "question_generation" as const],
  };
  const { questions } = await phaseQuestionGeneration(context, gapAnalysis);

  // Phase 7: Finalization
  const finalResult = await executePhase("finalization", context, async () => {
    // Phase logic handled outside
  });
  phases.push(finalResult);
  session = {
    ...session,
    currentPhase: "finalization" as const,
    phasesCompleted: [...session.phasesCompleted, "finalization" as const],
  };
  const { report } = await phaseFinalization(
    context,
    companyDna,
    founderBrain,
    gapAnalysis,
    questions,
  );

  session = {
    ...session,
    status: "completed" as const,
    completedAt: new Date(),
  };

  return { session, report, errors, phases };
}

/**
 * Convert pipeline result to BusinessDiscoveryResult.
 */
export function pipelineResultToDiscoveryResult(
  pipelineResult: PipelineResult,
): BusinessDiscoveryResult {
  if (!pipelineResult.report || pipelineResult.session.status !== "completed") {
    return buildDiscoveryFailure({
      organizationId: pipelineResult.session.organizationId,
      sessionId: pipelineResult.session.sessionId,
      errors: pipelineResult.errors,
      startedAt: pipelineResult.session.startedAt,
      completedAt: pipelineResult.session.completedAt ?? new Date(),
    });
  }

  return buildDiscoverySuccess({
    organizationId: pipelineResult.session.organizationId,
    sessionId: pipelineResult.session.sessionId,
    report: pipelineResult.report,
    startedAt: pipelineResult.session.startedAt,
    completedAt: pipelineResult.session.completedAt ?? new Date(),
  });
}

/**
 * Get the ordered list of pipeline phases.
 */
export function getPipelinePhases(): readonly DiscoveryPhase[] {
  return [
    "initialization",
    "data_collection",
    "company_dna_analysis",
    "founder_brain_analysis",
    "gap_analysis",
    "question_generation",
    "finalization",
  ];
}

/**
 * Check if a phase is valid.
 */
export function isValidPhase(phase: string): phase is DiscoveryPhase {
  return getPipelinePhases().includes(phase as DiscoveryPhase);
}
