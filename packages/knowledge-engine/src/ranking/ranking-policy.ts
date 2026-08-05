import { assertKnowledgeValid } from "../validation/knowledge-error.js";

export const rankingSignals = [
  "source_priority",
  "freshness",
  "authority",
  "manual_boost",
] as const;

export type RankingSignal = (typeof rankingSignals)[number];

export interface KnowledgeRankingPolicy {
  signals: readonly RankingSignal[];
  requireDeterministicOrder: boolean;
}

export function validateKnowledgeRankingPolicy(
  policy: KnowledgeRankingPolicy,
): void {
  assertKnowledgeValid(
    policy.signals.length > 0,
    "Ranking policy requires at least one signal.",
  );
  assertKnowledgeValid(
    new Set(policy.signals).size === policy.signals.length,
    "Ranking policy cannot contain duplicate signals.",
  );
  policy.signals.forEach((signal) => {
    assertKnowledgeValid(
      rankingSignals.includes(signal),
      "Ranking signal is invalid.",
    );
  });
}
