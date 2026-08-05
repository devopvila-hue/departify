import {
  decideRetention,
  MemoryEngineValidationError,
  retentionActions,
  validateMemorySelectionPolicy,
  validateRetentionPolicy,
} from "../src/index.js";

describe("memory policies", () => {
  it("defines retention actions", () => {
    expect(retentionActions).toEqual([
      "retain",
      "expire",
      "archive",
      "consolidate",
    ]);
  });

  it("evaluates abstract retention decisions", () => {
    const policy = {
      expiresAfterDays: 30,
      minimumPriorityToRetain: 50,
      archiveBelowPriority: 20,
      consolidateAfterDays: 7,
    };

    expect(decideRetention(policy, { priority: 80, ageDays: 3 })).toMatchObject(
      {
        action: "retain",
      },
    );
    expect(decideRetention(policy, { priority: 80, ageDays: 8 })).toMatchObject(
      {
        action: "consolidate",
      },
    );
    expect(decideRetention(policy, { priority: 10, ageDays: 2 })).toMatchObject(
      {
        action: "archive",
      },
    );
    expect(
      decideRetention(policy, { priority: 80, ageDays: 30 }),
    ).toMatchObject({
      action: "expire",
    });
  });

  it("validates retention and selection policies", () => {
    expect(() =>
      validateRetentionPolicy({ minimumPriorityToRetain: 101 }),
    ).toThrow(MemoryEngineValidationError);
    expect(() =>
      validateMemorySelectionPolicy({
        kinds: ["working", "semantic"],
        scopes: ["organization", "agent"],
        minPriority: 50,
      }),
    ).not.toThrow();
    expect(() =>
      validateMemorySelectionPolicy({
        kinds: [],
        scopes: ["organization"],
      }),
    ).toThrow(MemoryEngineValidationError);
  });
});
