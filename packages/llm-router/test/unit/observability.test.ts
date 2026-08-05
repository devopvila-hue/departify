import {
  InMemoryRouterMetrics,
  reportRouterTrace,
  createNoopObservability,
  createInMemoryObservability,
} from "../../src/index.js";

describe("Router observability", () => {
  it("creates a no-op observability that silently swallows traces", () => {
    const observability = createNoopObservability();

    expect(() =>
      reportRouterTrace(observability, {
        requestId: "req_001",
        providerId: "openai",
        modelId: "gpt-4o-mini",
        operation: "chat",
        latencyMs: 12,
      }),
    ).not.toThrow();
  });

  it("captures latency, tokens, success and error metrics through InMemoryRouterMetrics", () => {
    const metrics = new InMemoryRouterMetrics();
    const observability = createInMemoryObservability(metrics);

    reportRouterTrace(observability, {
      requestId: "req_success",
      providerId: "openai",
      modelId: "gpt-4o-mini",
      operation: "chat",
      latencyMs: 42,
      inputTokens: 11,
      outputTokens: 7,
    });

    reportRouterTrace(observability, {
      requestId: "req_error",
      providerId: "openai",
      modelId: "gpt-4o-mini",
      operation: "completion",
      latencyMs: 80,
      error: new Error("boom"),
    });

    expect(metrics.getLatencies()).toEqual([
      {
        providerId: "openai",
        modelId: "gpt-4o-mini",
        operation: "chat",
        latencyMs: 42,
      },
      {
        providerId: "openai",
        modelId: "gpt-4o-mini",
        operation: "completion",
        latencyMs: 80,
      },
    ]);

    expect(metrics.getTokens()).toEqual([
      {
        providerId: "openai",
        modelId: "gpt-4o-mini",
        operation: "chat",
        inputTokens: 11,
        outputTokens: 7,
      },
    ]);

    expect(metrics.getSuccesses()).toHaveLength(1);
    expect(metrics.getErrors()).toHaveLength(1);
    expect(metrics.getErrors()[0]?.error.message).toBe("boom");
  });

  it("resets its collections on demand", () => {
    const metrics = new InMemoryRouterMetrics();
    metrics.recordSuccess({
      providerId: "openai",
      modelId: "gpt-4o-mini",
      operation: "chat",
    });
    expect(metrics.getSuccesses()).toHaveLength(1);
    metrics.reset();
    expect(metrics.getSuccesses()).toHaveLength(0);
  });
});
