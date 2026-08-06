import {
  createDepartmentService,
  createDepartmentTemplateCatalog,
} from "@departify/departments";
import {
  BusinessProvisioningService,
  createBusinessProvisioningService,
  defaultCatalog,
} from "../../src/index.js";

describe("Business Provisioning integration", () => {
  it("runs the full Organization → Business provisioning flow end-to-end", () => {
    const catalog = defaultCatalog();
    const departmentService = createDepartmentService();
    const service = new BusinessProvisioningService({
      catalog,
      departmentService,
    });

    const result = service.instantiateBusiness(
      "prv_full_flow",
      "org_full_flow",
      "wsp_full_flow_primary",
      {
        requestedBy: "platform",
        organizationName: "Departify Full Flow",
        metadata: {
          timeZone: "Europe/Madrid",
          locale: "es-ES",
        },
      },
    );

    expect(result.templateIds).toEqual(["tpl_comercial"]);
    expect(result.departments).toHaveLength(1);

    const department = result.departments[0];
    expect(department?.status).toBe("active");
    expect(department?.employees).toHaveLength(4);
    expect(department?.directorAgentId).toBe("agent_sales_director");

    // Tools, Knowledge, Memory and Connected Applications all wired.
    expect(department?.resources.some((r) => r.kind === "tool")).toBe(true);
    expect(
      department?.resources.some((r) => r.kind === "knowledge_collection"),
    ).toBe(true);
    expect(department?.resources.some((r) => r.kind === "memory_session")).toBe(
      true,
    );
    expect(
      department?.resources.some((r) => r.kind === "connected_application"),
    ).toBe(true);

    // Issues stay empty — the catalog and template are valid.
    expect(result.issues).toEqual([]);
  });

  it("isolates failures between provisioning runs", () => {
    const catalog = createDepartmentTemplateCatalog();
    // Intentionally do NOT register any template. The provisioning should
    // report a typed issue rather than throw.
    const service = createBusinessProvisioningService({ catalog });

    const result = service.instantiateBusiness(
      "prv_failure",
      "org_failure",
      "wsp_failure",
      {
        requestedBy: "platform",
        organizationName: "Departify Failure",
      },
    );

    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "BUSINESS_TEMPLATE_MISSING" }),
    );
    expect(result.departments).toHaveLength(0);
    expect(result.templateIds).toHaveLength(0);
  });

  it("uses the canonical Comercial default catalog", () => {
    const service = createBusinessProvisioningService();
    const result = service.instantiateBusiness(
      "prv_default",
      "org_default",
      "wsp_default_primary",
      {
        requestedBy: "platform",
        organizationName: "Departify Default",
      },
    );
    expect(result.templateIds).toContain("tpl_comercial");
  });
});
