import {
  buildComercialTemplate,
  createDepartmentService,
  createDepartmentTemplateCatalog,
} from "@departify/departments";
import type { OrganizationProvisioningRequest } from "@departify/provisioning-engine";
import {
  BusinessProvisioningService,
  createBusinessProvisioningService,
  defaultCatalog,
} from "../../src/index.js";

function makeRequest(
  overrides: Partial<OrganizationProvisioningRequest> = {},
): OrganizationProvisioningRequest {
  return {
    requestedBy: "tester",
    organizationName: "Departify Test",
    metadata: {
      timeZone: "Europe/Madrid",
      locale: "es-ES",
    },
    ...overrides,
  };
}

describe("BusinessProvisioningService", () => {
  it("instantiates the Comercial department from the default catalog", () => {
    const service = createBusinessProvisioningService();
    const result = service.instantiateBusiness(
      "prv_test_001",
      "org_departify_test",
      "wsp_departify_test_primary",
      makeRequest(),
    );

    expect(result.provisioningId).toBe("prv_test_001");
    expect(result.organizationId).toBe("org_departify_test");
    expect(result.templateIds).toContain("tpl_comercial");
    expect(result.departments).toHaveLength(1);

    const department = result.departments[0];
    expect(department?.templateId).toBe("tpl_comercial");
    expect(department?.status).toBe("active");
    expect(department?.directorAgentId).toBe("agent_sales_director");
    expect(department?.employees).toHaveLength(4);
    expect(department?.resources.length).toBeGreaterThan(0);

    const toolResources = department?.resources.filter(
      (r) => r.kind === "tool",
    );
    expect(toolResources?.length).toBe(3);
  });

  it("is idempotent — re-running yields the same outcome", () => {
    const catalog = createDepartmentTemplateCatalog();
    catalog.register(buildComercialTemplate());

    const departmentService = createDepartmentService();
    const service = new BusinessProvisioningService({
      catalog,
      departmentService,
    });

    const first = service.instantiateBusiness(
      "prv_idempotent",
      "org_idem",
      "wsp_idem",
      makeRequest(),
    );
    const second = service.instantiateBusiness(
      "prv_idempotent",
      "org_idem",
      "wsp_idem",
      makeRequest(),
    );

    expect(first.departments).toHaveLength(1);
    expect(second.departments).toHaveLength(1);
    expect(first.departments[0]?.departmentId).toBe(
      second.departments[0]?.departmentId,
    );
  });

  it("supports custom DepartmentTemplateId from request", () => {
    const catalog = createDepartmentTemplateCatalog();
    catalog.register(buildComercialTemplate());

    const service = new BusinessProvisioningService({ catalog });
    const result = service.instantiateBusiness(
      "prv_custom",
      "org_custom",
      "wsp_custom",
      makeRequest({
        business: { departmentTemplateId: "tpl_comercial" },
      }),
    );

    expect(result.templateIds).toContain("tpl_comercial");
    expect(result.issues).toHaveLength(0);
  });

  it("records a typed issue when the template is unknown", () => {
    const service = new BusinessProvisioningService({
      catalog: createDepartmentTemplateCatalog(),
    });

    const result = service.instantiateBusiness(
      "prv_unknown",
      "org_unknown",
      "wsp_unknown",
      makeRequest({
        business: { departmentTemplateId: "tpl_does_not_exist" },
      }),
    );

    expect(result.templateIds).toHaveLength(0);
    expect(result.departments).toHaveLength(0);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "BUSINESS_TEMPLATE_MISSING" }),
    );
  });

  it("exposes the canonical Comercial default catalog", () => {
    const catalog = defaultCatalog();
    expect(catalog.has("tpl_comercial")).toBe(true);
    expect(catalog.list()).toHaveLength(1);
  });
});
