import type {
  AgentToolActionResult,
  AgentToolOutcome,
  AgentToolOutcomeError,
} from "@departify/agent-tool-bridge";
import type { ExecutiveDecision } from "@departify/executive-director";
import type {
  HealthCheckIntent,
  OrganizationSummaryIntent,
  GenerateIdentifierIntent,
} from "./orchestrator-contracts.js";

export type OrchestratorIntentSummary =
  HealthCheckIntent | OrganizationSummaryIntent | GenerateIdentifierIntent;

/**
 * Envelope returned by the orchestrator after every run. Preserves the full
 * correlation chain (intentId → decisionId → actionId) regardless of whether
 * the run completed, failed, was cancelled, or was rejected.
 */
export interface OrchestrationResult<TResult = unknown> {
  readonly intentId: string;
  readonly decisionId: string | null;
  readonly actionId: string | null;
  readonly decision: ExecutiveDecision | null;
  readonly intent: OrchestratorIntentSummary;
  readonly tool: {
    readonly toolId: string;
    readonly status: "completed" | "failed" | "cancelled" | "rejected";
  };
  readonly output: TResult | null;
  readonly error: OrchestrationError | null;
  readonly startedAt: string;
  readonly completedAt: string;
}

/**
 * Normalised error envelope. Carries enough information for callers to
 * branch on the failure mode (rejection, authorization, runtime, …) without
 * parsing strings.
 */
export interface OrchestrationError {
  readonly code: string;
  readonly message: string;
  readonly phase: "intent" | "decision" | "bridge" | "tool";
}

/**
 * Helper that extracts the success envelope when the result is a completed
 * AgentToolActionResult, or returns the error otherwise.
 */
export function fromAgentToolOutcome(
  intent: OrchestratorIntentSummary,
  decision: ExecutiveDecision | null,
  outcome: AgentToolOutcome,
  startedAt: string,
  completedAt: string,
): OrchestrationResult {
  const actionId = decision ? `act_${decision.decisionId}` : null;
  if ("status" in outcome && outcome.status === "rejected") {
    return {
      intentId: intent.intentId,
      decisionId: decision?.decisionId ?? null,
      actionId,
      decision,
      intent,
      tool: {
        toolId: extractToolIdFromError(outcome),
        status: "rejected",
      },
      output: null,
      error: {
        code: outcome.code,
        message: outcome.reason,
        phase: "bridge",
      },
      startedAt,
      completedAt,
    };
  }

  const success = outcome as AgentToolActionResult;
  const error: OrchestrationError | null = success.error
    ? {
        code: success.error.code,
        message: success.error.message,
        phase: "tool",
      }
    : null;
  const status: OrchestrationResult["tool"]["status"] =
    success.status === "completed"
      ? "completed"
      : success.status === "cancelled"
        ? "cancelled"
        : "failed";

  return {
    intentId: intent.intentId,
    decisionId: decision?.decisionId ?? null,
    actionId,
    decision,
    intent,
    tool: {
      toolId: success.toolId,
      status,
    },
    output: (success.output ?? null) as unknown | null,
    error,
    startedAt,
    completedAt,
  };
}

function extractToolIdFromError(outcome: AgentToolOutcomeError): string {
  return outcome.toolId;
}
