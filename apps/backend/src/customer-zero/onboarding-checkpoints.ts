/**
 * Customer Zero onboarding checkpoints — Customer Zero P0 observability.
 *
 * WHY
 *
 * When onboarding broke in production the only way to find out where it
 * broke was to guess. These checkpoints exist so that the next time
 * something fails we can answer two questions from the logs alone:
 *
 *   LAST_SUCCESSFUL_CHECKPOINT
 *   FIRST_FAILED_CHECKPOINT
 *
 * SAFETY
 *
 * A checkpoint carries the organization id and nothing else. It never
 * logs OAuth tokens, email passwords, secrets, raw credentials, company
 * content or personal data. If you are tempted to add a payload here,
 * add it to a domain-specific log instead.
 */

export type OnboardingCheckpoint =
  | "customer_zero_started"
  | "research_started"
  | "research_completed"
  | "blocking_discovery_completed"
  | "ceo_confirmation_completed"
  | "company_dna_persisted"
  | "company_context_compiled"
  | "context_readiness_passed"
  | "context_readiness_blocked"
  | "customer_zero_handoff_completed";

/**
 * Emits a structured onboarding checkpoint.
 *
 * `detail` is reserved for non-sensitive structural facts only — for
 * example which readiness facts are still missing. Never company
 * content, never credentials.
 */
export function checkpoint(
  name: OnboardingCheckpoint,
  organizationId: string,
  detail?: Readonly<Record<string, string | number | boolean | readonly string[]>>,
): void {
  const payload = {
    checkpoint: name,
    organizationId,
    ...(detail ?? {}),
  };
  console.info(`[customer-zero] ${JSON.stringify(payload)}`);
}
