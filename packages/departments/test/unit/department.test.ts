import {
  Department,
  departmentEventTypes,
  type DepartmentEvent,
} from "../../src/index.js";

function createBaseDepartment(): Department {
  return Department.create({
    id: "dep_sales_team",
    organizationId: "org_departify",
    name: "Sales Team",
    description: "Front-line sales force",
  });
}

describe("Department aggregate", () => {
  it("creates a department with the canonical lifecycle starting at draft", () => {
    const department = createBaseDepartment();
    expect(department.getId()).toBe("dep_sales_team");
    expect(department.getStatus()).toBe("draft");
    expect(department.listEmployees()).toEqual([]);
    expect(department.getMetrics().employeeCount).toBe(0);
  });

  it("accepts multiple Digital Employees at creation", () => {
    const department = Department.create({
      id: "dep_support",
      organizationId: "org_departify",
      name: "Support",
      description: "Customer support",
      initialEmployeeAgentIds: ["agent_alice", "agent_bob", "agent_carol"],
    });

    expect(department.listEmployees()).toEqual([
      "agent_alice",
      "agent_bob",
      "agent_carol",
    ]);
    expect(department.getMetrics().employeeCount).toBe(3);
  });

  it("supports adding and removing employees after creation", () => {
    const department = createBaseDepartment();
    department.addEmployee("agent_alice");
    department.addEmployee("agent_bob");
    expect([...department.listEmployees()].sort()).toEqual([
      "agent_alice",
      "agent_bob",
    ]);
    department.removeEmployee("agent_alice");
    expect(department.listEmployees()).toEqual(["agent_bob"]);
  });

  it("emits events on lifecycle transitions", () => {
    const department = createBaseDepartment();
    department.activate();
    department.pause();
    department.archive();

    const events = department.pullDepartmentEvents();
    const lifecycleEvents = events
      .map((event: DepartmentEvent) => event.type)
      .filter((type) => type.startsWith("department."))
      .filter(
        (type) =>
          type === "department.activated" ||
          type === "department.paused" ||
          type === "department.archived",
      );
    expect(lifecycleEvents).toEqual([
      "department.activated",
      "department.paused",
      "department.archived",
    ]);
  });

  it("rejects lifecycle transitions out of archived", () => {
    const department = createBaseDepartment();
    department.archive();
    expect(() => department.activate()).toThrow(/illegal/i);
    expect(() => department.pause()).toThrow(/illegal/i);
  });

  it("associates and dissociates tools", () => {
    const department = createBaseDepartment();
    department.associateTool("system.health");
    department.associateTool("organization.get");
    expect([...department.listTools()].sort()).toEqual([
      "organization.get",
      "system.health",
    ]);
    expect(department.getMetrics().toolCount).toBe(2);

    department.dissociateTool("system.health");
    expect(department.listTools()).toEqual(["organization.get"]);
    expect(department.getMetrics().toolCount).toBe(1);
  });

  it("associates knowledge collections and memory sessions", () => {
    const department = createBaseDepartment();
    department.associateKnowledgeCollection("kcol_playbook");
    department.associateMemorySession("mem_session_001");
    expect(department.listKnowledgeCollections()).toEqual(["kcol_playbook"]);
    expect(department.listMemorySessions()).toEqual(["mem_session_001"]);

    department.dissociateKnowledgeCollection("kcol_playbook");
    expect(department.listKnowledgeCollections()).toEqual([]);
  });

  it("rejects duplicate associations without erroring", () => {
    const department = createBaseDepartment();
    department.associateTool("system.health");
    department.associateTool("system.health");
    expect(department.listTools()).toEqual(["system.health"]);
  });

  it("rejects configuration mutations when archived", () => {
    const department = createBaseDepartment();
    department.archive();
    expect(() => department.rename("Renamed")).toThrow(/archived/i);
    expect(() => department.addEmployee("agent_alice")).toThrow(/archived/i);
  });
});

describe("Department event types", () => {
  it("exposes the canonical Sprint 24 taxonomy", () => {
    expect(departmentEventTypes).toContain("department.created");
    expect(departmentEventTypes).toContain("department.activated");
    expect(departmentEventTypes).toContain("department.paused");
    expect(departmentEventTypes).toContain("department.archived");
    expect(departmentEventTypes).toContain("department.employee_added");
    expect(departmentEventTypes).toContain("department.employee_removed");
    expect(departmentEventTypes).toContain("department.tool_associated");
    expect(departmentEventTypes).toContain("department.knowledge_associated");
    expect(departmentEventTypes).toContain("department.memory_associated");
    expect(departmentEventTypes).toContain("department.director_assigned");
  });
});
