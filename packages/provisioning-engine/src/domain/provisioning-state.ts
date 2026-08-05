export const provisioningStates = [
  "idle",
  "requested",
  "validating",
  "planning",
  "in_progress",
  "retrying",
  "recovering",
  "canceling",
  "canceled",
  "failed",
  "completed",
] as const;

export type ProvisioningState = (typeof provisioningStates)[number];

export const terminalProvisioningStates = ["canceled", "completed"] as const;

export const allowedProvisioningTransitions: Record<
  ProvisioningState,
  readonly ProvisioningState[]
> = {
  idle: ["requested"],
  requested: ["validating", "canceling"],
  validating: ["planning", "failed", "canceling"],
  planning: ["in_progress", "failed", "canceling"],
  in_progress: ["retrying", "recovering", "canceling", "failed", "completed"],
  retrying: ["in_progress", "recovering", "failed", "canceling"],
  recovering: ["in_progress", "failed", "canceling"],
  canceling: ["canceled", "failed"],
  canceled: [],
  failed: ["recovering"],
  completed: [],
};

export function canTransitionProvisioningState(
  from: ProvisioningState,
  to: ProvisioningState,
): boolean {
  return allowedProvisioningTransitions[from].includes(to);
}
