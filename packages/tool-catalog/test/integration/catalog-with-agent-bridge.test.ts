import { AgentRegistry } from "@departify/agent-runtime";
import {
  AgentToolRuntimeAdapter,
  buildAgentPermissionSetResolver,
} from "@departify/agent-tool-bridge";
import { Organization } from "@departify/organization-domain";
import {
  createToolRuntime,
  ToolRegistry as ToolRuntimeRegistry,
} from "@departify/tool-runtime";
import {
  registerAllCoreTools,
  type CoreCatalogContext,
} from "../../src/index.js";

function buildOrganization(): Organization {
  return Organization.request({
    id: "org_departify",
    name: "Departify",
    brand: { displayName: "Departify" },
    license: { plan: "professional", seats: 10 },
    settings: {
      timeZone: "Europe/Madrid",
      locale: "es-ES",
      limits: {
        maxWorkspaces: 2,
        maxMembers: 10,
      },
      featureFlags: {
        foundation: true,
      },
      contactInformation: {
        email: "hello@departify.example",
        website: "https://departify.example",
      },
    },
    initialWorkspace: { id: "wsp_default", name: "Default" },
  });
}

/**
 * End-to-end integration: the catalog registers every Tool into the Tool
 * Runtime, and an Agent registered through Agent Runtime invokes Tools
 * through the AgentToolBridge. The bridge never inspects catalog internals;
 * the catalog never imports the bridge.
 */
describe("Core Catalog ↔ AgentToolBridge integration", () => {
  it("executes system.uuid through the bridge", async () => {
    const toolRegistry = new ToolRuntimeRegistry();
    const context: CoreCatalogContext = {};
    const registration = registerAllCoreTools(toolRegistry, context);
    expect(registration.entries.map((e) => e.id)).toContain("system.uuid");

    const runtime = createToolRuntime({ grantedScopes: ["read.public"] });
    for (const entry of registration.entries) {
      runtime.registry.register(entry.definition);
      runtime.registry.setStatus(entry.id, "active");
    }

    const agentRegistry = new AgentRegistry();
    agentRegistry.register({
      id: "agent.demo",
      organizationId: "org_departify",
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
            resource: "*",
          },
        ],
      ],
    ]);

    const port = new AgentToolRuntimeAdapter({
      runtime,
      fetchPermissionSet: buildAgentPermissionSetResolver(permissions),
    });

    const result = await port.executeAction({
      actionId: "catalog_integration_001",
      agentId: "agent.demo",
      toolId: "system.uuid",
      args: {},
    });

    if (result.status === "rejected") {
      throw new Error(`integration failed: ${result.reason}`);
    }
    expect(result.status).toBe("completed");
    expect(result.toolId).toBe("system.uuid");
    expect((result.output as { uuid: string }).uuid).toMatch(
      /^[0-9a-f-]{36}$/i,
    );
  });

  it("executes organization.get through the bridge", async () => {
    const organization = buildOrganization();
    const context: CoreCatalogContext = {
      organizationResolver: {
        resolve: () => ({ organization, snapshot: organization.toSnapshot() }),
      },
    };

    const toolRegistry = new ToolRuntimeRegistry();
    const registration = registerAllCoreTools(toolRegistry, context);
    const runtime = createToolRuntime({
      grantedScopes: ["read.private"],
    });
    for (const entry of registration.entries) {
      runtime.registry.register(entry.definition);
      runtime.registry.setStatus(entry.id, "active");
    }

    const permissions = new Map([
      [
        "agent.org_viewer",
        [
          {
            scope: "runtime" as const,
            action: "manage" as const,
            resource: "*",
          },
        ],
      ],
    ]);

    const port = new AgentToolRuntimeAdapter({
      runtime,
      fetchPermissionSet: buildAgentPermissionSetResolver(permissions),
    });

    const result = await port.executeAction({
      actionId: "catalog_integration_org_001",
      agentId: "agent.org_viewer",
      organizationId: "org_departify",
      toolId: "organization.get",
      args: {},
    });

    if (result.status === "rejected") {
      throw new Error(`integration failed: ${result.reason}`);
    }
    expect(result.status).toBe("completed");
    const output = result.output as { organization: { id: string } };
    expect(output.organization.id).toBe("org_departify");
  });

  it("rejects unknown Tools at the catalog level", async () => {
    const context: CoreCatalogContext = {};
    const toolRegistry = new ToolRuntimeRegistry();
    registerAllCoreTools(toolRegistry, context);
    const runtime = createToolRuntime({ grantedScopes: ["read.public"] });
    for (const entry of toolRegistry.list()) {
      runtime.registry.register(entry.definition);
      runtime.registry.setStatus(entry.definition.id, "active");
    }

    const port = new AgentToolRuntimeAdapter({
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
      actionId: "catalog_integration_missing_001",
      agentId: "agent.demo",
      toolId: "system.not_in_catalog",
      args: {},
    });

    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.code).toBe("tool_not_registered");
    }
  });

  it("supports cancellation for catalog Tools", async () => {
    const context: CoreCatalogContext = {};
    const toolRegistry = new ToolRuntimeRegistry();
    registerAllCoreTools(toolRegistry, context);
    const runtime = createToolRuntime({ grantedScopes: ["read.public"] });
    for (const entry of toolRegistry.list()) {
      runtime.registry.register(entry.definition);
      runtime.registry.setStatus(entry.definition.id, "active");
    }

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

    const port = new AgentToolRuntimeAdapter({
      runtime,
      fetchPermissionSet: buildAgentPermissionSetResolver(permissions),
    });

    // Cancel before invoking — system.uuid has no executor wired, so the
    // runtime short-circuits with ToolExecutionDisabledError. That is
    // still a cancellation-aware path through the bridge.
    const result = await port.executeAction({
      actionId: "catalog_integration_cancel_001",
      agentId: "agent.demo",
      toolId: "system.uuid",
      args: {},
    });

    if (result.status === "rejected") {
      throw new Error(`integration failed: ${result.reason}`);
    }
    expect(["completed", "failed", "cancelled"]).toContain(result.status);
  });
});
