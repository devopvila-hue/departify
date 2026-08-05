import type { AgentRuntimeStatus } from "../contracts/agent-contracts.js";
import { AgentRuntimeStateError } from "../validation/runtime-error.js";

export const agentRuntimeStatuses = [
  "registered",
  "starting",
  "ready",
  "paused",
  "stopping",
  "stopped",
  "failed",
] as const satisfies readonly AgentRuntimeStatus[];

export const terminalAgentRuntimeStatuses = ["stopped"] as const;

export const allowedAgentRuntimeTransitions: Record<
  AgentRuntimeStatus,
  readonly AgentRuntimeStatus[]
> = {
  registered: ["starting", "stopped"],
  starting: ["ready", "stopping", "failed"],
  ready: ["paused", "stopping", "failed"],
  paused: ["starting", "stopping"],
  stopping: ["stopped", "failed"],
  stopped: ["starting"],
  failed: ["starting", "stopped"],
};

export class AgentLifecyclePolicy {
  canTransition(from: AgentRuntimeStatus, to: AgentRuntimeStatus): boolean {
    return allowedAgentRuntimeTransitions[from].includes(to);
  }

  assertTransition(from: AgentRuntimeStatus, to: AgentRuntimeStatus): void {
    if (!this.canTransition(from, to)) {
      throw new AgentRuntimeStateError(
        `Agent cannot transition from ${from} to ${to}.`,
      );
    }
  }
}
