import {
  allowedKnowledgeTransitions,
  knowledgeEventTypes,
  KnowledgeEngineValidationError,
  KnowledgeLifecyclePolicy,
  terminalKnowledgeStatuses,
} from "../src/index.js";

describe("knowledge events and lifecycle", () => {
  it("declares events", () => {
    expect(knowledgeEventTypes).toEqual([
      "knowledge.created",
      "knowledge.indexed",
      "knowledge.updated",
      "knowledge.archived",
      "knowledge.deleted",
    ]);
  });

  it("validates lifecycle transitions", () => {
    const policy = new KnowledgeLifecyclePolicy();

    expect(allowedKnowledgeTransitions.draft).toEqual([
      "active",
      "archived",
      "deleted",
    ]);
    expect(terminalKnowledgeStatuses).toEqual(["deleted"]);
    expect(policy.canTransition("active", "indexed")).toBe(true);
    expect(() => policy.assertTransition("deleted", "active")).toThrow(
      KnowledgeEngineValidationError,
    );
  });
});
