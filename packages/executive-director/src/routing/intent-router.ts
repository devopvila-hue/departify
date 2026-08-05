import type {
  ExecutiveDecisionTarget,
  ExecutiveDecisionType,
} from "../decisions/executive-decisions.js";
import type { ExecutiveIntent } from "../intents/executive-intents.js";

export interface IntentRoute {
  decisionType: ExecutiveDecisionType;
  target: ExecutiveDecisionTarget;
  action: string;
  rationale: string;
}

export function routeExecutiveIntent(intent: ExecutiveIntent): IntentRoute {
  switch (intent.type) {
    case "create_organization":
      return {
        decisionType: "coordinate_provisioning",
        target: "provisioning_engine",
        action: "prepare_organization_provisioning",
        rationale:
          "Organization creation must be coordinated through provisioning.",
      };
    case "activate_organization":
    case "pause_organization":
    case "resume_organization":
      return {
        decisionType: "coordinate_application_command",
        target: "application_layer",
        action: intent.type,
        rationale:
          "Organization lifecycle changes are application coordination concerns.",
      };
    case "assign_task":
      return {
        decisionType: "coordinate_agent_runtime",
        target: "agent_runtime",
        action: "prepare_task_assignment",
        rationale:
          "Task assignment is routed to runtime coordination contracts.",
      };
    case "request_department":
      return {
        decisionType: "record_operational_request",
        target: "executive_director",
        action: "record_department_request",
        rationale:
          "Department creation is only modeled as an operational request.",
      };
    case "request_agent":
      return {
        decisionType: "record_operational_request",
        target: "executive_director",
        action: "record_agent_request",
        rationale: "Agent creation is only modeled as an operational request.",
      };
  }
}
