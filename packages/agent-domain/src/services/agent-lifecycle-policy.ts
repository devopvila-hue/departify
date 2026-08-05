import { assertAgentDomainInvariant } from "../validation/domain-error.js";

export const agentStatuses = [
  "created",
  "active",
  "paused",
  "disabled",
  "deleted",
] as const;

export type AgentStatus = (typeof agentStatuses)[number];

export const terminalAgentStatuses = ["deleted"] as const;

export const allowedAgentTransitions: Record<
  AgentStatus,
  readonly AgentStatus[]
> = {
  created: ["active", "disabled", "deleted"],
  active: ["paused", "disabled", "deleted"],
  paused: ["active", "disabled", "deleted"],
  disabled: ["active", "deleted"],
  deleted: [],
};

export class AgentLifecyclePolicy {
  canTransition(from: AgentStatus, to: AgentStatus): boolean {
    return allowedAgentTransitions[from].includes(to);
  }

  assertTransition(from: AgentStatus, to: AgentStatus): void {
    assertAgentDomainInvariant(
      this.canTransition(from, to),
      `Agent cannot transition from ${from} to ${to}.`,
    );
  }
}
