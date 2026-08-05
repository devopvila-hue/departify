import {
  allowedProvisioningTransitions,
  canTransitionProvisioningState,
  terminalProvisioningStates,
} from "../src/index.js";

describe("provisioning state model", () => {
  it("supports explicit progress, retry, recovery, cancellation, completion, and error paths", () => {
    expect(canTransitionProvisioningState("idle", "requested")).toBe(true);
    expect(canTransitionProvisioningState("in_progress", "retrying")).toBe(
      true,
    );
    expect(canTransitionProvisioningState("retrying", "recovering")).toBe(true);
    expect(canTransitionProvisioningState("in_progress", "canceling")).toBe(
      true,
    );
    expect(canTransitionProvisioningState("canceling", "canceled")).toBe(true);
    expect(canTransitionProvisioningState("in_progress", "completed")).toBe(
      true,
    );
    expect(canTransitionProvisioningState("in_progress", "failed")).toBe(true);
  });

  it("prevents implicit transitions from terminal states", () => {
    for (const state of terminalProvisioningStates) {
      expect(allowedProvisioningTransitions[state]).toEqual([]);
    }
  });
});
