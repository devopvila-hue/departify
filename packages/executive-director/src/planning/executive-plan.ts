import type { ExecutiveDecision } from "../decisions/executive-decisions.js";
import type { ExecutiveIntent } from "../intents/executive-intents.js";

export const orchestrationStages = [
  "intent_received",
  "intent_validated",
  "decision_created",
  "coordination_ready",
] as const;

export type OrchestrationStage = (typeof orchestrationStages)[number];

export interface ExecutivePlan {
  intent: ExecutiveIntent;
  decision: ExecutiveDecision;
  stages: readonly OrchestrationStage[];
}

export function createExecutivePlan(
  intent: ExecutiveIntent,
  decision: ExecutiveDecision,
): ExecutivePlan {
  return {
    intent,
    decision,
    stages: [
      "intent_received",
      "intent_validated",
      "decision_created",
      "coordination_ready",
    ],
  };
}
