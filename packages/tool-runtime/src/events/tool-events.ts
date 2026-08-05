import type {
  ToolAgentId,
  ToolExecutionErrorEnvelope,
  ToolId,
  ToolOrganizationId,
  ToolRequestId,
} from "../contracts/tool-contracts.js";

/**
 * Tool Runtime internal event taxonomy.
 *
 * Events are pure data. The Runtime emits them through a
 * `ToolEventPublisher`; subscribers decide whether to persist, forward or
 * drop them. Sprint 20 does not bind the publisher to any transport.
 */
export const toolEventKinds = [
  "tool.registered",
  "tool.unregistered",
  "tool.requested",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "tool.cancelled",
] as const;

export type ToolEventKind = (typeof toolEventKinds)[number];

export interface ToolEventBase {
  readonly kind: ToolEventKind;
  readonly occurredAt: string;
  readonly requestId?: ToolRequestId;
  readonly toolId?: ToolId;
  readonly agentId?: ToolAgentId;
  readonly organizationId?: ToolOrganizationId;
}

export interface ToolRegisteredEvent extends ToolEventBase {
  readonly kind: "tool.registered";
  readonly toolId: ToolId;
  readonly version: string;
}

export interface ToolUnregisteredEvent extends ToolEventBase {
  readonly kind: "tool.unregistered";
  readonly toolId: ToolId;
}

export interface ToolRequestedEvent extends ToolEventBase {
  readonly kind: "tool.requested";
  readonly requestId: ToolRequestId;
  readonly toolId: ToolId;
}

export interface ToolStartedEvent extends ToolEventBase {
  readonly kind: "tool.started";
  readonly requestId: ToolRequestId;
  readonly toolId: ToolId;
}

export interface ToolCompletedEvent extends ToolEventBase {
  readonly kind: "tool.completed";
  readonly requestId: ToolRequestId;
  readonly toolId: ToolId;
  readonly durationMs: number;
}

export interface ToolFailedEvent extends ToolEventBase {
  readonly kind: "tool.failed";
  readonly requestId: ToolRequestId;
  readonly toolId: ToolId;
  readonly durationMs: number;
  readonly error: ToolExecutionErrorEnvelope;
}

export interface ToolCancelledEvent extends ToolEventBase {
  readonly kind: "tool.cancelled";
  readonly requestId: ToolRequestId;
  readonly toolId: ToolId;
  readonly durationMs: number;
}

export type ToolEvent =
  | ToolRegisteredEvent
  | ToolUnregisteredEvent
  | ToolRequestedEvent
  | ToolStartedEvent
  | ToolCompletedEvent
  | ToolFailedEvent
  | ToolCancelledEvent;

export interface ToolEventPublisher {
  publish(event: ToolEvent): void;
}

export class InMemoryToolEventPublisher implements ToolEventPublisher {
  private readonly recorded: ToolEvent[] = [];

  publish(event: ToolEvent): void {
    this.recorded.push(event);
  }

  history(): readonly ToolEvent[] {
    return [...this.recorded];
  }

  filter(kind: ToolEventKind): readonly ToolEvent[] {
    return this.recorded.filter((event) => event.kind === kind);
  }

  reset(): void {
    this.recorded.length = 0;
  }
}

/**
 * No-op publisher. Used by default when no publisher is supplied to the
 * pipeline; tests inject the in-memory publisher.
 */
export class NoopToolEventPublisher implements ToolEventPublisher {
  publish(): void {}
}

export function nowIso(): string {
  return new Date().toISOString();
}
