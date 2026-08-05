import type {
  AgentId,
  AgentRuntimeStatus,
} from "../contracts/agent-contracts.js";

export const agentRuntimeEventTypes = [
  "agent.registered",
  "agent.started",
  "agent.ready",
  "agent.paused",
  "agent.stopped",
  "agent.failed",
  "agent.removed",
] as const;

export type AgentRuntimeEventType = (typeof agentRuntimeEventTypes)[number];

export interface AgentRuntimeEvent<TType extends AgentRuntimeEventType> {
  type: TType;
  agentId: AgentId;
  occurredAt: Date;
}

export interface AgentRegisteredEvent extends AgentRuntimeEvent<"agent.registered"> {
  organizationId: string;
}

export type AgentStartedEvent = AgentRuntimeEvent<"agent.started">;
export type AgentReadyEvent = AgentRuntimeEvent<"agent.ready">;
export type AgentPausedEvent = AgentRuntimeEvent<"agent.paused">;
export type AgentStoppedEvent = AgentRuntimeEvent<"agent.stopped">;

export interface AgentFailedEvent extends AgentRuntimeEvent<"agent.failed"> {
  reason: string;
  previousStatus: AgentRuntimeStatus;
}

export type AgentRemovedEvent = AgentRuntimeEvent<"agent.removed">;

export type AgentRuntimeDomainEvent =
  | AgentRegisteredEvent
  | AgentStartedEvent
  | AgentReadyEvent
  | AgentPausedEvent
  | AgentStoppedEvent
  | AgentFailedEvent
  | AgentRemovedEvent;
