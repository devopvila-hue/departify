import { AgentRegistry } from "@departify/agent-runtime";
import {
  AgentToolRuntimeAdapter,
  buildAgentPermissionSetResolver,
} from "@departify/agent-tool-bridge";
import { buildEmptyCompanyDNA } from "@departify/business-discovery";
import { ExecutiveDirector } from "@departify/executive-director";
import { Organization } from "@departify/organization-domain";
import {
  createToolRuntime,
  ToolRegistry as ToolRuntimeRegistry,
} from "@departify/tool-runtime";
import {
  CORE_CATALOG_IDS,
  registerAllCoreTools,
  type CoreCatalogContext,
} from "@departify/tool-catalog";
import {
  createExecutiveOrchestrator,
  type OrchestratorIntent,
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
 * End-to-end integration: Executive Director → orchestrator → bridge →
 * Tool Runtime → Core Tool Catalog. Wires every layer using existing public
 * contracts; no IA, no LLM Router, no HTTP.
 */
describe("Executive Director ↔ Tool Runtime end-to-end orchestration", () => {
  it("dispatches a health_check through system.health", async () => {
    const catalogContext: CoreCatalogContext = {};
    const toolRegistry = new ToolRuntimeRegistry();
    registerAllCoreTools(toolRegistry, catalogContext);

    const runtime = createToolRuntime({
      grantedScopes: ["read.public"],
    });
    for (const entry of toolRegistry.list()) {
      runtime.registry.register(entry.definition);
      runtime.registry.setStatus(entry.definition.id, "active");
    }

    const agentRegistry = new AgentRegistry();
    agentRegistry.register({
      id: "agent.executive",
      organizationId: "org_departify",
      displayName: "Executive Agent",
      role: "orchestrator",
    });

    const permissions = new Map([
      [
        "agent.executive",
        [
          {
            scope: "runtime" as const,
            action: "execute" as const,
            resource: "*",
          },
        ],
      ],
    ]);

    const bridge = new AgentToolRuntimeAdapter({
      runtime,
      fetchPermissionSet: buildAgentPermissionSetResolver(permissions),
    });

    const orchestrator = createExecutiveOrchestrator({
      director: new ExecutiveDirector(),
      bridge,
    });

    const result = await orchestrator.orchestrateHealthCheck({
      type: "health_check",
      intentId: "intent_health_integration_001",
      requestedBy: "tester",
    });

    expect(result.tool.toolId).toBe("system.health");
    expect(result.tool.status).toBe("completed");
    expect(result.intentId).toBe("intent_health_integration_001");
    expect(result.decisionId).toBe("dec_intent_health_integration_001");
    expect(result.actionId).toBe("act_dec_intent_health_integration_001");
    expect(result.error).toBeNull();
    expect(result.output).toMatchObject({
      runtime: expect.any(Object),
      router: expect.any(Object),
    });
  });

  it("dispatches organization_summary through organization.get", async () => {
    const organization = buildOrganization();
    const catalogContext: CoreCatalogContext = {
      organizationResolver: {
        resolve: () => ({ organization, snapshot: organization.toSnapshot() }),
      },
    };
    const toolRegistry = new ToolRuntimeRegistry();
    registerAllCoreTools(toolRegistry, catalogContext);

    const runtime = createToolRuntime({
      grantedScopes: ["read.public", "read.private"],
    });
    for (const entry of toolRegistry.list()) {
      runtime.registry.register(entry.definition);
      runtime.registry.setStatus(entry.definition.id, "active");
    }

    const permissions = new Map([
      [
        "agent.executive",
        [
          {
            scope: "runtime" as const,
            action: "manage" as const,
            resource: "*",
          },
        ],
      ],
    ]);

    const bridge = new AgentToolRuntimeAdapter({
      runtime,
      fetchPermissionSet: buildAgentPermissionSetResolver(permissions),
    });

    const orchestrator = createExecutiveOrchestrator({
      director: new ExecutiveDirector(),
      bridge,
    });

    const result = await orchestrator.orchestrateOrganizationSummary({
      type: "organization_summary",
      intentId: "intent_org_summary_001",
      requestedBy: "tester",
      organizationId: "org_departify",
    });

    expect(result.tool.toolId).toBe("organization.get");
    expect(result.tool.status).toBe("completed");
    expect(
      (result.output as { organization: { id: string } } | null)?.organization
        .id,
    ).toBe("org_departify");
  });

  it("dispatches generate_identifier through system.uuid", async () => {
    const toolRegistry = new ToolRuntimeRegistry();
    registerAllCoreTools(toolRegistry, {});

    const runtime = createToolRuntime({
      grantedScopes: ["read.public"],
    });
    for (const entry of toolRegistry.list()) {
      runtime.registry.register(entry.definition);
      runtime.registry.setStatus(entry.definition.id, "active");
    }

    const permissions = new Map([
      [
        "agent.executive",
        [
          {
            scope: "runtime" as const,
            action: "execute" as const,
            resource: "*",
          },
        ],
      ],
    ]);

    const bridge = new AgentToolRuntimeAdapter({
      runtime,
      fetchPermissionSet: buildAgentPermissionSetResolver(permissions),
    });

    const orchestrator = createExecutiveOrchestrator({
      director: new ExecutiveDirector(),
      bridge,
    });

    const result = await orchestrator.orchestrate({
      type: "generate_identifier",
      intentId: "intent_uuid_integration_001",
      requestedBy: "tester",
    } as OrchestratorIntent);

    expect(result.tool.toolId).toBe("system.uuid");
    expect(result.tool.status).toBe("completed");
    expect(result.intentId).toBe("intent_uuid_integration_001");
    expect(result.decisionId).toBe("dec_intent_uuid_integration_001");
  });

  it("dispatches discovery_analyze through discovery.analyze end-to-end", async () => {
    const catalogContext: CoreCatalogContext = {};
    const toolRegistry = new ToolRuntimeRegistry();
    registerAllCoreTools(toolRegistry, catalogContext);

    const runtime = createToolRuntime({
      grantedScopes: ["read.public", "read.private"],
    });
    for (const entry of toolRegistry.list()) {
      runtime.registry.register(entry.definition);
      runtime.registry.setStatus(entry.definition.id, "active");
    }

    const agentRegistry = new AgentRegistry();
    agentRegistry.register({
      id: "agent.executive",
      organizationId: "org_departify",
      displayName: "Executive Agent",
      role: "orchestrator",
    });

    const permissions = new Map([
      [
        "agent.executive",
        [
          {
            scope: "runtime" as const,
            action: "manage" as const,
            resource: "*",
          },
        ],
      ],
    ]);

    const bridge = new AgentToolRuntimeAdapter({
      runtime,
      fetchPermissionSet: buildAgentPermissionSetResolver(permissions),
    });

    const orchestrator = createExecutiveOrchestrator({
      director: new ExecutiveDirector(),
      bridge,
    });

    const result = await orchestrator.orchestrateDiscoveryAnalyze({
      type: "discovery_analyze",
      intentId: "intent_discovery_integration_001",
      requestedBy: "tester",
      organizationId: "org_departify",
      toolArgs: { companyDna: buildEmptyCompanyDNA("org_departify") },
    });

    expect(result.tool.toolId).toBe("discovery.analyze");
    expect(result.tool.status).toBe("completed");
    expect(result.intentId).toBe("intent_discovery_integration_001");
    expect(result.decisionId).toBe("dec_intent_discovery_integration_001");
    expect(result.actionId).toBe(
      "act_dec_intent_discovery_integration_001",
    );
    expect(result.error).toBeNull();
    const output = result.output as {
      gaps: { gaps: unknown[] };
      questions: unknown[];
      completeness: { overall: number };
    };
    expect(output.gaps.gaps.length).toBeGreaterThan(0);
    expect(output.questions.length).toBeGreaterThan(0);
    expect(output.completeness.overall).toBe(0);
  });

  it("supports permission denial through the orchestrator", async () => {
    const toolRegistry = new ToolRuntimeRegistry();
    registerAllCoreTools(toolRegistry, {});

    const runtime = createToolRuntime({
      grantedScopes: ["read.public"],
    });
    for (const entry of toolRegistry.list()) {
      runtime.registry.register(entry.definition);
      runtime.registry.setStatus(entry.definition.id, "active");
    }

    const permissions = new Map([
      [
        "agent.no_scope",
        [
          {
            scope: "runtime" as const,
            action: "read" as const,
            resource: "different.tool",
          },
        ],
      ],
    ]);

    const bridge = new AgentToolRuntimeAdapter({
      runtime,
      fetchPermissionSet: buildAgentPermissionSetResolver(permissions),
    });

    const orchestrator = createExecutiveOrchestrator({
      director: new ExecutiveDirector(),
      bridge,
    });

    const result = await orchestrator.orchestrateHealthCheck({
      type: "health_check",
      intentId: "intent_health_denied_001",
      requestedBy: "tester",
    });

    expect(result.tool.status).toBe("rejected");
    expect(result.error?.phase).toBe("bridge");
  });

  it("exposes the canonical catalog ids used by the orchestrator", () => {
    expect(CORE_CATALOG_IDS).toContain("system.health");
    expect(CORE_CATALOG_IDS).toContain("organization.get");
    expect(CORE_CATALOG_IDS).toContain("system.uuid");
    expect(CORE_CATALOG_IDS).toContain("discovery.analyze");
  });
});
