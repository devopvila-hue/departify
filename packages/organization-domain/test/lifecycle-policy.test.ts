import {
  allowedOrganizationTransitions,
  DomainInvariantError,
  OrganizationLifecyclePolicy,
  terminalOrganizationStatuses,
} from "../src/index.js";

describe("OrganizationLifecyclePolicy", () => {
  it("defines explicit creation, activation, suspension, archival, and deletion paths", () => {
    const policy = new OrganizationLifecyclePolicy();

    expect(policy.canTransition("requested", "created")).toBe(true);
    expect(policy.canTransition("created", "active")).toBe(true);
    expect(policy.canTransition("active", "suspended")).toBe(true);
    expect(policy.canTransition("suspended", "active")).toBe(true);
    expect(policy.canTransition("active", "archived")).toBe(true);
    expect(policy.canTransition("archived", "deleted")).toBe(true);
  });

  it("prevents terminal state transitions", () => {
    for (const state of terminalOrganizationStatuses) {
      expect(allowedOrganizationTransitions[state]).toEqual([]);
    }
  });

  it("throws for unsupported transitions", () => {
    const policy = new OrganizationLifecyclePolicy();

    expect(() => policy.assertTransition("requested", "active")).toThrow(
      DomainInvariantError,
    );
  });
});
