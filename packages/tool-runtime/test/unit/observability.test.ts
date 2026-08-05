import {
  ConsoleToolLogger,
  createConsoleToolObservability,
  createInMemoryToolObservability,
  InMemoryToolMetrics,
  InMemoryToolEventPublisher,
  reportToolResult,
} from "../../src/index.js";
import type { ToolExecutionResult } from "../../src/index.js";

function makeCompletedResult(): ToolExecutionResult {
  return {
    requestId: "r1",
    toolId: "search.documents",
    toolVersion: "1.0.0",
    status: "completed",
    output: { ok: true },
    durationMs: 12,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
}

function makeFailedResult(): ToolExecutionResult {
  return {
    requestId: "r2",
    toolId: "search.documents",
    toolVersion: "1.0.0",
    status: "failed",
    durationMs: 8,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    error: {
      code: "execution_failed",
      name: "ToolExecutionError",
      message: "boom",
    },
  };
}

function makeCancelledResult(): ToolExecutionResult {
  return {
    requestId: "r3",
    toolId: "search.documents",
    toolVersion: "1.0.0",
    status: "cancelled",
    durationMs: 4,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
}

describe("Tool observability", () => {
  it("records latency, success and failure metrics through InMemoryToolMetrics", () => {
    const metrics = new InMemoryToolMetrics();
    const observability = createInMemoryToolObservability(metrics);

    reportToolResult(observability, makeCompletedResult());
    reportToolResult(observability, makeFailedResult());
    reportToolResult(observability, makeCancelledResult());

    expect(metrics.getLatencies()).toHaveLength(3);
    expect(metrics.getSuccesses()).toHaveLength(1);
    expect(metrics.getErrors()).toHaveLength(1);
    expect(metrics.getCancellations()).toHaveLength(1);

    const errorMetric = metrics.getErrors()[0];
    expect(errorMetric?.errorCode).toBe("execution_failed");
    expect(errorMetric?.toolId).toBe("search.documents");
  });

  it("resets collected metrics", () => {
    const metrics = new InMemoryToolMetrics();
    metrics.recordSuccess({
      toolId: "x",
      toolVersion: "1.0.0",
      requestId: "r1",
      durationMs: 1,
    });
    expect(metrics.getSuccesses()).toHaveLength(1);
    metrics.reset();
    expect(metrics.getSuccesses()).toHaveLength(0);
  });

  it("captures events through InMemoryToolEventPublisher", () => {
    const publisher = new InMemoryToolEventPublisher();
    publisher.publish({
      kind: "tool.registered",
      occurredAt: new Date().toISOString(),
      toolId: "x",
      version: "1.0.0",
    });
    publisher.publish({
      kind: "tool.requested",
      occurredAt: new Date().toISOString(),
      toolId: "x",
      requestId: "r1",
    });

    expect(publisher.filter("tool.registered")).toHaveLength(1);
    expect(publisher.filter("tool.requested")).toHaveLength(1);
    expect(publisher.history()).toHaveLength(2);
  });

  it("createConsoleToolObservability returns a working console-backed logger", () => {
    const observability = createConsoleToolObservability();
    expect(observability.logger).toBeInstanceOf(ConsoleToolLogger);
    expect(() =>
      observability.logger.log("info", "hello", { scope: "test" }),
    ).not.toThrow();
  });
});
