import type { AgentId } from "../contracts/agent-contracts.js";
import { assertRuntimeValid } from "../validation/runtime-error.js";

export type AgentScheduleTrigger =
  | { type: "manual" }
  | { type: "interval"; everySeconds: number }
  | { type: "cron"; expression: string };

export interface AgentScheduledTask {
  id: string;
  agentId: AgentId;
  name: string;
  trigger: AgentScheduleTrigger;
  enabled: boolean;
  payload?: Readonly<Record<string, string>>;
}

export interface AgentSchedulePlan {
  tasks: readonly AgentScheduledTask[];
}

export function validateScheduledTask(
  task: AgentScheduledTask,
): AgentScheduledTask {
  assertRuntimeValid(
    task.id.trim().length > 0,
    "Scheduled task id is required.",
  );
  assertRuntimeValid(
    task.agentId.trim().length > 0,
    "Scheduled task agentId is required.",
  );
  assertRuntimeValid(
    task.name.trim().length > 0,
    "Scheduled task name is required.",
  );

  if (task.trigger.type === "interval") {
    assertRuntimeValid(
      Number.isInteger(task.trigger.everySeconds) &&
        task.trigger.everySeconds > 0,
      "Interval trigger must use a positive integer everySeconds value.",
    );
  }

  if (task.trigger.type === "cron") {
    assertRuntimeValid(
      task.trigger.expression.trim().length > 0,
      "Cron trigger expression is required.",
    );
  }

  return task;
}
