import {
  createToolRuntime,
  InMemoryToolEventPublisher,
  InMemoryToolMetrics,
  ToolExecutionDisabledError,
  ToolExecutionError,
  ScopeBasedAuthorizationPolicy,
  type ToolDefinition,
  type ToolExecutionContext,
} from "../../src/index.js";
import { validateToolDefinition } from "../../src/index.js";

function makeTool(
  overrides: Partial<{
    id: string;
    version: string;
    scopes: readonly string[];
    capabilities: readonly string[];
    executor: (
      context: ToolExecutionContext,
      args: unknown,
    ) => Promise<unknown>;
    timeoutMs: number;
  }> = {},
): ToolDefinition {
  const definition = validateToolDefinition({
    id: overrides.id ?? "sample.tool",
    version: overrides.version ?? "1.0.0",
    metadata: {
      displayName: "Sample",
      description: "Sample tool for pipeline tests.",
    },
    capabilities: overrides.capabilities ?? ["idempotent"],
    requiredScopes: overrides.scopes ?? [],
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    limits: { timeoutMs: overrides.timeoutMs ?? 1000 },
    ...(overrides.executor ? { executor: overrides.executor } : {}),
  });
  return definition;
}

describe("ToolExecutionPipeline", () => {
  it("runs every phase for a successful execution", async () => {
    let executorCalls = 0;
    const executor = async (): Promise<unknown> => {
      executorCalls += 1;
      return { ok: true };
    };

    const runtime = createToolRuntime({
      grantedScopes: ["read.public"],
    });
    runtime.registry.register(
      makeTool({
        scopes: ["read.public"],
        capabilities: ["idempotent", "cancellable"],
        executor,
      }),
    );
    runtime.registry.setStatus("sample.tool", "active");

    const result = await runtime.execute({
      requestId: "r1",
      toolId: "sample.tool",
      args: { q: "hi" },
    });

    expect(result.status).toBe("completed");
    expect(result.output).toEqual({ ok: true });
    expect(executorCalls).toBe(1);
  });

  it("rejects requests when the requested Tool is not active", async () => {
    const runtime = createToolRuntime({ grantedScopes: [] });
    runtime.registry.register(makeTool({ id: "draft.tool" }));

    const result = await runtime.execute({
      requestId: "r1",
      toolId: "draft.tool",
      args: {},
    });

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("unknown_tool");
  });

  it("rejects requests when the Tool is not registered", async () => {
    const runtime = createToolRuntime({ grantedScopes: [] });

    const result = await runtime.execute({
      requestId: "r1",
      toolId: "missing.tool",
      args: {},
    });

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("unknown_tool");
  });

  it("blocks unauthorized Tools at the authorize phase", async () => {
    const runtime = createToolRuntime({
      grantedScopes: [],
      authorization: new ScopeBasedAuthorizationPolicy(),
    });
    runtime.registry.register(makeTool({ scopes: ["write.private"] }));
    runtime.registry.setStatus("sample.tool", "active");

    const result = await runtime.execute({
      requestId: "r1",
      toolId: "sample.tool",
      args: {},
    });

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("authorization_failed");
  });

  it("returns ToolExecutionDisabledError when no executor is wired", async () => {
    const runtime = createToolRuntime({ grantedScopes: [] });
    runtime.registry.register(makeTool());
    runtime.registry.setStatus("sample.tool", "active");

    const result = await runtime.execute({
      requestId: "r1",
      toolId: "sample.tool",
      args: {},
    });

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("execution_disabled");
  });

  it("converts raw executor errors into ToolExecutionError envelopes", async () => {
    const runtime = createToolRuntime({ grantedScopes: [] });
    runtime.registry.register(
      makeTool({
        executor: async () => {
          throw new Error("raw boom");
        },
      }),
    );
    runtime.registry.setStatus("sample.tool", "active");

    const result = await runtime.execute({
      requestId: "r1",
      toolId: "sample.tool",
      args: {},
    });

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("execution_failed");
    expect(result.error?.message).toContain("raw boom");
  });

  it("preserves ToolRuntimeError codes raised by executors", async () => {
    const runtime = createToolRuntime({ grantedScopes: [] });
    runtime.registry.register(
      makeTool({
        executor: async () => {
          throw new ToolExecutionError("execution failed hard");
        },
      }),
    );
    runtime.registry.setStatus("sample.tool", "active");

    const result = await runtime.execute({
      requestId: "r1",
      toolId: "sample.tool",
      args: {},
    });

    expect(result.error?.code).toBe("execution_failed");
    expect(result.error?.message).toContain("execution failed hard");
  });

  it("emits the expected event sequence for a successful run", async () => {
    const publisher = new InMemoryToolEventPublisher();
    const metrics = new InMemoryToolMetrics();

    const { ToolRegistry } = await import("../../src/index.js");
    const registry = new ToolRegistry(publisher);
    const runtime = createToolRuntime({
      registry,
      grantedScopes: ["read.public"],
      publisher,
      observability: {
        logger: {
          log: () => undefined,
        },
        metrics,
      },
    });
    runtime.registry.register(
      makeTool({
        scopes: ["read.public"],
        capabilities: ["idempotent", "cancellable"],
        executor: async () => ({ ok: true }),
      }),
    );
    runtime.registry.setStatus("sample.tool", "active");

    await runtime.execute({
      requestId: "r1",
      toolId: "sample.tool",
      args: {},
    });

    expect(publisher.filter("tool.registered")).toHaveLength(1);
    expect(publisher.filter("tool.requested")).toHaveLength(1);
    expect(publisher.filter("tool.started")).toHaveLength(1);
    expect(publisher.filter("tool.completed")).toHaveLength(1);
    expect(metrics.getSuccesses()).toHaveLength(1);
  });

  it("emits a tool.failed event when execution fails", async () => {
    const publisher = new InMemoryToolEventPublisher();
    const runtime = createToolRuntime({
      grantedScopes: [],
      publisher,
    });
    runtime.registry.register(
      makeTool({
        executor: async () => {
          throw new Error("nope");
        },
      }),
    );
    runtime.registry.setStatus("sample.tool", "active");

    await runtime.execute({
      requestId: "r1",
      toolId: "sample.tool",
      args: {},
    });

    expect(publisher.filter("tool.failed").length).toBeGreaterThanOrEqual(1);
  });
});

describe("ToolExecutionDisabledError behaviour", () => {
  it("carries the execution_disabled error code", () => {
    const error = new ToolExecutionDisabledError();
    expect(error.code).toBe("execution_disabled");
    expect(error.name).toBe("ToolExecutionDisabledError");
  });
});
