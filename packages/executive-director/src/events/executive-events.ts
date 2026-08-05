import type {
  ExecutiveDecisionTarget,
  ExecutiveDecisionType,
} from "../decisions/executive-decisions.js";

export const executiveEventTypes = [
  "decision.created",
  "task.assigned",
  "department.requested",
  "agent.requested",
] as const;

export type ExecutiveEventType = (typeof executiveEventTypes)[number];

export interface ExecutiveEvent<TType extends ExecutiveEventType> {
  type: TType;
  decisionId: string;
  intentId: string;
  occurredAt: Date;
}

export interface DecisionCreatedEvent extends ExecutiveEvent<"decision.created"> {
  decisionType: ExecutiveDecisionType;
  target: ExecutiveDecisionTarget;
}

export interface TaskAssignedEvent extends ExecutiveEvent<"task.assigned"> {
  taskId: string;
  title: string;
}

export interface DepartmentRequestedEvent extends ExecutiveEvent<"department.requested"> {
  departmentName: string;
}

export interface AgentRequestedEvent extends ExecutiveEvent<"agent.requested"> {
  agentName: string;
  departmentId: string;
}

export type ExecutiveDirectorEvent =
  | DecisionCreatedEvent
  | TaskAssignedEvent
  | DepartmentRequestedEvent
  | AgentRequestedEvent;
