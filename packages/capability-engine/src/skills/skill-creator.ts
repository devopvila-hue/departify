/**
 * Skill Creator lifecycle — Sprint 62.
 *
 * The internal contract for generating a missing capability. This is NOT an
 * uncontrolled autonomous coding agent: the lifecycle is explicit, each stage
 * is a contract, and a generated capability NEVER becomes READY merely because
 * an LLM claims it works.
 *
 * READY requires deterministic verification (capability verification passed +
 * registration + the registry's operational source reporting it operational).
 */

export type SkillCreatorStage =
  | "need_detected"
  | "specification"
  | "implementation"
  | "tested"
  | "security_validated"
  | "sandboxed"
  | "capability_verified"
  | "registered";

export const SKILL_CREATOR_ORDER: readonly SkillCreatorStage[] = [
  "need_detected",
  "specification",
  "implementation",
  "tested",
  "security_validated",
  "sandboxed",
  "capability_verified",
  "registered",
];

export interface SkillCreatorRequest {
  /** Business capability the department is missing. */
  readonly requiredCapability: string;
  readonly department: string;
  readonly objective: string;
}

export interface SkillSpecification {
  readonly capabilityId: string;
  readonly name: string;
  readonly description: string;
  readonly actions: readonly string[];
}

export interface SkillCreatorArtifact {
  /** Spec produced at NEED DETECTED → SPECIFICATION. */
  readonly specification?: SkillSpecification;
  /** Implementation produced at IMPLEMENTATION. */
  readonly implementationId?: string;
  /** Unit test result produced at TESTED. */
  readonly tested?: { passed: boolean; count: number };
  /** Security validation produced at SECURITY VALIDATION. */
  readonly securityValidated?: { passed: boolean; findings: readonly string[] };
  /** Sandbox execution produced at SANDBOX. */
  readonly sandboxed?: { passed: boolean; findings: readonly string[] };
  /** Deterministic capability verification produced at CAPABILITY VERIFICATION. */
  readonly capabilityVerified?: { passed: boolean; evidence: readonly string[] };
  readonly registered?: boolean;
}

export interface SkillCreatorLifecycle {
  readonly request: SkillCreatorRequest;
  readonly stage: SkillCreatorStage;
  readonly artifact: SkillCreatorArtifact;
}

/**
 * Deterministic gate: a generated capability may be REGISTERED only after the
 * full lifecycle has produced deterministic verification.
 */
export function canRegisterGeneratedCapability(
  lifecycle: SkillCreatorLifecycle,
): boolean {
  const { artifact } = lifecycle;
  return (
    artifact.tested?.passed === true &&
    artifact.securityValidated?.passed === true &&
    artifact.sandboxed?.passed === true &&
    artifact.capabilityVerified?.passed === true &&
    stageReached(lifecycle, "registered")
  );
}

export function stageReached(
  lifecycle: SkillCreatorLifecycle,
  stage: SkillCreatorStage,
): boolean {
  const orderIndex = SKILL_CREATOR_ORDER.indexOf(stage);
  const currentIndex = SKILL_CREATOR_ORDER.indexOf(lifecycle.stage);
  return currentIndex >= orderIndex;
}

/**
 * Deterministic guard: an LLM-generated capability is NEVER considered verified
 * without CAPABILITY VERIFICATION evidence. Returns the blocking reason.
 */
export function generatedCapabilityBlockReason(
  lifecycle: SkillCreatorLifecycle,
): string | null {
  const { artifact } = lifecycle;
  if (artifact.capabilityVerified?.passed !== true) {
    return "capability verification not passed";
  }
  if (artifact.securityValidated?.passed !== true) {
    return "security validation not passed";
  }
  if (artifact.sandboxed?.passed !== true) {
    return "sandbox not passed";
  }
  if (artifact.tested?.passed !== true) {
    return "tests not passed";
  }
  return null;
}
