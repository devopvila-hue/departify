import type {
  DiscoveryGap,
  DiscoveryReportRepository,
} from "@departify/business-discovery";
import type {
  ToolExecutionContext,
  ToolExecutionErrorEnvelope,
  ToolDefinition,
} from "@departify/tool-runtime";

export interface DiscoveryReadinessInput {
  readonly organizationId: string;
}

export interface DiscoveryReadinessOutput {
  /**
   * Whether the Empresa Digital is ready to operate: no blocking gaps in
   * the most recent Business Discovery report.
   */
  readonly ready: boolean;
  readonly blockingGaps: readonly DiscoveryGap[];
  readonly criticalGaps: readonly DiscoveryGap[];
}

export interface DiscoveryReadinessToolOptions {
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
 * `discovery.readiness` — the first automatic decision a Digital Employee
 * takes from the Business Briefing (Sprint 40).
 *
 * Sprint 41: given an organization, read its most recent completed report
 * from the repository (Sprint 36) and decide, with deterministic rules, whether
 * the Empresa Digital is ready to operate. A report with blocking gaps means
 * critical information is missing and operations should not start yet. The
 * decision is fully auditable: the tool returns the blocking and critical gaps
 * that produced it. No IA, no generated text, no HTTP, no SDKs.
 */
export function createDiscoveryReadinessToolDefinition(
  options: DiscoveryReadinessToolOptions,
): ToolDefinition<DiscoveryReadinessInput, DiscoveryReadinessOutput> {
  return {
    id: "discovery.readiness",
    version: "1.0.0",
    metadata: {
      displayName: "Discovery Readiness",
      description:
        "Decide whether the Empresa Digital is ready to operate based on the most recent Business Discovery report.",
      tags: ["discovery", "business", "decision"],
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
      required: ["ready", "blockingGaps", "criticalGaps"],
      properties: {
        ready: { type: "boolean" },
        blockingGaps: { type: "array" },
        criticalGaps: { type: "array" },
      },
      additionalProperties: false,
    },
    limits: { timeoutMs: 1_000 },
    executor: async (
      _context: ToolExecutionContext,
      args: DiscoveryReadinessInput,
    ): Promise<DiscoveryReadinessOutput> => {
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
      const blockingGaps = gaps.filter((gap) => gap.blockingAction);
      const criticalGaps = gaps.filter((gap) => gap.importance === "critical");

      return {
        ready: blockingGaps.length === 0,
        blockingGaps,
        criticalGaps,
      };
    },
  };
}
