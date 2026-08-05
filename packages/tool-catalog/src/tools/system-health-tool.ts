import type {
  LlmModelDescriptor,
  LlmProvider,
  ProviderRegistry as LlmProviderRegistry,
} from "@departify/llm-router";
import { type ToolRegistry } from "@departify/tool-runtime";

export interface SystemHealthInput {
  readonly includeProviderDetails?: boolean;
}

export interface SystemHealthOutput {
  readonly runtime: {
    readonly name: string;
    readonly version: string;
    readonly environment: string;
  };
  readonly toolRuntime: {
    readonly registered: number;
    readonly providers: readonly string[];
  };
  readonly router: {
    readonly providers: readonly string[];
    readonly defaultProvider: string;
  };
  readonly providerRegistry: {
    readonly providers: readonly {
      readonly providerId: string;
      readonly displayName: string;
      readonly models: readonly string[];
    }[];
  };
  readonly version: string;
  readonly timestamp: string;
}

export interface SystemHealthToolOptions {
  readonly runtime?: {
    readonly name: string;
    readonly version: string;
    readonly environment: string;
  };
  readonly llmProviderRegistry?: LlmProviderRegistry;
  readonly llmRouter?: {
    readonly defaultProviderId: string;
  };
  readonly toolProviderRegistry?: ToolRegistry;
  readonly clock?: () => Date;
  readonly catalogVersion?: string;
}

const FALLBACK_RUNTIME = {
  name: "@departify/platform",
  version: "0.0.0",
  environment: "development",
};

/**
 * `system.health` — surface a typed health summary. Pure local computation:
 * no external HTTP, no IA. Hosts supply runtime metadata at composition time.
 */
export function createSystemHealthToolDefinition(
  options: SystemHealthToolOptions = {},
) {
  const runtime = options.runtime ?? FALLBACK_RUNTIME;
  const clock = options.clock ?? (() => new Date());
  const catalogVersion = options.catalogVersion ?? "1.0.0";

  return {
    id: "system.health",
    version: catalogVersion,
    metadata: {
      displayName: "System Health",
      description:
        "Return a typed health snapshot of the runtime, tool runtime, router and provider registry.",
      tags: ["system", "health"],
    },
    capabilities: ["idempotent", "side_effect_free"] as const,
    requiredScopes: ["read.public"] as const,
    inputSchema: {
      type: "object",
      properties: {
        includeProviderDetails: { type: "boolean" },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      required: [
        "runtime",
        "toolRuntime",
        "router",
        "providerRegistry",
        "version",
        "timestamp",
      ],
    },
    limits: { timeoutMs: 1_000 },
    executor: async (): Promise<SystemHealthOutput> => {
      const llmDescriptors: readonly ReturnType<LlmProvider["describe"]>[] =
        options.llmProviderRegistry?.listDescriptors() ?? [];
      const tools = options.toolProviderRegistry?.list() ?? [];

      const toolRuntimeRegistered = tools.length;

      return {
        runtime,
        toolRuntime: {
          registered: toolRuntimeRegistered,
          providers: tools.map(
            (tool: { definition: { id: string } }) => tool.definition.id,
          ),
        },
        router: {
          providers: llmDescriptors.map((descriptor) => descriptor.providerId),
          defaultProvider: options.llmRouter?.defaultProviderId ?? "none",
        },
        providerRegistry: {
          providers: llmDescriptors.map((descriptor) => ({
            providerId: descriptor.providerId,
            displayName: descriptor.displayName,
            models: descriptor.models.map(
              (model: LlmModelDescriptor) => model.modelId,
            ),
          })),
        },
        version: catalogVersion,
        timestamp: clock().toISOString(),
      };
    },
  };
}
