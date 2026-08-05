import type {
  KnowledgeDocumentSnapshot,
  KnowledgeRankingPolicy,
  KnowledgeRetrievalPort,
  KnowledgeRetrievalRequest,
  KnowledgeRetrievalResult,
  KnowledgeSelectionPolicy,
} from "@departify/knowledge-engine";
import type {
  ToolExecutionContext,
  ToolExecutionErrorEnvelope,
  ToolDefinition,
} from "@departify/tool-runtime";

export interface KnowledgeSearchInput {
  readonly organizationId: string;
  readonly query: string;
  readonly limit?: number;
  readonly selectionPolicy?: KnowledgeSelectionPolicy;
  readonly rankingPolicy?: KnowledgeRankingPolicy;
}

export interface KnowledgeSearchOutput {
  readonly documents: readonly KnowledgeDocumentSnapshot[];
  readonly count: number;
}

export interface KnowledgeSearchToolOptions {
  readonly port: KnowledgeRetrievalPort;
}

function toEnvelope(error: unknown): ToolExecutionErrorEnvelope {
  const cause = error instanceof Error ? error.message : String(error);
  return {
    code: "execution_failed",
    name: "KnowledgeSearchError",
    message: cause,
  };
}

/**
 * `knowledge.search` — call the existing `KnowledgeRetrievalPort`. No vector
 * search, no embeddings, no IA. The Tool surfaces the typed retrieval
 * contract.
 */
export function createKnowledgeSearchToolDefinition(
  options: KnowledgeSearchToolOptions,
): ToolDefinition<KnowledgeSearchInput, KnowledgeSearchOutput> {
  return {
    id: "knowledge.search",
    version: "1.0.0",
    metadata: {
      displayName: "Knowledge Search",
      description:
        "Search Knowledge Engine documents through the typed retrieval port.",
      tags: ["knowledge", "retrieval"],
    },
    capabilities: ["idempotent", "side_effect_free"],
    requiredScopes: ["read.private"],
    inputSchema: {
      type: "object",
      required: ["organizationId", "query"],
      properties: {
        organizationId: { type: "string", minLength: 1 },
        query: { type: "string", minLength: 1 },
        limit: { type: "integer", minimum: 1, maximum: 1_000 },
        selectionPolicy: { type: "object" },
        rankingPolicy: { type: "object" },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      required: ["documents", "count"],
      properties: {
        documents: { type: "array" },
        count: { type: "integer", minimum: 0 },
      },
      additionalProperties: false,
    },
    limits: { timeoutMs: 5_000 },
    executor: async (
      _context: ToolExecutionContext,
      args: KnowledgeSearchInput,
    ): Promise<KnowledgeSearchOutput> => {
      const selectionPolicy: KnowledgeSelectionPolicy =
        args.selectionPolicy ??
        ({
          scopes: ["organization"],
          contentTypes: ["markdown", "plain_text"],
          includeArchived: false,
        } as KnowledgeSelectionPolicy);
      const rankingPolicy: KnowledgeRankingPolicy =
        args.rankingPolicy ??
        ({
          signals: ["freshness"],
          requireDeterministicOrder: false,
        } as KnowledgeRankingPolicy);

      const request: KnowledgeRetrievalRequest = {
        organizationId: args.organizationId,
        query: args.query,
        selectionPolicy,
        rankingPolicy,
        limit: Math.max(1, Math.min(args.limit ?? 20, 1_000)),
      };

      let result: KnowledgeRetrievalResult;
      try {
        result = await options.port.retrieve(request);
      } catch (cause) {
        if (cause instanceof Error) {
          throw toEnvelope(cause);
        }
        throw toEnvelope(cause);
      }

      return {
        documents: result.documents,
        count: result.documents.length,
      };
    },
  };
}

export const knowledgeSearchErrorEnvelope = toEnvelope;
