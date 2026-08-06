import {
  buildMarketingTemplate,
  MARKETING_TEMPLATE_ID,
  createDepartmentTemplateCatalog,
  materializeTemplate,
} from "../../../src/index.js";

describe("Marketing template (Customer Zero)", () => {
  it("builds the Marketing template with three Digital Employees and a director", () => {
    const template = buildMarketingTemplate();
    expect(template.id).toBe(MARKETING_TEMPLATE_ID);
    expect(template.employees).toHaveLength(4);

    const director = template.employees.find((employee) => employee.isDirector);
    expect(director?.agentId).toBe("agent_marketing_director");
    expect(director?.role).toBe("director");

    const agentIds = template.employees.map((employee) => employee.agentId);
    expect(agentIds).toContain("agent_content_strategist");
    expect(agentIds).toContain("agent_social_media_manager");
    expect(agentIds).toContain("agent_ads_specialist");
  });

  it("associates Tools, Knowledge, Memory and Connected Applications", () => {
    const template = buildMarketingTemplate();

    const toolIds = template.connections
      .filter((c) => c.kind === "tool")
      .map((c) => c.referenceId);
    expect(toolIds).toContain("system.health");
    expect(toolIds).toContain("organization.get");
    expect(toolIds).toContain("system.uuid");

    const knowledgeIds = template.connections
      .filter((c) => c.kind === "knowledge_collection")
      .map((c) => c.referenceId);
    expect(knowledgeIds).toContain("kcol_marketing_playbook");
    expect(knowledgeIds).toContain("kcol_brand");

    const memoryIds = template.connections
      .filter((c) => c.kind === "memory_session")
      .map((c) => c.referenceId);
    expect(memoryIds).toContain("mem_session_marketing");

    const appIds = template.connections
      .filter((c) => c.kind === "connected_application")
      .map((c) => c.referenceId);
    expect(appIds).toContain("crm_hubspot");
  });

  it("registers in the template catalog", () => {
    const catalog = createDepartmentTemplateCatalog();
    catalog.register(buildMarketingTemplate());
    expect(catalog.has(MARKETING_TEMPLATE_ID)).toBe(true);
    expect(catalog.get(MARKETING_TEMPLATE_ID).id).toBe(MARKETING_TEMPLATE_ID);
    expect(catalog.size()).toBe(1);
  });

  it("instantiates the Marketing department via materializeTemplate", () => {
    const catalog = createDepartmentTemplateCatalog();
    catalog.register(buildMarketingTemplate());

    const { snapshot } = materializeTemplate(catalog, MARKETING_TEMPLATE_ID);
    expect(snapshot.status).toBe("active");
    expect(snapshot.directorAgentId).toBe("agent_marketing_director");
    expect(snapshot.employeeAgentIds).toHaveLength(4);
    expect(snapshot.metrics.employeeCount).toBe(4);
    expect(snapshot.metrics.toolCount).toBeGreaterThan(0);
  });
});
