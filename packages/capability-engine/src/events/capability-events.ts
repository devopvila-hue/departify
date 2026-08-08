/**
 * Capability observability events — Sprint 62.
 *
 * Structured operational events the portal can later render truthfully
 * ("Consultando Mautic...", "Elvira está analizando los contactos..."). These
 * are real runtime facts, never fake UI progress.
 */

import type { CapabilityStatus } from "../contracts/capability-contract.js";

export type CapabilityEventKind =
  | "capability.required"
  | "capability.resolved"
  | "capability.unavailable"
  | "capability.validation.started"
  | "capability.validation.completed"
  | "tool.execution.started"
  | "tool.execution.completed";

export interface CapabilityEvent {
  readonly kind: CapabilityEventKind;
  readonly occurredAt: Date;
  readonly department?: string;
  readonly capabilityId?: string;
  readonly toolId?: string;
  readonly status?: CapabilityStatus;
  readonly ok?: boolean;
  readonly reason?: string;
  readonly durationMs?: number;
}

export interface CapabilityEventPublisher {
  publish(event: CapabilityEvent): void;
}

export class InMemoryCapabilityEventPublisher implements CapabilityEventPublisher {
  private readonly events: CapabilityEvent[] = [];

  publish(event: CapabilityEvent): void {
    this.events.push(event);
  }

  history(): readonly CapabilityEvent[] {
    return [...this.events];
  }

  filter(kind: CapabilityEventKind): readonly CapabilityEvent[] {
    return this.events.filter((event) => event.kind === kind);
  }

  reset(): void {
    this.events.length = 0;
  }
}

export class NoopCapabilityEventPublisher implements CapabilityEventPublisher {
  publish(): void {}
}
