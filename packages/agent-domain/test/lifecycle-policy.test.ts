import {
  AgentDomainInvariantError,
  AgentLifecyclePolicy,
  allowedAgentTransitions,
  terminalAgentStatuses,
} from "../src/index.js";

describe("AgentLifecyclePolicy", () => {
  it("declares explicit allowed transitions", () => {
    expect(allowedAgentTransitions.created).toEqual([
      "active",
      "disabled",
      "deleted",
    ]);
    expect(allowedAgentTransitions.deleted).toEqual([]);
    expect(terminalAgentStatuses).toEqual(["deleted"]);
  });

  it("allows valid transitions", () => {
    const policy = new AgentLifecyclePolicy();

    expect(policy.canTransition("created", "active")).toBe(true);
    expect(policy.canTransition("active", "paused")).toBe(true);
    expect(policy.canTransition("paused", "active")).toBe(true);
    expect(policy.canTransition("disabled", "active")).toBe(true);
  });

  it("rejects invalid transitions", () => {
    const policy = new AgentLifecyclePolicy();

    expect(policy.canTransition("created", "paused")).toBe(false);
    expect(() => policy.assertTransition("deleted", "active")).toThrow(
      AgentDomainInvariantError,
    );
  });
});
