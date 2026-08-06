import type {
  CompanyDNA,
  DiscoveryQuestion,
  FounderBrain,
  GapAnalysisResult,
} from "@departify/business-discovery";
import {
  analyzeGaps,
  generateQuestions,
  getCompletenessSummary,
  meetsMinimumRequirements,
} from "@departify/business-discovery";
import type {
  ToolExecutionContext,
  ToolDefinition,
} from "@departify/tool-runtime";

export interface DiscoveryAnalyzeInput {
  readonly companyDna: CompanyDNA;
  readonly founderBrain?: FounderBrain;
  readonly options?: {
    readonly maxQuestionsPerGap?: number;
    readonly includeLowPriority?: boolean;
    readonly maxTotalQuestions?: number;
  };
}

export interface DiscoveryAnalyzeOutput {
  readonly gaps: GapAnalysisResult;
  readonly questions: readonly DiscoveryQuestion[];
  readonly completeness: {
    readonly companyDna: number;
    readonly founderBrain: number;
    readonly overall: number;
  };
  readonly meetsMinimumRequirements: boolean;
}

/**
 * `discovery.analyze` — run the deterministic Business Discovery analysis
 * over a supplied Company DNA (and optional Founder Brain).
 *
 * The Tool delegates entirely to the public contracts of
 * `@departify/business-discovery`: `analyzeGaps`, `generateQuestions`,
 * `getCompletenessSummary` and `meetsMinimumRequirements`. It duplicates no
 * domain logic. No AI, no LLM Router, no HTTP, no SDKs.
 */
export function createDiscoveryAnalyzeToolDefinition(): ToolDefinition<
  DiscoveryAnalyzeInput,
  DiscoveryAnalyzeOutput
> {
  return {
    id: "discovery.analyze",
    version: "1.0.0",
    metadata: {
      displayName: "Discovery Analyze",
      description:
        "Run deterministic Gap Analysis and Question Generation over Company DNA (and optional Founder Brain) to identify missing business information.",
      tags: ["discovery", "analysis", "business"],
    },
    capabilities: ["deterministic", "idempotent", "side_effect_free"],
    requiredScopes: ["read.private"],
    inputSchema: {
      type: "object",
      required: ["companyDna"],
      properties: {
        companyDna: { type: "object", additionalProperties: true },
        founderBrain: { type: "object", additionalProperties: true },
        options: {
          type: "object",
          additionalProperties: false,
          properties: {
            maxQuestionsPerGap: { type: "number", minimum: 1 },
            includeLowPriority: { type: "boolean" },
            maxTotalQuestions: { type: "number", minimum: 1 },
          },
        },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      required: ["gaps", "questions", "completeness", "meetsMinimumRequirements"],
      properties: {
        gaps: { type: "object" },
        questions: { type: "array" },
        completeness: { type: "object" },
        meetsMinimumRequirements: { type: "boolean" },
      },
      additionalProperties: false,
    },
    limits: { timeoutMs: 1_000 },
    executor: async (
      _context: ToolExecutionContext,
      args: DiscoveryAnalyzeInput,
    ): Promise<DiscoveryAnalyzeOutput> => {
      const gaps = analyzeGaps(args.companyDna, args.founderBrain);
      const questions = generateQuestions(gaps, args.options ?? {});
      const completeness = getCompletenessSummary(gaps);

      return {
        gaps,
        questions,
        completeness,
        meetsMinimumRequirements: meetsMinimumRequirements(gaps),
      };
    },
  };
}
