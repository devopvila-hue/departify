import {
  InMemoryRouterMetrics,
  LlmRouter,
  LlmRouterValidationError,
  ProviderRegistry,
  bootstrapLlmRouter,
  createInMemoryObservability,
  type LlmProvider,
  type LlmProviderDescriptor,
} from "../../src/index.js";

interface FakeProviderOptions {
  providerId: string;
  modelId: string;
  capabilities?: readonly (
    | "chat"
    | "completion"
    | "embeddings"
    | "tool_calling"
    | "streaming"
    | "structured_output"
    | "vision"
    | "reasoning"
    | "json_output"
  )[];
  chatReply?: string;
  completionText?: string;
  embedding?: readonly number[];
  fail?: boolean;
}

function fakeProvider(options: FakeProviderOptions): LlmProvider {
  const baseCapabilities = options.capabilities ?? ["chat"];
  return {
    describe(): LlmProviderDescriptor {
      return {
        providerId: options.providerId,
        displayName: `Provider ${options.providerId}`,
        capabilities: { capabilities: baseCapabilities },
        models: [
          {
            providerId: options.providerId,
            modelId: options.modelId,
            displayName: `${options.providerId} ${options.modelId}`,
            capabilities: baseCapabilities,
            costScore: 50,
            latencyScore: 50,
            availabilityScore: 90,
          },
        ],
      };
    },
    async chat(request) {
      if (options.fail) {
        throw new Error("chat failure");
      }
      return {
        type: "chat",
        requestId: request.requestId,
        providerId: options.providerId,
        modelId: options.modelId,
        message: options.chatReply ?? "hi",
        usage: { inputTokens: 5, outputTokens: 4 },
      };
    },
    async complete(request) {
      if (options.fail) {
        throw new Error("completion failure");
      }
      return {
        type: "completion",
        requestId: request.requestId,
        providerId: options.providerId,
        modelId: options.modelId,
        text: options.completionText ?? "done",
        usage: { inputTokens: 3, outputTokens: 2 },
      };
    },
    async embed(request) {
      if (options.fail) {
        throw new Error("embed failure");
      }
      return {
        type: "embeddings",
        requestId: request.requestId,
        providerId: options.providerId,
        modelId: options.modelId,
        embeddings: [options.embedding ?? [0.1, 0.2, 0.3]],
      };
    },
    async *stream(request) {
      if (options.fail) {
        throw new Error("stream failure");
      }
      const chunks =
        request.type === "chat"
          ? (options.chatReply ?? "hi").split("")
          : (options.completionText ?? "done").split("");
      let sequence = 0;
      for (const contentDelta of chunks) {
        yield {
          requestId: request.requestId,
          sequence,
          contentDelta,
          done: false,
        };
        sequence += 1;
      }
      yield {
        requestId: request.requestId,
        sequence,
        contentDelta: "",
        done: true,
      };
    },
  };
}

function composeRouter(
  providers: readonly LlmProvider[],
  defaultProvider: string,
  strategy: "capability_first" | "balanced" = "capability_first",
  metrics?: InMemoryRouterMetrics,
) {
  const observability = metrics
    ? createInMemoryObservability(metrics)
    : undefined;
  return bootstrapLlmRouter({
    config: {
      defaultProvider,
      defaultStrategy: strategy,
    },
    providers,
    ...(observability ? { observability } : {}),
  });
}

