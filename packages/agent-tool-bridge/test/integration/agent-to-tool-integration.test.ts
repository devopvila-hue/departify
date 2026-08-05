import { AgentRegistry } from "@departify/agent-runtime";
import {
  AgentToolRuntimeAdapter,
  buildAgentPermissionSetResolver,
  createSystemTimeToolDefinition,
} from "../../src/index.js";
import { createToolRuntime, type ToolRuntime } from "@departify/tool-runtime";

/**
 * End-to-end integration test: an Agent is registered through
 * `AgentRegistry`, the bridge looks up its permissions, and the Agent
 * invokes the demonstration `system.time` Tool through the Tool Runtime.
 *
 * No modification to either runtime: the bridge connects them purely
 * through their public contracts.
 */
describe("Agent Runtime ↔ Tool Runtime integration", () => {
  it("executes system.time end-to-end and returns a typed result", async () => {
    const runtime: ToolRuntime = createToolRuntime({
      grantedScopes: ["read.public", "execute.network"],
    });
    runtime.registry.register(createSystemTimeToolDefinition());
    runtime.registry.setStatus("system.time", "active");

    const agentRegistry = new AgentRegistry();
    agentRegistry.register({
      id: "agent.demo",
      organizationId: "org_1",
      displayName: "Demo Agent",
      role: "coordinator",
    });

    const permissions = new Map([
      [
        "agent.demo",
        [
          {
            scope: "runtime" as const,
            action: "execute" as const,
            resource: "system.time",
          },
        ],
      ],
    ]);

    const fetchPermissions = (
      agentId: string,
    ): ReturnType<typeof buildAgentPermissionSetResolver> extends (
      ...args: never
    ) => infer R
      ? R
      : never => {
      const lookup = buildAgentPermissionSetResolver(permissions);
      return lookup(agentId) as never;
    };

    const port = new AgentToolRuntimeAdapter({
      runtime,
      fetchPermissionSet: fetchPermissions as never,
    });

    const agentRecord = agentRegistry.get("agent.demo");
    expect(agentRecord).not.toBeNull();
    expect(agentRecord?.status).toBe("registered");

    const organizationId = agentRecord?.definition.organizationId;

    const result = await port.executeAction({
      actionId: "integration_001",
      agentId: "agent.demo",
      ...(organizationId ? { organizationId } : {}),
      toolId: "system.time",
      args: {},
      metadata: { correlation: "integration-test" },
    });

    if (result.status === "rejected") {
      throw new Error(`integration failed: ${result.reason}`);
    }
    expect(result.status).toBe("completed");
    expect(result.toolId).toBe("system.time");
    expect(result.requestId).toBe("integration_001");
    expect(result.output).toMatchObject({
      timestamp: expect.any(Number),
      timezone: expect.stringMatching(/^UTC[+-]\d{2}:\d{2}$/),
      iso8601: expect.any(String),
    });
  });

  it("integrates a registered Agent lifecycle with the Tool Runtime", async () => {
    const runtime = createToolRuntime({
      grantedScopes: ["read.public", "execute.network"],
    });
    runtime.registry.register(createSystemTimeToolDefinition());
    runtime.registry.setStatus("system.time", "active");

    const agentRegistry = new AgentRegistry();
    agentRegistry.register({
      id: "agent.lifecycle",
      organizationId: "org_2",
      displayName: "Lifecycle Agent",
      role: "assistant",
    });
    agentRegistry.activate("agent.lifecycle");
    agentRegistry.markReady("agent.lifecycle");

    const port = new AgentToolRuntimeAdapter({
      runtime,
      fetchPermissionSet: buildAgentPermissionSetResolver(
        new Map([
          [
            "agent.lifecycle",
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

    const record = agentRegistry.get("agent.lifecycle");
    expect(record?.status).toBe("ready");

    const result = await port.executeAction({
      actionId: "integration_lifecycle_001",
      agentId: "agent.lifecycle",
      toolId: "system.time",
      args: {},
    });

    if (result.status === "rejected") {
      throw new Error(`integration failed: ${result.reason}`);
    }
    expect(result.status).toBe("completed");
  });
});
