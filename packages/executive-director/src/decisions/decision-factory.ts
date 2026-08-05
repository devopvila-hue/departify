import type {
  ExecutiveDecision,
  ExecutiveDecisionTarget,
  ExecutiveDecisionType,
} from "./executive-decisions.js";
import type { ExecutiveIntent } from "../intents/executive-intents.js";
import { assertDirectorValid } from "../validation/director-error.js";

export interface CreateDecisionInput {
  intent: ExecutiveIntent;
  type: ExecutiveDecisionType;
  target: ExecutiveDecisionTarget;
  action: string;
  rationale: string;
  createdAt?: Date;
  payload?: Readonly<Record<string, unknown>>;
}

export function createExecutiveDecision(
  input: CreateDecisionInput,
): ExecutiveDecision {
  const action = input.action.trim();
  const rationale = input.rationale.trim();
  assertDirectorValid(action.length >= 3, "Decision action is required.");
  assertDirectorValid(rationale.length >= 3, "Decision rationale is required.");

  const decision: ExecutiveDecision = {
    decisionId: `dec_${input.intent.intentId}`,
    intentId: input.intent.intentId,
    intentType: input.intent.type,
    type: input.type,
    target: input.target,
    action,
    status: "created",
    rationale,
    createdAt: input.createdAt ?? new Date(),
  };

  if (input.payload) {
    return {
      ...decision,
      payload: input.payload,
    };
  }

  return decision;
}
