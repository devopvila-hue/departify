import type {
  MemoryRecordSnapshot,
  MemoryRetrievalPort,
  MemoryRetrievalRequest,
  MemoryRetrievalResult,
  MemorySelectionPolicy,
} from "@departify/memory-engine";
import type {
  ToolExecutionContext,
  ToolExecutionErrorEnvelope,
  ToolDefinition,
} from "@departify/tool-runtime";

export interface MemorySearchInput {
  readonly organizationId: string;
  readonly agentId?: string;
  readonly sessionId?: string;
  readonly limit?: number;
  readonly policy?: MemorySelectionPolicy;
}

export interface MemorySearchOutput {
  readonly memories: readonly MemoryRecordSnapshot[];
  readonly count: number;
}

export interface MemorySearchToolOptions {
  readonly port: MemoryRetrievalPort;
}

class MemorySearchUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemorySearchUnavailableError";
  }
}

function isUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.name === "MemoryRetrievalUnavailableError" ||
    /not implemented|not available|no.*provider/i.test(error.message)
  );
}

function toEnvelope(error: unknown): ToolExecutionErrorEnvelope {
  if (error instanceof MemorySearchUnavailableError) {
    return {
      code: "execution_failed",
      name: error.name,
      message: error.message,
    };
  }
  const cause = error instanceof Error ? error.message : String(error);
  return {
    code: "execution_failed",
    name: "MemorySearchError",
    message: cause,
  };
}

/**
 * `memory.search` — call the existing `MemoryRetrievalPort`. No IA, no
 * embeddings, no vector search. The Tool surfaces whatever the port
 * returns, typed.
 */
export function createMemorySearchToolDefinition(
  options: MemorySearchToolOptions,
): ToolDefinition<MemorySearchInput, MemorySearchOutput> {
  return {
    id: "memory.search",
    version: "1.0.0",
    metadata: {
      displayName: "Memory Search",
      description:
        "Search Memory Engine records through the typed retrieval port.",
      tags: ["memory", "retrieval"],
    },
    capabilities: ["idempotent", "side_effect_free"],
    requiredScopes: ["read.private"],
    inputSchema: {
      type: "object",
      required: ["organizationId"],
      properties: {
        organizationId: { type: "string", minLength: 1 },
        agentId: { type: "string", minLength: 1 },
        sessionId: { type: "string", minLength: 1 },
        limit: { type: "integer", minimum: 1, maximum: 1_000 },
        policy: { type: "object" },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      required: ["memories", "count"],
      properties: {
        memories: { type: "array" },
        count: { type: "integer", minimum: 0 },
      },
      additionalProperties: false,
    },
    limits: { timeoutMs: 5_000 },
    executor: async (
      _context: ToolExecutionContext,
      args: MemorySearchInput,
    ): Promise<MemorySearchOutput> => {
      const policy: MemorySelectionPolicy =
        args.policy ??
        ({
          kinds: ["working", "episodic", "semantic"],
          scopes: ["organization", "agent"],
        } as MemorySelectionPolicy);
      const request: MemoryRetrievalRequest = {
        organizationId: args.organizationId,
        ...(args.agentId ? { agentId: args.agentId } : {}),
        ...(args.sessionId ? { sessionId: args.sessionId } : {}),
        policy,
        limit: Math.max(1, Math.min(args.limit ?? 20, 1_000)),
      };

      let result: MemoryRetrievalResult;
      try {
        result = await options.port.retrieve(request);
      } catch (cause) {
        if (isUnavailableError(cause)) {
          throw new MemorySearchUnavailableError(
            "Memory Engine retrieval is not yet wired.",
          );
        }
        throw cause;
      }

      return {
        memories: result.memories,
        count: result.memories.length,
      };
    },
  };
}

export const memorySearchErrorEnvelope = toEnvelope;
