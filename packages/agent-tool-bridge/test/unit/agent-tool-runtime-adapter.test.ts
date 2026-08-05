import {
  AgentToolRuntimeAdapter,
  buildAgentPermissionSetResolver,
  createAgentToolRuntimeAdapter,
  createSystemTimeToolDefinition,
  type AgentToolAction,
} from "../../src/index.js";
import { createToolRuntime, type ToolRuntime } from "@departify/tool-runtime";

function buildRuntime(): ToolRuntime {
  const runtime = createToolRuntime({
    grantedScopes: ["read.public", "execute.network"],
  });
  runtime.registry.register(createSystemTimeToolDefinition());
  runtime.registry.setStatus("system.time", "active");
  return runtime;
}

describe("AgentToolRuntimeAdapter", () => {
  it("executes system.time through the Tool Runtime", async () => {
    const runtime = buildRuntime();
    const permissions = new Map([
      [
        "agent.demo",
        [
          {
            scope: "runtime" as const,
            action: "execute" as const,
            resource: "*",
          },
        ],
      ],
    ]);

    const port = createAgentToolRuntimeAdapter({
      runtime,
      fetchPermissionSet: buildAgentPermissionSetResolver(permissions),
    });

    const result = await port.executeAction<Record<string, unknown>>({
      actionId: "act_001",
      agentId: "agent.demo",
      toolId: "system.time",
      args: {},
      organizationId: "org_1",
    });

    if ("status" in result && result.status === "rejected") {
      throw new Error(`expected success, got rejection: ${result.reason}`);
    }
    expect(result.actionId).toBe("act_001");
    expect(result.requestId).toBe("act_001");
    expect(result.toolId).toBe("system.time");
    expect(result.status).toBe("completed");
    expect(result.output).toMatchObject({
      timestamp: expect.any(Number),
      timezone: expect.stringMatching(/^UTC[+-]\d{2}:\d{2}$/),
      iso8601: expect.any(String),
    });
  });

  it("rejects unknown agents with a typed outcome error", async () => {
    const runtime = buildRuntime();
    const port = createAgentToolRuntimeAdapter({
      runtime,
      fetchPermissionSet: buildAgentPermissionSetResolver(new Map()),
    });

    const result = await port.executeAction({
      actionId: "act_unknown",
      agentId: "agent.unknown",
      toolId: "system.time",
      args: {},
    });

    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.code).toBe("agent_not_registered");
    } else {
      throw new Error("expected rejected outcome");
    }
  });

  it("rejects actions against unknown Tools with a typed outcome error", async () => {
    const runtime = buildRuntime();
    const permissions = new Map([
      [
        "agent.demo",
        [
          {
            scope: "runtime" as const,
            action: "execute" as const,
            resource: "*",
          },
        ],
      ],
    ]);
    const port = createAgentToolRuntimeAdapter({
      runtime,
      fetchPermissionSet: buildAgentPermissionSetResolver(permissions),
    });

    const result = await port.executeAction({
      actionId: "act_missing",
      agentId: "agent.demo",
      toolId: "system.missing",
      args: {},
    });

    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.code).toBe("tool_not_registered");
    }
  });

  it("rejects actions when the agent lacks the required scopes", async () => {
    const runtime = createToolRuntime({
      grantedScopes: ["read.public", "execute.network"],
    });
    runtime.registry.register(createSystemTimeToolDefinition());
    runtime.registry.setStatus("system.time", "active");

    const permissions = new Map([
      [
        "agent.readonly",
        [
          {
            scope: "runtime" as const,
            action: "read" as const,
            resource: "different.tool",
          },
        ],
      ],
    ]);

    const port = new AgentToolRuntimeAdapter({
      runtime,
      fetchPermissionSet: buildAgentPermissionSetResolver(permissions),
    });

    const action: AgentToolAction = {
      actionId: "act_perm",
      agentId: "agent.readonly",
      toolId: "system.time",
      args: {},
    };
    const result = await port.executeAction(action);

    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.code).toBe("authorization_failed");
    }
  });

  it("propagates Tool Runtime execution failures as a failed outcome", async () => {
    const runtime = createToolRuntime({
      grantedScopes: ["read.public", "execute.network"],
    });
    const tool = createSystemTimeToolDefinition();
    // Override executor to fail so we can simulate runtime failures.
    runtime.registry.register({
      ...tool,
      executor: async () => {
        throw new Error("clock exploded");
      },
    });
    runtime.registry.setStatus("system.time", "active");

    const port = createAgentToolRuntimeAdapter({
      runtime,
      fetchPermissionSet: buildAgentPermissionSetResolver(
        new Map([
          [
            "agent.demo",
            [
              {
                scope: "runtime" as const,
                action: "execute" as const,
                resource: "*",
              },
            ],
          ],
        ]),
      ),
    });

    const result = await port.executeAction({
      actionId: "act_fail",
      agentId: "agent.demo",
      toolId: "system.time",
      args: {},
    });

    if (result.status === "rejected") {
      throw new Error("expected failed envelope, got rejection");
    }
    expect(result.status).toBe("failed");
    expect(result.error?.message).toBe("clock exploded");
    expect(result.error?.code).toBe("execution_failed");
    expect(result.actionId).toBe("act_fail");
  });

  it("handles cancellation flows gracefully", async () => {
    const runtime = createToolRuntime({
      grantedScopes: ["read.public", "execute.network"],
    });
    const tool = createSystemTimeToolDefinition();
    runtime.registry.register({
      ...tool,
      executor: async (
        _context: unknown,
        _args: unknown,
        signal: {
          aborted: boolean;
          onAbort?: (l: (r: string) => void) => void;
        },
      ): Promise<never> => {
        return await new Promise<never>((_resolve, reject) => {
          const onAbort = (): void => {
            reject(new Error("aborted by signal"));
          };
          if (signal.aborted) {
            reject(new Error("aborted before start"));
            return;
          }
          signal.onAbort?.(onAbort);
        });
      },
    });
    runtime.registry.setStatus("system.time", "active");

    const port = createAgentToolRuntimeAdapter({
      runtime,
      fetchPermissionSet: buildAgentPermissionSetResolver(
        new Map([
          [
            "agent.demo",
            [
              {
                scope: "runtime" as const,
                action: "execute" as const,
                resource: "*",
              },
            ],
          ],
        ]),
      ),
    });

    const result = await port.executeAction({
      actionId: "act_cancel",
      agentId: "agent.demo",
      toolId: "system.time",
      args: {},
    });

    if (result.status === "rejected") {
      throw new Error("expected cancelled envelope, got rejection");
    }
    expect(["cancelled", "failed"]).toContain(result.status);
    expect(result.actionId).toBe("act_cancel");
  });
});
