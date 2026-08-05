import {
  createIndexingPlan,
  indexingStatuses,
  KnowledgeEngineValidationError,
  rankingSignals,
  validateKnowledgeRankingPolicy,
  validateKnowledgeSelectionPolicy,
} from "../src/index.js";

describe("indexing, ranking, and policies", () => {
  it("models abstract indexing plans", () => {
    expect(indexingStatuses).toEqual(["planned", "ready", "failed"]);
    expect(
      createIndexingPlan({
        id: "kidx_onboarding001",
        documentId: "kdoc_onboarding001",
        contentType: "markdown",
        chunkCount: 1,
        status: "planned",
      }),
    ).toMatchObject({ status: "planned" });
  });

  it("validates ranking policies", () => {
    expect(rankingSignals).toEqual([
      "source_priority",
      "freshness",
      "authority",
      "manual_boost",
    ]);
    expect(() =>
      validateKnowledgeRankingPolicy({
        signals: ["freshness", "authority"],
        requireDeterministicOrder: true,
      }),
    ).not.toThrow();
    expect(() =>
      validateKnowledgeRankingPolicy({
        signals: [],
        requireDeterministicOrder: true,
      }),
    ).toThrow(KnowledgeEngineValidationError);
  });

  it("validates selection policies", () => {
    expect(() =>
      validateKnowledgeSelectionPolicy({
        scopes: ["organization"],
        contentTypes: ["markdown"],
        includeArchived: false,
      }),
    ).not.toThrow();
    expect(() =>
      validateKnowledgeSelectionPolicy({
        scopes: [],
        contentTypes: ["markdown"],
        includeArchived: false,
      }),
    ).toThrow(KnowledgeEngineValidationError);
  });
});
