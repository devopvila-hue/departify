import type {
  ChatResponse,
  CompletionResponse,
  StreamChunk,
} from "@departify/llm-router";
import { GoogleVertexLlmProvider } from "../../src/index.js";
import type {
  GoogleVertexClient,
  GoogleVertexGenerationResponse,
  GoogleVertexStreamChunk,
} from "../../src/client/google-vertex-client.js";

const config = {
  projectId: "p",
  location: "us-central1",
  defaultModel: "gemini-1.5-pro",
  timeoutMs: 1000,
  maxRetries: 1,
};

describe("GoogleVertexLlmProvider", () => {
  it("describes capabilities without exposing SDK types", () => {
    const provider = new GoogleVertexLlmProvider(fakeClient("Hi"), config);

    expect(provider.describe()).toMatchObject({
      providerId: "google_vertex",
      displayName: "Google Vertex AI",
      capabilities: {
        capabilities: expect.arrayContaining([
          "chat",
          "tool_calling",
          "streaming",
          "structured_output",
        ]),
      },
    });
    expect(provider.supportsToolCalling()).toBe(true);
    expect(provider.supportsStructuredOutput()).toBe(true);
  });

  it("maps chat requests and responses", async () => {
    const provider = new GoogleVertexLlmProvider(
      fakeClient("Hello Vertex"),
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
      type: "chat",
      providerId: "google_vertex",
      modelId: "gemini-1.5-pro",
      message: "Hello Vertex",
    });
  });

  it("maps completion responses", async () => {
    const provider = new GoogleVertexLlmProvider(
      fakeClient("Done Vertex"),
      config,
    );

    await expect(
      provider.complete({
        type: "completion",
        requestId: "req_completion_001",
        requiredCapabilities: ["completion"],
        prompt: "Complete",
      }),
    ).resolves.toMatchObject({
      type: "completion",
      text: "Done Vertex",
    });
  });

  it("maps streaming chunks", async () => {
    const provider = new GoogleVertexLlmProvider(
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

function fakeClient(text: string): GoogleVertexClient {
  return {
    getGenerativeModel() {
      return {
        async generateContent(): Promise<GoogleVertexGenerationResponse> {
          return {
            candidates: [
              {
                content: { role: "model", parts: [{ text }] },
              },
            ],
            usageMetadata: {
              promptTokenCount: 1,
              candidatesTokenCount: 1,
            },
          };
        },
        async generateContentStream() {
          return (async function* () {
            yield {
              candidates: [{ content: { role: "model", parts: [{ text }] } }],
            };
          })();
        },
      };
    },
  };
}

function streamingClient(chunks: readonly string[]): GoogleVertexClient {
  return {
    getGenerativeModel() {
      return {
        async generateContent() {
          throw new Error("not used");
        },
        async generateContentStream(): Promise<
          AsyncIterable<GoogleVertexStreamChunk>
        > {
          return (async function* () {
            for (const text of chunks) {
              yield {
                candidates: [{ content: { role: "model", parts: [{ text }] } }],
              };
            }
          })();
        },
      };
    },
  };
}

// Allow TS to keep the helper referenced.
export type _ChatResponseProbe = ChatResponse;
export type _CompletionResponseProbe = CompletionResponse;
