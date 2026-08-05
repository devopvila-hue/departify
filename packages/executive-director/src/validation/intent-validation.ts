import type { ExecutiveIntent } from "../intents/executive-intents.js";
import { executiveIntentTypes } from "../intents/executive-intents.js";
import { assertDirectorValid } from "./director-error.js";

export interface IntentValidationResult {
  valid: boolean;
  errors: readonly string[];
}

export function validateExecutiveIntent(
  intent: ExecutiveIntent,
): IntentValidationResult {
  const errors: string[] = [];
  collectBaseErrors(intent, errors);

  switch (intent.type) {
    case "create_organization":
      collectTextError(intent.organizationName, "organizationName", errors);
      break;
    case "activate_organization":
    case "resume_organization":
      collectTextError(intent.organizationId, "organizationId", errors);
      break;
    case "pause_organization":
      collectTextError(intent.organizationId, "organizationId", errors);
      collectReasonError(intent.reason, errors);
      break;
    case "assign_task":
      collectTextError(intent.organizationId, "organizationId", errors);
      collectTextError(intent.taskId, "taskId", errors);
      collectTextError(intent.title, "title", errors);
      if (!intent.targetAgentId && !intent.targetDepartmentId) {
        errors.push("AssignTask requires a target agent or department.");
      }
      break;
    case "request_department":
      collectTextError(intent.organizationId, "organizationId", errors);
      collectTextError(intent.departmentName, "departmentName", errors);
      collectReasonError(intent.purpose, errors);
      break;
    case "request_agent":
      collectTextError(intent.organizationId, "organizationId", errors);
      collectTextError(intent.departmentId, "departmentId", errors);
      collectTextError(intent.agentName, "agentName", errors);
      collectTextError(intent.agentRole, "agentRole", errors);
      break;
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function assertExecutiveIntentValid(intent: ExecutiveIntent): void {
  const result = validateExecutiveIntent(intent);
  assertDirectorValid(result.valid, result.errors.join(" "));
}

function collectBaseErrors(intent: ExecutiveIntent, errors: string[]): void {
  if (!executiveIntentTypes.includes(intent.type)) {
    errors.push("Intent type is invalid.");
  }
  collectTextError(intent.intentId, "intentId", errors);
  collectTextError(intent.requestedBy, "requestedBy", errors);
}

function collectTextError(
  value: string | undefined,
  field: string,
  errors: string[],
): void {
  if (!value || value.trim().length < 2) {
    errors.push(`${field} must contain at least 2 characters.`);
  }
}

function collectReasonError(value: string, errors: string[]): void {
  if (value.trim().length < 3 || value.trim().length > 240) {
    errors.push("Reason or purpose must be between 3 and 240 characters.");
  }
}