describe("LlmRouter composition facade", () => {
  it("describes the router, its default provider and strategy", () => {
    const openai = fakeProvider({
      providerId: "openai",
      modelId: "gpt-4o-mini",
      capabilities: ["chat", "tool_calling", "streaming", "structured_output"],
    });
    const { router } = composeRouter([openai], "openai");

    const descriptor = router.describe();
    expect(descriptor.defaultProviderId).toBe("openai");
    expect(descriptor.strategy).toBe("capability_first");
    expect(descriptor.providers).toHaveLength(1);
    expect(descriptor.providers[0]?.providerId).toBe("openai");
  });

  it("routes chat to the default provider when no preference is supplied", async () => {
    const openai = fakeProvider({
      providerId: "openai",
      modelId: "gpt-4o-mini",
      capabilities: ["chat", "tool_calling", "streaming", "structured_output"],
      chatReply: "Hello from OpenAI",
    });
    const { router } = composeRouter([openai], "openai");

    const response = await router.chat({
      type: "chat",
      requestId: "req_chat_default",
      requiredCapabilities: ["chat"],
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(response.message).toBe("Hello from OpenAI");
    expect(response.providerId).toBe("openai");
  });

  it("routes completion through the default provider", async () => {
    const openai = fakeProvider({
      providerId: "openai",
      modelId: "gpt-4o-mini",
      capabilities: ["chat", "completion"],
      completionText: "Completed text",
    });
    const { router } = composeRouter([openai], "openai");

    const response = await router.complete({
      type: "completion",
      requestId: "req_completion_default",
      requiredCapabilities: ["completion"],
      prompt: "Complete me",
    });

    expect(response.text).toBe("Completed text");
  });

  it("routes embedding requests through the default provider", async () => {
    const openai = fakeProvider({
      providerId: "openai",
      modelId: "text-embed",
      capabilities: ["chat", "embeddings"],
      embedding: [0.1, 0.2, 0.3],
    });
    const { router } = composeRouter([openai], "openai");

    const response = await router.embed({
      type: "embeddings",
      requestId: "req_embed",
      requiredCapabilities: ["embeddings"],
      input: ["hello"],
    });

    expect(response.embeddings).toEqual([[0.1, 0.2, 0.3]]);
  });

  it("streams chat responses and emits stream chunks", async () => {
    const openai = fakeProvider({
      providerId: "openai",
      modelId: "gpt-4o-mini",
      capabilities: ["chat", "streaming"],
      chatReply: "AB",
    });
    const { router } = composeRouter([openai], "openai");

    const chunks: string[] = [];
    for await (const chunk of router.stream({
      type: "chat",
      requestId: "req_stream",
      requiredCapabilities: ["chat", "streaming"],
      messages: [{ role: "user", content: "Hi" }],
    })) {
      chunks.push(chunk.contentDelta);
    }

    expect(chunks.join("")).toBe("AB");
  });

  it("records latency, tokens and success metrics on chat success", async () => {
    const metrics = new InMemoryRouterMetrics();
    const openai = fakeProvider({
      providerId: "openai",
      modelId: "gpt-4o-mini",
      capabilities: ["chat"],
      chatReply: "Hi",
    });
    const { router } = composeRouter(
      [openai],
      "openai",
      "capability_first",
      metrics,
    );

    await router.chat({
      type: "chat",
      requestId: "req_metrics",
      requiredCapabilities: ["chat"],
      messages: [{ role: "user", content: "Hi" }],
    });

    expect(metrics.getLatencies()).toHaveLength(1);
    expect(metrics.getLatencies()[0]).toMatchObject({
      providerId: "openai",
      modelId: "gpt-4o-mini",
      operation: "chat",
    });
    expect(metrics.getTokens()).toEqual([
      {
        providerId: "openai",
        modelId: "gpt-4o-mini",
        operation: "chat",
        inputTokens: 5,
        outputTokens: 4,
      },
    ]);
    expect(metrics.getSuccesses()).toHaveLength(1);
  });

  it("records errors on chat failure", async () => {
    const metrics = new InMemoryRouterMetrics();
    const openai = fakeProvider({
      providerId: "openai",
      modelId: "gpt-4o-mini",
      capabilities: ["chat"],
      fail: true,
    });
    const { router } = composeRouter(
      [openai],
      "openai",
      "capability_first",
      metrics,
    );

    await expect(
      router.chat({
        type: "chat",
        requestId: "req_error",
        requiredCapabilities: ["chat"],
        messages: [{ role: "user", content: "Hi" }],
      }),
    ).rejects.toThrow();

    expect(metrics.getErrors()).toHaveLength(1);
    expect(metrics.getSuccesses()).toHaveLength(0);
  });

  it("rejects requests whose required capabilities are unsupported", async () => {
    const openai = fakeProvider({
      providerId: "openai",
      modelId: "gpt-4o-mini",
      capabilities: ["chat"],
    });
    const { router } = composeRouter([openai], "openai");

    await expect(
      router.embed({
        type: "embeddings",
        requestId: "req_unsupported",
        requiredCapabilities: ["embeddings"],
        input: ["hello"],
      }),
    ).rejects.toThrow();
  });

  it("uses balanced strategy when configured", async () => {
    const metrics = new InMemoryRouterMetrics();
    const openai = fakeProvider({
      providerId: "openai",
      modelId: "gpt-4o-mini",
      capabilities: ["chat"],
    });
    const { router } = composeRouter([openai], "openai", "balanced", metrics);

    expect(router.getStrategy()).toBe("balanced");
  });

  it("falls back to the first registered provider when the configured default is unknown", () => {
    const openai = fakeProvider({
      providerId: "openai",
      modelId: "gpt-4o-mini",
      capabilities: ["chat"],
    });
    const mock = fakeProvider({
      providerId: "mock",
      modelId: "mock-1",
      capabilities: ["chat"],
    });
    const { router } = composeRouter([openai, mock], "missing");

    expect(router.getDefaultProviderId()).toBe("openai");
  });

  it("throws when no providers are supplied", () => {
    expect(() =>
      bootstrapLlmRouter({
        config: {
          defaultProvider: "openai",
          defaultStrategy: "capability_first",
        },
        providers: [],
      }),
    ).toThrow();
  });

  it("validates requests before dispatching", async () => {
    const openai = fakeProvider({
      providerId: "openai",
      modelId: "gpt-4o-mini",
      capabilities: ["chat"],
    });
    const { router } = composeRouter([openai], "openai");

    await expect(
      router.chat({
        type: "chat",
        requestId: "req_invalid",
        requiredCapabilities: ["chat"],
        messages: [{ role: "user", content: "" }],
      }),
    ).rejects.toBeInstanceOf(LlmRouterValidationError);
  });

  it("exposes the provider list", () => {
    const openai = fakeProvider({
      providerId: "openai",
      modelId: "gpt-4o-mini",
      capabilities: ["chat"],
    });
    const mock = fakeProvider({
      providerId: "mock",
      modelId: "mock-1",
      capabilities: ["chat"],
    });
    const { router } = composeRouter([openai, mock], "openai");

    expect(router.listProviders()).toEqual(["openai", "mock"]);
  });

  it("supports manual construction through LlmRouter.bootstrap", () => {
    const registry = new ProviderRegistry();
    registry.register(
      fakeProvider({
        providerId: "openai",
        modelId: "gpt-4o-mini",
        capabilities: ["chat"],
      }),
    );

    const router = LlmRouter.bootstrap({
      registry,
      defaultProviderId: "openai",
      strategy: "balanced",
    });

    expect(router.getDefaultProviderId()).toBe("openai");
    expect(router.getStrategy()).toBe("balanced");
  });
});
