import type {
  ChatProvider,
  ChatRequest,
  LlmProvider,
  StreamingProvider,
  StreamChunk,
} from "../src/index.js";

describe("provider contracts", () => {
  it("supports chat provider contracts without concrete SDKs", async () => {
    const provider: ChatProvider = {
      async chat(request: ChatRequest) {
        return {
          type: "chat",
          requestId: request.requestId,
          providerId: "provider_alpha",
          modelId: "model_chat_fast",
          message: "Accepted",
        };
      },
    };

    await expect(
      provider.chat({
        type: "chat",
        requestId: "req_001",
        requiredCapabilities: ["chat"],
        messages: [{ role: "user", content: "Hello" }],
      }),
    ).resolves.toMatchObject({ message: "Accepted" });
  });

  it("models streaming as an internal async iterable contract", async () => {
    const provider: StreamingProvider = {
      async *stream(): AsyncIterable<StreamChunk> {
        yield {
          requestId: "req_001",
          sequence: 0,
          contentDelta: "A",
          done: false,
        };
      },
    };
    const chunks: StreamChunk[] = [];

    for await (const chunk of provider.stream({
      type: "completion",
      requestId: "req_001",
      requiredCapabilities: ["completion", "streaming"],
      prompt: "Hello",
      stream: true,
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
  });

  it("describes aggregate provider contracts", () => {
    const provider: LlmProvider = {
      describe() {
        return {
          providerId: "provider_alpha",
          displayName: "Provider Alpha",
          capabilities: { capabilities: ["chat"] },
          models: [],
        };
      },
    };

    expect(provider.describe().providerId).toBe("provider_alpha");
  });
});
