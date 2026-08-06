import {
  buildComercialTemplate,
  COMERCIAL_TEMPLATE_ID,
  createDepartmentTemplateCatalog,
  DepartmentTemplateBuilder,
  DepartmentTemplateCatalog,
  DepartmentTemplateValidationError,
  materializeTemplate,
} from "../../../src/index.js";

describe("DepartmentTemplateBuilder + Comercial template", () => {
  it("builds the Comercial template with four Digital Employees", () => {
    const template = buildComercialTemplate();
    expect(template.id).toBe(COMERCIAL_TEMPLATE_ID);
    expect(template.employees).toHaveLength(4);

    const director = template.employees.find((employee) => employee.isDirector);
    expect(director?.agentId).toBe("agent_sales_director");
    expect(director?.role).toBe("director");
  });

  it("associates Tools, Knowledge, Memory and Connected Applications", () => {
    const template = buildComercialTemplate();

    const toolIds = template.connections
      .filter((c) => c.kind === "tool")
      .map((c) => c.referenceId);
    expect(toolIds).toContain("system.health");
    expect(toolIds).toContain("organization.get");
    expect(toolIds).toContain("system.uuid");

    const knowledgeIds = template.connections
      .filter((c) => c.kind === "knowledge_collection")
      .map((c) => c.referenceId);
    expect(knowledgeIds).toContain("kcol_sales_playbook");
    expect(knowledgeIds).toContain("kcol_pricing");

    const memoryIds = template.connections
      .filter((c) => c.kind === "memory_session")
      .map((c) => c.referenceId);
    expect(memoryIds).toContain("mem_session_comercial");

    const appIds = template.connections
      .filter((c) => c.kind === "connected_application")
      .map((c) => c.referenceId);
    expect(appIds).toContain("crm_hubspot");
  });

  it("rejects templates missing a director", () => {
    expect(() =>
      DepartmentTemplateBuilder.create({
        id: "tpl_broken",
        name: "Broken",
        description: "No director",
        configuration: {
          displayName: "Broken",
          description: "No director",
          tags: [],
          metadata: {},
        },
      })
        .withEmployee({
          agentId: "agent_x",
          displayName: "X",
          role: "x",
        })
        .build(),
    ).toThrow(DepartmentTemplateValidationError);
  });

  it("rejects duplicate template ids", () => {
    const catalog: DepartmentTemplateCatalog =
      createDepartmentTemplateCatalog();
    catalog.register(buildComercialTemplate());
    expect(() => catalog.register(buildComercialTemplate())).toThrow(
      DepartmentTemplateValidationError,
    );
  });

  it("retrieves registered templates by id", () => {
    const catalog = createDepartmentTemplateCatalog();
    catalog.register(buildComercialTemplate());
    expect(catalog.has(COMERCIAL_TEMPLATE_ID)).toBe(true);
    expect(catalog.get(COMERCIAL_TEMPLATE_ID).id).toBe(COMERCIAL_TEMPLATE_ID);
    expect(catalog.tryGet("tpl_missing")).toBeNull();
  });
});

describe("DepartmentTemplateCatalog as the single composition source", () => {
  it("instantiates the Comercial template via materializeTemplate", () => {
    const catalog = createDepartmentTemplateCatalog();
    catalog.register(buildComercialTemplate());

    const { snapshot } = materializeTemplate(catalog, COMERCIAL_TEMPLATE_ID);
    expect(snapshot.status).toBe("active");
    expect(snapshot.employeeAgentIds).toHaveLength(4);
    expect(snapshot.directorAgentId).toBe("agent_sales_director");
    expect(snapshot.metrics.employeeCount).toBe(4);
    expect(snapshot.metrics.toolCount).toBeGreaterThan(0);
  });

  it("rejects unknown template ids at composition time", () => {
    const catalog = createDepartmentTemplateCatalog();
    catalog.register(buildComercialTemplate());
    expect(() => materializeTemplate(catalog, "tpl_missing")).toThrow(
      DepartmentTemplateValidationError,
    );
  });
});
