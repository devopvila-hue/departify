import type { StreamChunk } from "@departify/llm-router";
import { MiniMaxLlmProvider } from "../../src/index.js";
import type {
  MiniMaxChatCompletionResult,
  MiniMaxProviderClient,
  MiniMaxStreamChunk,
} from "../../src/client/minimax-client.js";

const config = {
  apiKey: "test-key",
  baseUrl: "https://api.minimax.example.com/v1",
  defaultModel: "minimax-1",
  timeoutMs: 1000,
  maxRetries: 1,
};

describe("MiniMaxLlmProvider", () => {
  it("describes capabilities without exposing SDK types", () => {
    const provider = new MiniMaxLlmProvider(fakeClient("Hi"), config);

    expect(provider.describe()).toMatchObject({
      providerId: "minimax",
      displayName: "MiniMax",
      capabilities: {
        capabilities: expect.arrayContaining([
          "chat",
          "tool_calling",
          "streaming",
          "structured_output",
          "json_output",
        ]),
      },
    });
  });

  it("maps chat requests and responses", async () => {
    const provider = new MiniMaxLlmProvider(
      fakeClient("Hello MiniMax"),
      config,
    );

    await expect(
      provider.chat({
        type: "chat",
        requestId: "req_chat_001",
        requiredCapabilities: ["chat"],
        messages: [{ role: "user", content: "Hi" }],
      }),
    ).resolves.toMatchObject({
      providerId: "minimax",
      modelId: "minimax-1",
      message: "Hello MiniMax",
    });
  });

  it("maps completion responses", async () => {
    const provider = new MiniMaxLlmProvider(fakeClient("Completed"), config);

    await expect(
      provider.complete({
        type: "completion",
        requestId: "req_completion_001",
        requiredCapabilities: ["completion"],
        prompt: "Complete",
      }),
    ).resolves.toMatchObject({
      type: "completion",
      text: "Completed",
    });
  });

  it("maps streaming chunks", async () => {
    const provider = new MiniMaxLlmProvider(
      streamingClient(["He", "llo"]),
      config,
    );
    const chunks: StreamChunk[] = [];

    for await (const chunk of provider.stream({
      type: "chat",
      requestId: "req_stream_001",
      requiredCapabilities: ["chat", "streaming"],
      messages: [{ role: "user", content: "Hi" }],
      stream: true,
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      {
        requestId: "req_stream_001",
        sequence: 0,
        contentDelta: "He",
        done: false,
      },
      {
        requestId: "req_stream_001",
        sequence: 1,
        contentDelta: "llo",
        done: false,
      },
      {
        requestId: "req_stream_001",
        sequence: 2,
        contentDelta: "",
        done: true,
      },
    ]);
  });
});

function fakeClient(content: string): MiniMaxProviderClient {
  return {
    chat: {
      completions: {
        async create() {
          return {
            choices: [{ message: { content } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          } satisfies MiniMaxChatCompletionResult;
        },
      },
    },
  };
}

function streamingClient(chunks: readonly string[]): MiniMaxProviderClient {
  return {
    chat: {
      completions: {
        create() {
          return streamChunks(chunks);
        },
      },
    },
  };
}

async function* streamChunks(chunks: readonly string[]) {
  for (const contentDelta of chunks) {
    yield {
      choices: [{ delta: { content: contentDelta } }],
    } satisfies MiniMaxStreamChunk;
  }
}
