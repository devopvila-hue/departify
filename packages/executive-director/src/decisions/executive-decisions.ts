import type { ExecutiveIntentType } from "../intents/executive-intents.js";

export const executiveDecisionTypes = [
  "coordinate_application_command",
  "coordinate_provisioning",
  "coordinate_agent_runtime",
  "record_operational_request",
  "reject_intent",
] as const;

export type ExecutiveDecisionType = (typeof executiveDecisionTypes)[number];

export const executiveDecisionTargets = [
  "application_layer",
  "provisioning_engine",
  "agent_runtime",
  "executive_director",
] as const;

export type ExecutiveDecisionTarget = (typeof executiveDecisionTargets)[number];

export interface ExecutiveDecision {
  decisionId: string;
  intentId: string;
  intentType: ExecutiveIntentType;
  type: ExecutiveDecisionType;
  target: ExecutiveDecisionTarget;
  action: string;
  status: "created";
  rationale: string;
  createdAt: Date;
  payload?: Readonly<Record<string, unknown>>;
}

export interface DecisionEvaluation {
  intentId: string;
  accepted: boolean;
  reasons: readonly string[];
}

export interface DecisionOutcome {
  decision: ExecutiveDecision;
  evaluation: DecisionEvaluation;
}
