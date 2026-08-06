import type {
  DiscoveryQuestion,
  DiscoveryReportRepository,
  FindingCategory,
} from "@departify/business-discovery";
import type {
  ToolExecutionContext,
  ToolExecutionErrorEnvelope,
  ToolDefinition,
} from "@departify/tool-runtime";

export interface DiscoveryDelegateInput {
  readonly organizationId: string;
}

export interface DiscoveryDelegationItem {
  readonly workItem: DiscoveryQuestion;
  readonly agentId: string;
  readonly category: FindingCategory;
}

export interface DiscoveryDelegateOutput {
  readonly organizationId: string;
  /**
   * The first automatic delegation of the Director: every discovery question
   * of the plan assigned to the competent Digital Employee of the Department,
   * ordered by priority (highest first).
   */
  readonly delegation: readonly DiscoveryDelegationItem[];
}

export interface DiscoveryDelegateToolOptions {
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
 * Deterministic mapping from a discovery category to the competent Digital
 * Employee of the Comercial Department. Categories without an explicit
 * mapping fall back to the Sales Director.
 */
const CATEGORY_TO_AGENT: Readonly<Record<FindingCategory, string>> = {
  mission: "agent_sales_director",
  vision: "agent_sales_director",
  values: "agent_sales_director",
  value_proposition: "agent_outreach_specialist",
  products: "agent_lead_qualifier",
  services: "agent_lead_qualifier",
  market: "agent_lead_qualifier",
  ideal_customer: "agent_lead_qualifier",
  tone: "agent_outreach_specialist",
  positioning: "agent_outreach_specialist",
  strengths: "agent_proposal_writer",
  weaknesses: "agent_proposal_writer",
  objectives: "agent_proposal_writer",
  processes: "agent_proposal_writer",
  leadership_style: "agent_sales_director",
  priorities: "agent_sales_director",
  philosophy: "agent_sales_director",
  risk_tolerance: "agent_sales_director",
  delegation_style: "agent_sales_director",
  decision_making: "agent_sales_director",
  communication: "agent_outreach_specialist",
  preferences: "agent_sales_director",
};

/**
 * `discovery.delegate` — the first automatic Director delegation.
 *
 * Sprint 43: given an organization, read its most recent completed report
 * (Sprint 36) and assign every discovery question of the plan to the
 * competent Digital Employee of the Comercial Department, using a
 * deterministic category → agent mapping. The delegation is fully auditable
 * (workItem + agentId + category per item). No IA, no generated text.
 */
export function createDiscoveryDelegateToolDefinition(
  options: DiscoveryDelegateToolOptions,
): ToolDefinition<DiscoveryDelegateInput, DiscoveryDelegateOutput> {
  return {
    id: "discovery.delegate",
    version: "1.0.0",
    metadata: {
      displayName: "Discovery Delegate",
      description:
        "Delegate the discovery plan items to the competent Digital Employees of the Department.",
      tags: ["discovery", "business", "delegation"],
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
      required: ["organizationId", "delegation"],
      properties: {
        organizationId: { type: "string" },
        delegation: { type: "array" },
      },
      additionalProperties: false,
    },
    limits: { timeoutMs: 1_000 },
    executor: async (
      _context: ToolExecutionContext,
      args: DiscoveryDelegateInput,
    ): Promise<DiscoveryDelegateOutput> => {
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

      const delegation: DiscoveryDelegationItem[] = ordered.map(
        (question) => ({
          workItem: question,
          agentId: CATEGORY_TO_AGENT[question.category],
          category: question.category,
        }),
      );

      return {
        organizationId: args.organizationId,
        delegation,
      };
    },
  };
}
