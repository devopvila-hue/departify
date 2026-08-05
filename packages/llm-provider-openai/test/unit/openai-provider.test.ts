import type { OpenAIProviderClient } from "../../src/client/openai-client.js";
import { OpenAILlmProvider } from "../../src/index.js";

const config = {
  apiKey: "test-key",
  defaultModel: "gpt-4o-mini",
  timeoutMs: 1000,
  maxRetries: 1,
};

describe("OpenAILlmProvider", () => {
  it("describes OpenAI capabilities without exposing SDK types", () => {
    const provider = new OpenAILlmProvider(fakeClient("Hello"), config);

    expect(provider.describe()).toMatchObject({
      providerId: "openai",
      capabilities: {
        capabilities: [
          "chat",
          "tool_calling",
          "streaming",
          "structured_output",
          "json_output",
        ],
      },
    });
    expect(provider.supportsToolCalling()).toBe(true);
    expect(provider.supportsStructuredOutput()).toBe(true);
  });

  it("maps chat requests and responses", async () => {
    const provider = new OpenAILlmProvider(
      fakeClient("Hello Departify"),
      config,
    );

    await expect(
      provider.chat({
        type: "chat",
        requestId: "req_chat_001",
        requiredCapabilities: ["chat"],
        messages: [{ role: "user", content: "Hello" }],
      }),
    ).resolves.toMatchObject({
      type: "chat",
      providerId: "openai",
      modelId: "gpt-4o-mini",
      message: "Hello Departify",
    });
  });

  it("maps structured output responses", async () => {
    const provider = new OpenAILlmProvider(
      fakeClient('{"answer":"ok"}'),
      config,
    );

    await expect(
      provider.chat({
        type: "chat",
        requestId: "req_structured_001",
        requiredCapabilities: ["chat", "structured_output"],
        messages: [{ role: "user", content: "Return JSON" }],
        structuredOutput: {
          name: "answer",
          schema: { type: "object" },
        },
      }),
    ).resolves.toMatchObject({
      structuredOutput: {
        answer: "ok",
      },
    });
  });

  it("maps completion through the chat completions API", async () => {
    const provider = new OpenAILlmProvider(fakeClient("Completed"), config);

    await expect(
      provider.complete({
        type: "completion",
        requestId: "req_completion_001",
        requiredCapabilities: ["completion"],
        prompt: "Complete this",
      }),
    ).resolves.toMatchObject({
      type: "completion",
      text: "Completed",
    });
  });

  it("maps streaming chunks", async () => {
    const provider = new OpenAILlmProvider(
      streamingClient(["Hel", "lo"]),
      config,
    );
    const chunks = [];

    for await (const chunk of provider.stream({
      type: "chat",
      requestId: "req_stream_001",
      requiredCapabilities: ["chat", "streaming"],
      messages: [{ role: "user", content: "Hello" }],
      stream: true,
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      {
        requestId: "req_stream_001",
        sequence: 0,
        contentDelta: "Hel",
        done: false,
      },
      {
        requestId: "req_stream_001",
        sequence: 1,
        contentDelta: "lo",
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

function fakeClient(content: string): OpenAIProviderClient {
  return {
    chat: {
      completions: {
        async create() {
          return {
            choices: [
              {
                message: {
                  content,
                },
              },
            ],
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
            },
          };
        },
      },
    },
  };
}

function streamingClient(chunks: readonly string[]): OpenAIProviderClient {
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
  for (const content of chunks) {
    yield {
      choices: [
        {
          delta: {
            content,
          },
        },
      ],
    };
  }
}
