import type {
  DiscoveryReportRepository,
} from "@departify/business-discovery";
import type {
  ToolExecutionContext,
  ToolExecutionErrorEnvelope,
  ToolDefinition,
} from "@departify/tool-runtime";

export interface DiscoverySummaryInput {
  readonly organizationId: string;
}

export interface DiscoverySummaryOutput {
  readonly organizationId: string;
  readonly overallConfidence: "low" | "medium" | "high";
  readonly gapCount: number;
  readonly criticalGapCount: number;
  readonly blockingGapCount: number;
  readonly questionCount: number;
}

export interface DiscoverySummaryToolOptions {
  readonly repository: DiscoveryReportRepository;
}

class DiscoveryReportNotFoundError extends Error {
  readonly envelope: ToolExecutionErrorEnvelope;
  constructor(organizationId: string) {
    super(`No discovery report found for organization '${organizationId}'.`);
    this.name = "DiscoveryReportNotFoundError";
    this.envelope = {
      code: "execution_failed",
      name: this.name,
      message: this.message,
    };
  }
}

/**
 * `discovery.summary` — the first useful result produced by a Digital
 * Employee.
 *
 * Sprint 45: given an organization, read its most recent completed report
 * (Sprint 36) and derive a deterministic executive summary of the business:
 * overall confidence, gap counts (total, critical, blocking) and question
 * count. No IA, no generated text — pure aggregation over the existing
 * report public contract (Sprint 28).
 */
export function createDiscoverySummaryToolDefinition(
  options: DiscoverySummaryToolOptions,
): ToolDefinition<DiscoverySummaryInput, DiscoverySummaryOutput> {
  return {
    id: "discovery.summary",
    version: "1.0.0",
    metadata: {
      displayName: "Discovery Summary",
      description:
        "Derive a deterministic executive summary of the business from the most recent discovery report.",
      tags: ["discovery", "business", "summary"],
    },
    capabilities: ["deterministic", "idempotent", "side_effect_free"],
    requiredScopes: ["read.private"],
    inputSchema: {
      type: "object",
      required: ["organizationId"],
      properties: {
        organizationId: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      required: [
        "organizationId",
        "overallConfidence",
        "gapCount",
        "criticalGapCount",
        "blockingGapCount",
        "questionCount",
      ],
      properties: {
        organizationId: { type: "string" },
        overallConfidence: { type: "string" },
        gapCount: { type: "number" },
        criticalGapCount: { type: "number" },
        blockingGapCount: { type: "number" },
        questionCount: { type: "number" },
      },
      additionalProperties: false,
    },
    limits: { timeoutMs: 1_000 },
    executor: async (
      _context: ToolExecutionContext,
      args: DiscoverySummaryInput,
    ): Promise<DiscoverySummaryOutput> => {
      const records = options.repository.findByOrganizationId(
        args.organizationId,
      );
      if (records.length === 0) {
        throw new DiscoveryReportNotFoundError(args.organizationId);
      }
      const mostRecent = [...records].sort((a, b) =>
        b.savedAt.getTime() - a.savedAt.getTime(),
      )[0];
      if (!mostRecent) {
        throw new DiscoveryReportNotFoundError(args.organizationId);
      }

      const gaps = mostRecent.report.gaps;
      return {
        organizationId: args.organizationId,
        overallConfidence: mostRecent.report.confidence.overall,
        gapCount: gaps.length,
        criticalGapCount: gaps.filter(
          (gap) => gap.importance === "critical",
        ).length,
        blockingGapCount: gaps.filter((gap) => gap.blockingAction).length,
        questionCount: mostRecent.report.questions.length,
      };
    },
  };
}
