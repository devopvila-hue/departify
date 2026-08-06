import {
  buildComercialDepartment,
  createDepartmentService,
} from "../../src/index.js";

describe("Comercial demo department", () => {
  it("creates the canonical Comercial department with multiple employees", () => {
    const { snapshot } = buildComercialDepartment();

    expect(snapshot.id).toBe("dep_comercial");
    expect(snapshot.name).toBe("Comercial");
    expect(snapshot.status).toBe("active");
    expect([...snapshot.employeeAgentIds].sort()).toEqual([
      "agent_lead_qualifier",
      "agent_outreach_specialist",
      "agent_proposal_writer",
      "agent_sales_director",
    ]);
    expect(snapshot.directorAgentId).toBe("agent_sales_director");
    expect(snapshot.metrics.employeeCount).toBe(4);
  });

  it("associates the canonical tools, knowledge and memory", () => {
    const { snapshot } = buildComercialDepartment();

    expect(snapshot.metrics.toolCount).toBe(3);
    expect(snapshot.metrics.knowledgeCollectionCount).toBe(2);
    expect(snapshot.metrics.memorySessionCount).toBe(1);
    expect(snapshot.metrics.connectedApplicationCount).toBe(1);
  });

  it("attaches the Lead Qualification Workflow by default", () => {
    const { snapshot } = buildComercialDepartment();
    expect(snapshot.workflowIds).toContain("wf_lead_qualification");
  });

  it("returns the same shape from a freshly built service", () => {
    const { service, snapshot } = buildComercialDepartment();
    const refreshed = service.get("dep_comercial").toSnapshot();
    expect(refreshed.id).toBe(snapshot.id);
    expect(refreshed.metrics).toEqual(snapshot.metrics);
  });

  it("supports manual composition alongside the demo fixture", () => {
    const service = createDepartmentService();
    service.create({
      id: "dep_engineering",
      organizationId: "org_departify",
      name: "Engineering",
      description: "Engineering department",
      initialEmployeeAgentIds: ["agent_dev_a", "agent_dev_b"],
      initialConnections: [{ kind: "tool", referenceId: "system.health" }],
    });

    const department = service.get("dep_engineering");
    expect([...department.listEmployees()].sort()).toEqual([
      "agent_dev_a",
      "agent_dev_b",
    ]);
    expect(department.listTools()).toEqual(["system.health"]);
  });
});
