import {
  AgentLifecyclePolicy,
  AgentRegistry,
  AgentRuntimeStateError,
  allowedAgentRuntimeTransitions,
  terminalAgentRuntimeStatuses,
} from "../src/index.js";

describe("agent lifecycle", () => {
  it("validates explicit runtime transitions", () => {
    const policy = new AgentLifecyclePolicy();

    expect(policy.canTransition("registered", "starting")).toBe(true);
    expect(policy.canTransition("starting", "ready")).toBe(true);
    expect(policy.canTransition("ready", "paused")).toBe(true);
    expect(policy.canTransition("paused", "starting")).toBe(true);
    expect(policy.canTransition("ready", "stopping")).toBe(true);
    expect(policy.canTransition("stopping", "stopped")).toBe(true);
    expect(policy.canTransition("ready", "registered")).toBe(false);
  });

  it("prevents invalid lifecycle transitions through registry", () => {
    const registry = new AgentRegistry();
    registry.register({
      id: "agent_lifecycle_001",
      organizationId: "org_departify01",
      displayName: "Lifecycle Agent",
      role: "operations",
    });

    expect(() => registry.markReady("agent_lifecycle_001")).toThrow(
      AgentRuntimeStateError,
    );
  });

  it("documents terminal state transitions", () => {
    for (const status of terminalAgentRuntimeStatuses) {
      expect(allowedAgentRuntimeTransitions[status]).toEqual(["starting"]);
    }
  });
});
