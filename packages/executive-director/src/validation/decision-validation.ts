import type { ExecutiveDecision } from "../decisions/executive-decisions.js";
import {
  executiveDecisionTargets,
  executiveDecisionTypes,
} from "../decisions/executive-decisions.js";
import { assertDirectorValid } from "./director-error.js";

export function assertExecutiveDecisionValid(
  decision: ExecutiveDecision,
): void {
  assertDirectorValid(
    decision.decisionId.trim().length >= 2,
    "Decision id is required.",
  );
  assertDirectorValid(
    decision.intentId.trim().length >= 2,
    "Decision intentId is required.",
  );
  assertDirectorValid(
    executiveDecisionTypes.includes(decision.type),
    "Decision type is invalid.",
  );
  assertDirectorValid(
    executiveDecisionTargets.includes(decision.target),
    "Decision target is invalid.",
  );
  assertDirectorValid(
    decision.action.trim().length >= 3,
    "Decision action is required.",
  );
  assertDirectorValid(
    decision.rationale.trim().length >= 3,
    "Decision rationale is required.",
  );
  assertDirectorValid(
    decision.status === "created",
    "Decision status must be created.",
  );
}
