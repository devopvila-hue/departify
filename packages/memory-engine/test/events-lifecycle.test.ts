import {
  allowedMemoryTransitions,
  MemoryEngineValidationError,
  memoryEventTypes,
  MemoryLifecyclePolicy,
  terminalMemoryStatuses,
} from "../src/index.js";

describe("events and lifecycle", () => {
  it("declares memory events", () => {
    expect(memoryEventTypes).toEqual([
      "memory.created",
      "memory.updated",
      "memory.archived",
      "memory.expired",
      "memory.deleted",
    ]);
  });

  it("validates lifecycle transitions", () => {
    const policy = new MemoryLifecyclePolicy();

    expect(allowedMemoryTransitions.active).toEqual([
      "archived",
      "expired",
      "deleted",
    ]);
    expect(terminalMemoryStatuses).toEqual(["deleted"]);
    expect(policy.canTransition("archived", "active")).toBe(true);
    expect(() => policy.assertTransition("deleted", "active")).toThrow(
      MemoryEngineValidationError,
    );
  });
});
