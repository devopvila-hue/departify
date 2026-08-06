import type {
  DiscoveryQuestion,
  DiscoveryReportRepository,
} from "@departify/business-discovery";
import type {
  ToolExecutionContext,
  ToolExecutionErrorEnvelope,
  ToolDefinition,
} from "@departify/tool-runtime";

export interface DiscoveryPlanInput {
  readonly organizationId: string;
  /**
   * Optional cap on the number of plan items. Defaults to all questions.
   */
  readonly maxItems?: number;
}

export interface DiscoveryPlanItem {
  readonly questionId: string;
  readonly category: DiscoveryQuestion["category"];
  readonly importance: DiscoveryQuestion["importance"];
  readonly priority: number;
  readonly question: string;
}

export interface DiscoveryPlanOutput {
  readonly organizationId: string;
  /**
   * The first work plan of the Department: the discovery questions of the
   * most recent report, ordered by priority (highest first).
   */
  readonly items: readonly DiscoveryPlanItem[];
}

export interface DiscoveryPlanToolOptions {
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
 * `discovery.plan` — the first automatic Department planning decision.
 *
 * Sprint 42: given an organization, read its most recent completed report
 * (Sprint 36) and build a deterministic work plan for the Department: the
 * discovery questions, ordered by priority (highest first). This is the
 * first work the Department should execute to close the gaps of the
 * business. No IA, no generated text — pure ordering over the existing
 * `DiscoveryQuestion` public contract (Sprint 28).
 */
export function createDiscoveryPlanToolDefinition(
  options: DiscoveryPlanToolOptions,
): ToolDefinition<DiscoveryPlanInput, DiscoveryPlanOutput> {
  return {
    id: "discovery.plan",
    version: "1.0.0",
    metadata: {
      displayName: "Discovery Plan",
      description:
        "Build the first work plan of the Department from the discovery questions of the most recent report.",
      tags: ["discovery", "business", "planning"],
    },
    capabilities: ["deterministic", "idempotent", "side_effect_free"],
    requiredScopes: ["read.private"],
    inputSchema: {
      type: "object",
      required: ["organizationId"],
      properties: {
        organizationId: { type: "string", minLength: 1 },
        maxItems: { type: "number", minimum: 1 },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      required: ["organizationId", "items"],
      properties: {
        organizationId: { type: "string" },
        items: { type: "array" },
      },
      additionalProperties: false,
    },
    limits: { timeoutMs: 1_000 },
    executor: async (
      _context: ToolExecutionContext,
      args: DiscoveryPlanInput,
    ): Promise<DiscoveryPlanOutput> => {
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

      const ordered = [...mostRecent.report.questions].sort((a, b) => {
        const priorityDiff = b.priority - a.priority;
        if (priorityDiff !== 0) return priorityDiff;
        return a.id.localeCompare(b.id);
      });

      const items: DiscoveryPlanItem[] = ordered.map((question) => ({
        questionId: question.id,
        category: question.category,
        importance: question.importance,
        priority: question.priority,
        question: question.question,
      }));

      const limited =
        args.maxItems !== undefined
          ? items.slice(0, args.maxItems)
          : items;

      return {
        organizationId: args.organizationId,
        items: limited,
      };
    },
  };
}
