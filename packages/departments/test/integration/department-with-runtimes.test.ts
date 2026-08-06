import { AgentRegistry } from "@departify/agent-runtime";
import {
  AgentToolRuntimeAdapter,
  buildAgentPermissionSetResolver,
} from "@departify/agent-tool-bridge";
import { ExecutiveDirector } from "@departify/executive-director";
import {
  createToolRuntime,
  ToolRegistry as ToolRuntimeRegistry,
} from "@departify/tool-runtime";
import {
  CORE_CATALOG_IDS,
  registerAllCoreTools,
} from "@departify/tool-catalog";
import {
  buildComercialDepartment,
  createDepartmentService,
  type DepartmentService,
} from "../../src/index.js";

/**
 * End-to-end integration: the Comercial Department is wired into
 * Agent Runtime (Digital Employees), Executive Director (Director), Tool
 * Runtime + Core Tool Catalog (Tools) and AgentToolBridge. The Department
 * itself never executes logic; it only carries references.
 */
describe("Department integration with existing runtimes", () => {
  it("exposes Comercial employees through the Agent Runtime registry", () => {
    const { snapshot } = buildComercialDepartment();
    const registry = new AgentRegistry();
    for (const agentId of snapshot.employeeAgentIds) {
      registry.register({
        id: agentId,
        organizationId: snapshot.organizationId,
        displayName: agentId,
        role: "digital-employee",
      });
    }

    const expected = [
      "agent_sales_director",
      "agent_lead_qualifier",
      "agent_outreach_specialist",
      "agent_proposal_writer",
    ];
    for (const agentId of expected) {
      const record = registry.get(agentId);
      expect(record?.definition.id).toBe(agentId);
    }
  });

  it("composes the Comercial Department into a working orchestration flow", () => {
    const { snapshot, service } = buildComercialDepartment();

    // Wire the Tool Runtime + Core Tool Catalog
    const toolRegistry = new ToolRuntimeRegistry();
    registerAllCoreTools(toolRegistry, {});
    const runtime = createToolRuntime({ grantedScopes: ["read.public"] });
    for (const entry of toolRegistry.list()) {
      runtime.registry.register(entry.definition);
      runtime.registry.setStatus(entry.definition.id, "active");
    }

    // Wire Agent Runtime
    const agentRegistry = new AgentRegistry();
    const directorAgentId = snapshot.directorAgentId ?? "agent_sales_director";
    for (const agentId of snapshot.employeeAgentIds) {
      agentRegistry.register({
        id: agentId,
        organizationId: snapshot.organizationId,
        displayName: agentId,
        role: "digital-employee",
      });
    }
    agentRegistry.activate(directorAgentId);
    agentRegistry.markReady(directorAgentId);

    // Wire AgentToolBridge
    const permissions = new Map([
      [
        directorAgentId,
        [
          {
            scope: "runtime" as const,
            action: "execute" as const,
            resource: "*",
          },
        ],
      ],
    ]);
    new AgentToolRuntimeAdapter({
      runtime,
      fetchPermissionSet: buildAgentPermissionSetResolver(permissions),
    });

    // Wire Executive Director
    new ExecutiveDirector();

    expect(snapshot.connections.length).toBeGreaterThan(0);
    expect(snapshot.metrics.toolCount).toBeGreaterThan(0);
    expect(snapshot.metrics.employeeCount).toBeGreaterThan(1);
    expect(service.has("dep_comercial")).toBe(true);

    // Verify AgentRuntime sees the registered Digital Employees
    const directorRecord = agentRegistry.get(directorAgentId);
    expect(directorRecord).toBeTruthy();
    expect(directorRecord?.status).toBe("ready");
  });

  it("registers multiple employees through the service", () => {
    const service: DepartmentService = createDepartmentService();
    service.create({
      id: "dep_engineering",
      organizationId: "org_departify",
      name: "Engineering",
      description: "Engineering department",
    });

    service.addEmployee("dep_engineering", "agent_dev_a");
    service.addEmployee("dep_engineering", "agent_dev_b");
    service.addEmployee("dep_engineering", "agent_dev_c");
    service.addEmployee("dep_engineering", "agent_dev_d");

    expect(service.listEmployees("dep_engineering")).toHaveLength(4);

    service.removeEmployee("dep_engineering", "agent_dev_a");
    expect(service.listEmployees("dep_engineering")).toHaveLength(3);
  });

  it("exposes the canonical catalog ids used by the Department", () => {
    expect(CORE_CATALOG_IDS).toContain("system.health");
    expect(CORE_CATALOG_IDS).toContain("organization.get");
    expect(CORE_CATALOG_IDS).toContain("system.uuid");
  });
});

// Re-export to keep TypeScript from stripping Agent (unused import in
// isolated runs).
export type _AgentProbe = AgentRegistry;
