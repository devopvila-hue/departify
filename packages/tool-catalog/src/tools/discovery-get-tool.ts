import type {
  CompanyDiscoveryReport,
  DiscoveryReportRepository,
} from "@departify/business-discovery";
import type {
  ToolExecutionContext,
  ToolExecutionErrorEnvelope,
  ToolDefinition,
} from "@departify/tool-runtime";

export interface DiscoveryGetInput {
  readonly organizationId: string;
}

export interface DiscoveryGetOutput {
  readonly report: CompanyDiscoveryReport;
  readonly executionId: string;
  readonly sessionId: string;
}

export interface DiscoveryGetToolOptions {
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
 * `discovery.get` — return the most recent completed Business Discovery
 * report of an organization from the host-supplied repository.
 *
 * Sprint 37: the report is produced by the Executive Discovery Workflow
 * (Sprint 31) and persisted through `DiscoveryReportRepository` (Sprint 36);
 * this Tool makes it readable by Digital Employees at runtime. Pure, no IA,
 * no HTTP, no SDKs.
 */
export function createDiscoveryGetToolDefinition(
  options: DiscoveryGetToolOptions,
): ToolDefinition<DiscoveryGetInput, DiscoveryGetOutput> {
  return {
    id: "discovery.get",
    version: "1.0.0",
    metadata: {
      displayName: "Discovery Get",
      description:
        "Return the most recent Business Discovery report of an organization from the discovery repository.",
      tags: ["discovery", "business", "report"],
    },
    capabilities: ["idempotent", "side_effect_free"],
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
      required: ["report", "executionId", "sessionId"],
      properties: {
        report: { type: "object" },
        executionId: { type: "string" },
        sessionId: { type: "string" },
      },
      additionalProperties: false,
    },
    limits: { timeoutMs: 1_000 },
    executor: async (
      _context: ToolExecutionContext,
      args: DiscoveryGetInput,
    ): Promise<DiscoveryGetOutput> => {
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
      return {
        report: mostRecent.report,
        executionId: mostRecent.executionId,
        sessionId: mostRecent.sessionId,
      };
    },
  };
}
