import type { SolutionEntry } from "./solution-catalog.js";

export interface Recommendation {
  readonly capability: string;
  readonly capabilityName: string;
  readonly reason: string;
  readonly solution: SolutionEntry;
  readonly tier: string;
  readonly whyThisSolution: string;
}

export interface ConnectionReason {
  readonly toolId: string;
  readonly toolName: string;
  readonly reason: string;
  readonly capability: string;
  readonly whatItUnblocks: readonly string[];
}

export function buildRecommendation(
  capability: string,
  capabilityName: string,
  reason: string,
  solution: SolutionEntry,
  whyThisSolution: string,
): Recommendation {
  return {
    capability,
    capabilityName,
    reason,
    solution,
    tier: solution.tier,
    whyThisSolution,
  };
}

export function buildConnectionReason(
  toolId: string,
  toolName: string,
  reason: string,
  capability: string,
  whatItUnblocks: readonly string[],
): ConnectionReason {
  return { toolId, toolName, reason, capability, whatItUnblocks };
}
