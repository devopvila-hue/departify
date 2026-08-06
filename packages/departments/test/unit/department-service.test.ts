import { createDepartmentService, DepartmentService } from "../../src/index.js";

function makeBaseInput() {
  return {
    id: "dep_comercial",
    organizationId: "org_departify",
    name: "Comercial",
    description: "Customer-facing sales department",
    configuration: {
      displayName: "Comercial",
      description: "Sales motion",
      tags: ["sales"],
      metadata: { locale: "es-ES" },
    },
  };
}

describe("DepartmentService", () => {
  it("creates and retrieves a Department", () => {
    const service: DepartmentService = createDepartmentService();
    const department = service.create(makeBaseInput());

    expect(service.has("dep_comercial")).toBe(true);
    expect(service.get("dep_comercial").getId()).toBe("dep_comercial");
    expect(department.getStatus()).toBe("draft");
  });

  it("supports adding and removing multiple employees", () => {
    const service = createDepartmentService();
    service.create(makeBaseInput());
    service.addEmployee("dep_comercial", "agent_alice");
    service.addEmployee("dep_comercial", "agent_bob");
    service.addEmployee("dep_comercial", "agent_carol");
    expect([...service.listEmployees("dep_comercial")].sort()).toEqual([
      "agent_alice",
      "agent_bob",
      "agent_carol",
    ]);
    service.removeEmployee("dep_comercial", "agent_bob");
    expect([...service.listEmployees("dep_comercial")].sort()).toEqual([
      "agent_alice",
      "agent_carol",
    ]);
  });

  it("supports associating and dissociating tools, knowledge and memory", () => {
    const service = createDepartmentService();
    service.create(makeBaseInput());
    service.associateTool("dep_comercial", "system.health");
    service.associateTool("dep_comercial", "organization.get");
    service.associateKnowledgeCollection(
      "dep_comercial",
      "kcol_sales_playbook",
    );
    service.associateMemorySession("dep_comercial", "mem_session_001");

    const department = service.get("dep_comercial");
    expect([...department.listTools()].sort()).toEqual([
      "organization.get",
      "system.health",
    ]);
    expect(department.listKnowledgeCollections()).toEqual([
      "kcol_sales_playbook",
    ]);
    expect(department.listMemorySessions()).toEqual(["mem_session_001"]);

    service.dissociateTool("dep_comercial", "system.health");
    service.dissociateKnowledgeCollection(
      "dep_comercial",
      "kcol_sales_playbook",
    );
    service.dissociateMemorySession("dep_comercial", "mem_session_001");

    expect(department.listTools()).toEqual(["organization.get"]);
    expect(department.listKnowledgeCollections()).toEqual([]);
    expect(department.listMemorySessions()).toEqual([]);
  });

  it("supports lifecycle operations through the service", () => {
    const service = createDepartmentService();
    service.create(makeBaseInput());
    service.activate("dep_comercial");
    expect(service.get("dep_comercial").getStatus()).toBe("active");
    service.pause("dep_comercial");
    expect(service.get("dep_comercial").getStatus()).toBe("paused");
    service.assignDirector("dep_comercial", "agent_sales_director");
    expect(service.get("dep_comercial").getDirectorAgentId()).toBe(
      "agent_sales_director",
    );
    service.archive("dep_comercial");
    expect(service.get("dep_comercial").getStatus()).toBe("archived");
  });

  it("returns a typed snapshot per department", () => {
    const service = createDepartmentService();
    service.create(makeBaseInput());
    const list = service.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe("dep_comercial");
    expect(list[0]?.status).toBe("draft");
  });

  it("rejects duplicate registration", () => {
    const service = createDepartmentService();
    service.create(makeBaseInput());
    expect(() => service.create(makeBaseInput())).toThrow(/already exists/i);
  });

  it("throws when retrieving an unknown department", () => {
    const service = createDepartmentService();
    expect(() => service.get("dep_unknown")).toThrow(/not registered/i);
  });
});
