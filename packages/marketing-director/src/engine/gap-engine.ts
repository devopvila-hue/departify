import {
  findBestSolution,
  type SolutionCatalog,
  type SolutionEntry,
} from "../models/solution-catalog.js";
import {
  type MarketingCapabilityGap,
} from "../models/marketing-diagnosis.js";
import { buildRecommendation, type Recommendation } from "../models/recommendation.js";

export interface GapAnalysisResult {
  readonly availableCapabilities: readonly string[];
  readonly unavailableCapabilities: readonly string[];
  readonly recommendations: readonly Recommendation[];
}

export function analyzeCapabilityGaps(
  gaps: readonly MarketingCapabilityGap[],
  solutionCatalogs: readonly SolutionCatalog[],
  connectedTools: readonly string[],
  existingToolIds: ReadonlySet<string>,
  companySize: string,
  locale: string,
): GapAnalysisResult {
  const isEs = locale !== "en";
  const available: string[] = [];
  const unavailable: string[] = [];
  const recommendations: Recommendation[] = [];

  for (const gap of gaps) {
    if (!gap.blocked) {
      available.push(gap.name);
      continue;
    }
    unavailable.push(gap.name);

    if (!gap.toolCapability) continue;

    const best = findBestSolution(
      solutionCatalogs,
      gap.toolCapability,
      existingToolIds,
      companySize,
    );
    if (!best) continue;

    const whyThisSolution = buildWhyThisSolution(best, companySize, isEs);
    const reason = buildGapReason(gap, isEs);

    recommendations.push(
      buildRecommendation(
        gap.toolCapability,
        gap.name,
        reason,
        best,
        whyThisSolution,
      ),
    );
  }

  return { availableCapabilities: available, unavailableCapabilities: unavailable, recommendations };
}

function buildWhyThisSolution(
  solution: SolutionEntry,
  companySize: string,
  isEs: boolean,
): string {
  const isSolo = companySize === "solo yo";
  const isSmall = companySize === "2-10";

  if (solution.tier === "native") {
    return isEs
      ? "Departify puede cubrir esta necesidad directamente."
      : "Departify can cover this need directly.";
  }
  if (solution.tier === "free") {
    return isEs
      ? `Gratuito y suficiente para el momento actual.`
      : `Free and sufficient for the current stage.`;
  }
  if (solution.tier === "freemium") {
    return isEs
      ? `Plan gratuito suficiente para empezar. Puedes escalar cuando necesites más.`
      : `Free plan sufficient to start. You can upgrade when you need more.`;
  }
  if (solution.tier === "open_source") {
    return isEs
      ? `Open-source, sin coste de licencia. Ideal para equipos pequeños que quieren control.`
      : `Open-source, no license cost. Ideal for small teams that want control.`;
  }
  if (isSolo || isSmall) {
    return isEs
      ? `Solución sólida para empresas de tu tamaño.`
      : `Solid solution for companies of your size.`;
  }
  return isEs
    ? `Solución profesional adecuada para tu momento.`
    : `Professional solution appropriate for your stage.`;
}

function buildGapReason(
  gap: MarketingCapabilityGap,
  isEs: boolean,
): string {
  return isEs
    ? `Para ${gap.name.toLowerCase()} necesito conectar ${gap.toolCapability ?? "una herramienta"}.`
    : `To handle ${gap.name.toLowerCase()} I need to connect ${gap.toolCapability ?? "a tool"}.`;
}
