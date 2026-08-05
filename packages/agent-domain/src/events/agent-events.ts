export const agentEventTypes = [
  "agent.created",
  "agent.activated",
  "agent.paused",
  "agent.resumed",
  "agent.disabled",
  "agent.deleted",
] as const;

export type AgentEventType = (typeof agentEventTypes)[number];

export interface AgentEvent<TType extends AgentEventType = AgentEventType> {
  type: TType;
  agentId: string;
  occurredAt: Date;
}

export interface AgentCreatedEvent extends AgentEvent<"agent.created"> {
  agentName: string;
  departmentId: string;
}

export type AgentActivatedEvent = AgentEvent<"agent.activated">;
export type AgentPausedEvent = AgentEvent<"agent.paused">;
export type AgentResumedEvent = AgentEvent<"agent.resumed">;

export interface AgentDisabledEvent extends AgentEvent<"agent.disabled"> {
  reason: string;
}

export interface AgentDeletedEvent extends AgentEvent<"agent.deleted"> {
  reason: string;
}

export type AgentDomainEvent =
  | AgentCreatedEvent
  | AgentActivatedEvent
  | AgentPausedEvent
  | AgentResumedEvent
  | AgentDisabledEvent
  | AgentDeletedEvent;
