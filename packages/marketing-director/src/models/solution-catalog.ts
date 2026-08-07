export interface SolutionEntry {
  readonly toolId: string;
  readonly name: string;
  readonly label: string;
  readonly tier: "free" | "freemium" | "open_source" | "commercial" | "native";
  readonly connectable: boolean;
  readonly fitFor: readonly string[];
}

export interface SolutionCatalog {
  readonly capability: string;
  readonly solutions: readonly SolutionEntry[];
}

export function createSolutionCatalog(
  capability: string,
  solutions: readonly SolutionEntry[],
): SolutionCatalog {
  return { capability, solutions };
}

export function findSolutions(
  catalogs: readonly SolutionCatalog[],
  capability: string,
): readonly SolutionEntry[] {
  const catalog = catalogs.find((c) => c.capability === capability);
  return catalog?.solutions ?? [];
}

export function findBestSolution(
  catalogs: readonly SolutionCatalog[],
  capability: string,
  existingTools: ReadonlySet<string>,
  companySize: string,
): SolutionEntry | null {
  const solutions = findSolutions(catalogs, capability);
  if (solutions.length === 0) return null;

  const existing = solutions.find((s) => existingTools.has(s.toolId));
  if (existing) return existing;

  const isSolo = companySize === "solo yo" || companySize === "solo";
  const isSmall = companySize === "2-10";

  const scored = solutions.map((s) => ({
    solution: s,
    score: solutionScore(s, isSolo, isSmall),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.solution ?? null;
}

function solutionScore(
  solution: SolutionEntry,
  isSolo: boolean,
  isSmall: boolean,
): number {
  let score = 0;
  if (solution.tier === "native") score += 50;
  if (solution.tier === "free") score += 40;
  if (solution.tier === "open_source") score += 35;
  if (solution.tier === "freemium") score += 30;
  if (solution.tier === "commercial") score += 10;

  if (solution.connectable) score += 20;

  if (isSolo && (solution.tier === "free" || solution.tier === "freemium")) {
    score += 15;
  }
  if (isSmall && solution.tier === "free") {
    score += 10;
  }

  return score;
}
