import type { LlmProvider } from "../contracts/provider-contracts.js";
import { ModelCatalog } from "../models/model-catalog.js";
import type { LlmModelDescriptor } from "../models/model-catalog.js";
import type { RoutingStrategy } from "../policies/routing-policy.js";
import { ProviderSelector } from "../policies/select-provider/provider-selector.js";
import type {
  ChatRequest,
  CompletionRequest,
  EmbeddingRequest,
  LlmRequest,
} from "../requests/llm-requests.js";
import type {
  ChatResponse,
  CompletionResponse,
  EmbeddingResponse,
  StreamChunk,
} from "../responses/llm-responses.js";
import { ModelRouter } from "../routing/model-router.js";
import {
  reportRouterTrace,
  type RouterObservability,
  type RouterOperation,
  type RouterRequestTrace,
  createNoopObservability,
} from "../observability/router-observability.js";
import { ProviderRegistry } from "../providers/provider-registry.js";
import { LlmRouterValidationError } from "../validation/router-error.js";
import { validateLlmRequest } from "../validation/request-validation.js";
import { validateLlmResponse } from "../validation/response-validation.js";

export interface LlmRouterOptions {
  strategy?: RoutingStrategy;
  observability?: RouterObservability;
}

/**
 * The LLM Router facade.
 *
 * It is the only operational entry point for AI model access inside Departify.
 * The rest of the system (Executive Director, Agent Runtime, applications) is
 * expected to talk to this class and to it alone. Provider SDKs remain
 * isolated inside their respective `llm-provider-*` packages.
 */
export class LlmRouter {
  private readonly registry: ProviderRegistry;
  private readonly catalog: ModelCatalog;
  private readonly router: ModelRouter;
  private readonly selector: ProviderSelector;
  private readonly observability: RouterObservability;
  private readonly strategy: RoutingStrategy;
  private readonly defaultProviderId: string;

  constructor(composition: LlmRouterComposition) {
    this.registry = composition.registry;
    this.catalog = composition.catalog;
    this.router = composition.router;
    this.selector = composition.selector;
    this.observability = composition.observability;
    this.strategy = composition.strategy;
    this.defaultProviderId = composition.defaultProviderId;
  }

  static bootstrap(input: BuildCompositionInput): LlmRouter {
    return new LlmRouter(buildComposition(input));
  }

  getDefaultProviderId(): string {
    return this.defaultProviderId;
  }

  getStrategy(): RoutingStrategy {
    return this.strategy;
  }

  listProviders(): readonly string[] {
    return this.registry
      .listDescriptors()
      .map((descriptor) => descriptor.providerId);
  }

  describe(): RouterDescriptor {
    return {
      defaultProviderId: this.defaultProviderId,
      strategy: this.strategy,
      providers: this.registry.listDescriptors().map((descriptor) => ({
        providerId: descriptor.providerId,
        displayName: descriptor.displayName,
        models: descriptor.models.map((model) => ({
          providerId: model.providerId,
          modelId: model.modelId,
          displayName: model.displayName,
          capabilities: [...model.capabilities],
        })),
      })),
    };
  }

  async chat(
    request: ChatRequest,
    options?: LlmRouterOptions,
  ): Promise<ChatResponse> {
    this.validateRequest(request);
    return this.dispatch("chat", request, options, async (provider, model) => {
      if (!isChatCapable(provider)) {
        throw new LlmRouterValidationError(
          `Provider '${this.providerIdOf(provider)}' does not support chat.`,
        );
      }
      const finalised: ChatRequest = {
        ...request,
        modelPreference: {
          providerId: model.providerId,
          modelId: model.modelId,
        },
      };
      const response = await provider.chat(finalised);
      validateLlmResponse(response);
      return response;
    });
  }

  async complete(
    request: CompletionRequest,
    options?: LlmRouterOptions,
  ): Promise<CompletionResponse> {
    this.validateRequest(request);
    return this.dispatch(
      "completion",
      request,
      options,
      async (provider, model) => {
        if (!isCompletionCapable(provider)) {
          throw new LlmRouterValidationError(
            `Provider '${this.providerIdOf(provider)}' does not support completion.`,
          );
        }
        const finalised: CompletionRequest = {
          ...request,
          modelPreference: {
            providerId: model.providerId,
            modelId: model.modelId,
          },
        };
        const response = await provider.complete(finalised);
        validateLlmResponse(response);
        return response;
      },
    );
  }

  async embed(
    request: EmbeddingRequest,
    options?: LlmRouterOptions,
  ): Promise<EmbeddingResponse> {
    this.validateRequest(request);
    return this.dispatch(
      "embeddings",
      request,
      options,
      async (provider, model) => {
        if (!isEmbeddingCapable(provider)) {
          throw new LlmRouterValidationError(
            `Provider '${this.providerIdOf(provider)}' does not support embeddings.`,
          );
        }
        const finalised: EmbeddingRequest = {
          ...request,
          modelPreference: {
            providerId: model.providerId,
            modelId: model.modelId,
          },
        };
        const response = await provider.embed(finalised);
        validateLlmResponse(response);
        return response;
      },
    );
  }

