/**
 * Skill Finder / Adapter pipeline — Sprint 62.
 *
 * The canonical abstraction for future skill discovery across ecosystems
 * (MCP-compatible servers, reusable skill definitions, etc.).
 *
 * External skills are NEVER executed directly. The only path to READY is the
 * deterministic pipeline:
 *
 *   DISCOVER → INSPECT → IMPORT → NORMALIZE → SECURITY VALIDATE → SANDBOX TEST
 *   → CAPABILITY TEST → REGISTER → READY
 *
 * This module defines the CONTRACT and a deterministic gate: an imported /
 * external capability can only be registered (and later become READY via the
 * DepartmentCapabilityRegistry) after SECURITY VALIDATE, SANDBOX TEST and
 * CAPABILITY TEST all pass. Sprint 62 does NOT download or execute arbitrary
 * Internet code.
 */

export type SkillPipelineStage =
  | "discovered"
  | "inspected"
  | "imported"
  | "normalized"
  | "security_validated"
  | "sandbox_tested"
  | "capability_tested"
  | "registered"
  | "ready";

export const SKILL_PIPELINE_ORDER: readonly SkillPipelineStage[] = [
  "discovered",
  "inspected",
  "imported",
  "normalized",
  "security_validated",
  "sandbox_tested",
  "capability_tested",
  "registered",
  "ready",
];

export interface SkillProvenance {
  /** Where the skill was found (e.g. "mcp.server:example", "catalog:example"). */
  readonly origin: string;
  /** Whether it came from an untrusted/external ecosystem. */
  readonly external: boolean;
  readonly version?: string;
}

export interface SkillInspection {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly actions: readonly string[];
  /** What the skill claims it can do (claims are NOT facts). */
  readonly claimedCapabilities: readonly string[];
  readonly riskHint?: string;
}

export interface SkillValidationResult {
  readonly passed: boolean;
  readonly findings: readonly string[];
}

export interface SkillImportResult {
  readonly id: string;
  /** Normalized capability contract produced by IMPORT → NORMALIZE. */
  readonly capabilityId: string;
}

export interface SkillPipelineProgress {
  readonly skillId: string;
  readonly provenance: SkillProvenance;
  readonly stage: SkillPipelineStage;
  readonly passed: readonly SkillPipelineStage[];
  readonly inspection?: SkillInspection;
  readonly security?: SkillValidationResult;
  readonly sandbox?: SkillValidationResult;
  readonly capabilityTest?: SkillValidationResult;
}

export interface SkillFinderPipeline {
  discover(origin: string, external: boolean): SkillPipelineProgress;
  inspect(progress: SkillPipelineProgress, inspection: SkillInspection): SkillPipelineProgress;
  import(progress: SkillPipelineProgress): SkillPipelineProgress;
  normalize(progress: SkillPipelineProgress, capabilityId: string): SkillPipelineProgress;
  securityValidate(progress: SkillPipelineProgress, result: SkillValidationResult): SkillPipelineProgress;
  sandboxTest(progress: SkillPipelineProgress, result: SkillValidationResult): SkillPipelineProgress;
  capabilityTest(progress: SkillPipelineProgress, result: SkillValidationResult): SkillPipelineProgress;
  register(progress: SkillPipelineProgress): SkillPipelineProgress;
  ready(progress: SkillPipelineProgress): SkillPipelineProgress;
}

/**
 * Deterministic gate: an external skill cannot reach REGISTER / READY unless
 * SECURITY VALIDATE, SANDBOX TEST and CAPABILITY TEST all passed.
 */
export function canRegister(progress: SkillPipelineProgress): boolean {
  if (!progress.provenance.external) {
    return stageReached(progress, "capability_tested");
  }
  return (
    progress.security?.passed === true &&
    progress.sandbox?.passed === true &&
    progress.capabilityTest?.passed === true
  );
}

export function stageReached(
  progress: SkillPipelineProgress,
  stage: SkillPipelineStage,
): boolean {
  return progress.passed.includes(stage);
}

export function nextStage(progress: SkillPipelineProgress): SkillPipelineStage | null {
  const index = SKILL_PIPELINE_ORDER.indexOf(progress.stage);
  if (index < 0 || index >= SKILL_PIPELINE_ORDER.length - 1) return null;
  return SKILL_PIPELINE_ORDER[index + 1] ?? null;
}

/**
 * Deterministic guard used by hosts: importing an untrusted skill never
 * produces a registered capability without the required gates. Returns the
 * reason when registration must be blocked.
 */
export function registrationBlockReason(
  progress: SkillPipelineProgress,
): string | null {
  if (canRegister(progress)) return null;
  if (!progress.provenance.external) {
    return "capability test not passed";
  }
  if (progress.security?.passed !== true) {
    return "security validation not passed";
  }
  if (progress.sandbox?.passed !== true) {
    return "sandbox test not passed";
  }
  if (progress.capabilityTest?.passed !== true) {
    return "capability test not passed";
  }
  return "unknown gate";
}
