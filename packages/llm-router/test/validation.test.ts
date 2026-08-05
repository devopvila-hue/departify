import {
  LlmRouterValidationError,
  validateLlmRequest,
  validateLlmResponse,
  validateRoutingPolicy,
  validateStreamChunk,
} from "../src/index.js";

describe("router validation", () => {
  it("validates chat requests with tools and structured output", () => {
    expect(() =>
      validateLlmRequest({
        type: "chat",
        requestId: "req_001",
        requiredCapabilities: ["chat", "tool_calling", "structured_output"],
        messages: [{ role: "user", content: "Create a JSON answer" }],
        tools: [
          {
            name: "lookup",
            description: "Lookup data",
            inputSchema: { type: "object" },
          },
        ],
        structuredOutput: {
          name: "answer",
          schema: { type: "object" },
        },
      }),
    ).not.toThrow();
  });

  it("rejects invalid requests", () => {
    expect(() =>
      validateLlmRequest({
        type: "embeddings",
        requestId: "req_001",
        requiredCapabilities: ["chat"],
        input: ["text"],
      }),
    ).toThrow(LlmRouterValidationError);
  });

  it("validates responses and stream chunks", () => {
    expect(() =>
      validateLlmResponse({
        type: "completion",
        requestId: "req_001",
        providerId: "provider_alpha",
        modelId: "model_chat_fast",
        text: "Done",
        usage: {
          inputTokens: 2,
          outputTokens: 1,
        },
      }),
    ).not.toThrow();
    expect(() =>
      validateStreamChunk({
        requestId: "req_001",
        sequence: 0,
        contentDelta: "A",
        done: false,
      }),
    ).not.toThrow();
  });

  it("validates routing policies", () => {
    expect(() =>
      validateRoutingPolicy({
        strategy: "balanced",
        requiredCapabilities: ["chat"],
        maxCostScore: 50,
      }),
    ).not.toThrow();
    expect(() =>
      validateRoutingPolicy({
        strategy: "balanced",
        requiredCapabilities: [],
      }),
    ).toThrow(LlmRouterValidationError);
  });
});