  async *stream(
    request: ChatRequest | CompletionRequest,
    options?: LlmRouterOptions,
  ): AsyncIterable<StreamChunk> {
    this.validateRequest(request);
    const operation: RouterOperation =
      request.type === "chat" ? "stream" : "stream";
    const decision = this.resolveDecision(request, options);
    const provider = this.registry.get(decision.providerId);
    if (!isStreamingCapable(provider)) {
      throw new LlmRouterValidationError(
        `Provider '${decision.providerId}' does not support streaming.`,
      );
    }
    const finalised: ChatRequest | CompletionRequest = {
      ...request,
      stream: true,
      modelPreference: {
        providerId: decision.providerId,
        modelId: decision.modelId,
      },
    };

    const startedAt = Date.now();
    let failed = false;
    let collectedError: Error | undefined;
    try {
      for await (const chunk of provider.stream(finalised)) {
        yield chunk;
      }
    } catch (cause) {
      failed = true;
      collectedError =
        cause instanceof Error
          ? cause
          : new Error("LLM Router streaming failed.");
      throw collectedError;
    } finally {
      reportRouterTrace(this.observability, {
        requestId: request.requestId,
        providerId: decision.providerId,
        modelId: decision.modelId,
        operation,
        latencyMs: Date.now() - startedAt,
        ...(failed && collectedError ? { error: collectedError } : {}),
      });
    }
  }

  private resolveDecision(request: LlmRequest, options?: LlmRouterOptions) {
    return this.selector.resolve(request, {
      strategy: options?.strategy ?? this.strategy,
    });
  }

  private validateRequest(request: LlmRequest): void {
    validateLlmRequest(request);
  }

  private async dispatch<TResponse>(
    operation: RouterOperation,
    request: LlmRequest,
    options: LlmRouterOptions | undefined,
    executor: (
      provider: LlmProvider,
      model: LlmModelDescriptor,
    ) => Promise<TResponse>,
  ): Promise<TResponse> {
    const decision = this.resolveDecision(request, options);
    const provider = this.registry.get(decision.providerId);
    const model = this.catalog.find(decision.providerId, decision.modelId);
    if (!model) {
      throw new LlmRouterValidationError(
        `Routing decision references unknown model ${decision.providerId}/${decision.modelId}.`,
      );
    }

    const startedAt = Date.now();
    try {
      const response = await executor(provider, model);
      reportRouterTrace(this.observability, {
        requestId: request.requestId,
        providerId: decision.providerId,
        modelId: decision.modelId,
        operation,
        latencyMs: Date.now() - startedAt,
        ...extractTokenUsage(response),
      });
      return response;
    } catch (cause) {
      const error =
        cause instanceof Error
          ? cause
          : new Error("LLM Router dispatch failed.");
      reportRouterTrace(this.observability, {
        requestId: request.requestId,
        providerId: decision.providerId,
        modelId: decision.modelId,
        operation,
        latencyMs: Date.now() - startedAt,
        error,
      });
      throw error;
    }
  }

  private providerIdOf(provider: LlmProvider): string {
    return provider.describe().providerId;
  }
}

export interface RouterDescriptor {
  defaultProviderId: string;
  strategy: RoutingStrategy;
  providers: readonly {
    providerId: string;
    displayName: string;
    models: readonly {
      providerId: string;
      modelId: string;
      displayName: string;
      capabilities: readonly string[];
    }[];
  }[];
}

export interface LlmRouterComposition {
  registry: ProviderRegistry;
  catalog: ModelCatalog;
  router: ModelRouter;
  selector: ProviderSelector;
  observability: RouterObservability;
  strategy: RoutingStrategy;
  defaultProviderId: string;
}

export interface BuildCompositionInput {
  registry: ProviderRegistry;
  defaultProviderId: string;
  strategy: RoutingStrategy;
  observability?: RouterObservability;
}

/**
 * Builds the internal composition graph from a registry plus configuration.
 * Consumers normally use `LlmRouter.bootstrap` instead of calling this directly.
 */
export function buildComposition(
  input: BuildCompositionInput,
): LlmRouterComposition {
  const observability = input.observability ?? createNoopObservability();
  const catalog = new ModelCatalog(
    input.registry.collectModels().length > 0
      ? input.registry.collectModels()
      : [createDefaultCatalogEntry(input.defaultProviderId)],
  );
  const router = new ModelRouter(catalog);
  const selector = new ProviderSelector(catalog, router);
  return {
    registry: input.registry,
    catalog,
    router,
    selector,
    observability,
    strategy: input.strategy,
    defaultProviderId: input.defaultProviderId,
  };
}

function createDefaultCatalogEntry(providerId: string): LlmModelDescriptor {
  return {
    providerId,
    modelId: "default",
    displayName: `${providerId} default`,
    capabilities: ["chat"],
    costScore: 50,
    latencyScore: 50,
    availabilityScore: 50,
  };
}

function isChatCapable(provider: LlmProvider): provider is LlmProvider & {
  chat: NonNullable<LlmProvider["chat"]>;
} {
  return typeof (provider as { chat?: unknown }).chat === "function";
}

function isCompletionCapable(provider: LlmProvider): provider is LlmProvider & {
  complete: NonNullable<LlmProvider["complete"]>;
} {
  return typeof (provider as { complete?: unknown }).complete === "function";
}

function isEmbeddingCapable(provider: LlmProvider): provider is LlmProvider & {
  embed: NonNullable<LlmProvider["embed"]>;
} {
  return typeof (provider as { embed?: unknown }).embed === "function";
}

function isStreamingCapable(provider: LlmProvider): provider is LlmProvider & {
  stream: NonNullable<LlmProvider["stream"]>;
} {
  return typeof (provider as { stream?: unknown }).stream === "function";
}

function extractTokenUsage(
  response: ChatResponse | CompletionResponse | EmbeddingResponse | unknown,
): Pick<RouterRequestTrace, "inputTokens" | "outputTokens"> {
  if (
    response &&
    typeof response === "object" &&
    "usage" in response &&
    response.usage
  ) {
    const usage = response.usage as {
      inputTokens?: number;
      outputTokens?: number;
    };
    return {
      ...(usage.inputTokens !== undefined
        ? { inputTokens: usage.inputTokens }
        : {}),
      ...(usage.outputTokens !== undefined
        ? { outputTokens: usage.outputTokens }
        : {}),
    };
  }
  return {};
}
