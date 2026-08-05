import type { ExecutiveDecision } from "../decisions/executive-decisions.js";
import type { ExecutiveDirectorEvent } from "./executive-events.js";
import type { ExecutiveIntent } from "../intents/executive-intents.js";

export function createExecutiveEvents(
  intent: ExecutiveIntent,
  decision: ExecutiveDecision,
): readonly ExecutiveDirectorEvent[] {
  const events: ExecutiveDirectorEvent[] = [
    {
      type: "decision.created",
      decisionId: decision.decisionId,
      intentId: intent.intentId,
      decisionType: decision.type,
      target: decision.target,
      occurredAt: decision.createdAt,
    },
  ];

  if (intent.type === "assign_task") {
    events.push({
      type: "task.assigned",
      decisionId: decision.decisionId,
      intentId: intent.intentId,
      taskId: intent.taskId,
      title: intent.title,
      occurredAt: decision.createdAt,
    });
  }

  if (intent.type === "request_department") {
    events.push({
      type: "department.requested",
      decisionId: decision.decisionId,
      intentId: intent.intentId,
      departmentName: intent.departmentName,
      occurredAt: decision.createdAt,
    });
  }

  if (intent.type === "request_agent") {
    events.push({
      type: "agent.requested",
      decisionId: decision.decisionId,
      intentId: intent.intentId,
      agentName: intent.agentName,
      departmentId: intent.departmentId,
      occurredAt: decision.createdAt,
    });
  }

  return events;
}
