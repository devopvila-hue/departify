import type {
  DecisionOutcome,
  ExecutiveDecision,
} from "../decisions/executive-decisions.js";
import { createExecutiveDecision } from "../decisions/decision-factory.js";
import type { ExecutiveDirectorEvent } from "../events/executive-events.js";
import { createExecutiveEvents } from "../events/event-factory.js";
import type { ExecutiveIntent } from "../intents/executive-intents.js";
import {
  createExecutivePlan,
  type ExecutivePlan,
} from "../planning/executive-plan.js";
import { routeExecutiveIntent } from "../routing/intent-router.js";
import { assertExecutiveDecisionValid } from "../validation/decision-validation.js";
import { validateExecutiveIntent } from "../validation/intent-validation.js";

export interface ExecutiveDirectorResult {
  outcome: DecisionOutcome;
  plan: ExecutivePlan;
  events: readonly ExecutiveDirectorEvent[];
}

export class ExecutiveDirector {
  evaluate(
    intent: ExecutiveIntent,
    createdAt = new Date(),
  ): ExecutiveDirectorResult {
    const validation = validateExecutiveIntent(intent);
    const decision = validation.valid
      ? createAcceptedDecision(intent, createdAt)
      : createRejectedDecision(intent, validation.errors, createdAt);

    assertExecutiveDecisionValid(decision);

    return {
      outcome: {
        decision,
        evaluation: {
          intentId: intent.intentId,
          accepted: validation.valid,
          reasons: validation.valid ? ["Intent accepted."] : validation.errors,
        },
      },
      plan: createExecutivePlan(intent, decision),
      events: createExecutiveEvents(intent, decision),
    };
  }
}

function createAcceptedDecision(
  intent: ExecutiveIntent,
  createdAt: Date,
): ExecutiveDecision {
  const route = routeExecutiveIntent(intent);
  return createExecutiveDecision({
    intent,
    type: route.decisionType,
    target: route.target,
    action: route.action,
    rationale: route.rationale,
    createdAt,
    payload: buildPayload(intent),
  });
}

function createRejectedDecision(
  intent: ExecutiveIntent,
  errors: readonly string[],
  createdAt: Date,
): ExecutiveDecision {
  return createExecutiveDecision({
    intent,
    type: "reject_intent",
    target: "executive_director",
    action: "reject_intent",
    rationale: errors.join(" "),
    createdAt,
  });
}

function buildPayload(
  intent: ExecutiveIntent,
): Readonly<Record<string, unknown>> {
  const { occurredAt, metadata, requestedBy, ...payload } = intent;
  return {
    ...payload,
    requestedBy,
    metadata,
    occurredAt,
  };
}
