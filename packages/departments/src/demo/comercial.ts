import {
  COMERCIAL_TEMPLATE_ID,
  buildComercialTemplate,
} from "../templates/templates/comercial.template.js";
import { createDepartmentTemplateCatalog } from "../templates/department-template-catalog.js";
import {
  DepartmentService,
  createDepartmentService,
} from "../services/department-service.js";
import { LEAD_QUALIFICATION_WORKFLOW_ID } from "@departify/workflows";
import type { DepartmentSnapshot } from "../domain/department-types.js";

/**
 * Demo: Comercial department built from the canonical template catalog.
 *
 * The hardcoded demo (pre-Sprint 25) has been replaced by the template
 * composition. Hosts are expected to use the template catalog as the
 * single source of truth for initial Departments.
 */
export function buildComercialDepartment(): {
  service: DepartmentService;
  snapshot: DepartmentSnapshot;
} {
  const catalog = createDepartmentTemplateCatalog();
  const template = buildComercialTemplate();
  catalog.register(template);

  return materializeTemplate(catalog, COMERCIAL_TEMPLATE_ID);
}

export function materializeTemplate(
  catalog: ReturnType<typeof createDepartmentTemplateCatalog>,
  templateId: string,
): {
  service: DepartmentService;
  snapshot: DepartmentSnapshot;
} {
  const template = catalog.get(templateId);

  const service = createDepartmentService();
  const departmentId = `dep_${template.id.replace(/^tpl_/, "")}`;

  service.create({
    id: departmentId,
    organizationId: "org_departify",
    name: template.name,
    description: template.description,
    configuration: template.configuration,
    directorAgentId:
      template.employees.find((employee) => employee.isDirector)?.agentId ??
      null,
    initialEmployeeAgentIds: template.employees.map(
      (employee) => employee.agentId,
    ),
    initialConnections: template.connections,
  });

  for (const connection of template.connections) {
    if (connection.kind === "tool") {
      service.associateTool(departmentId, connection.referenceId);
    } else if (connection.kind === "knowledge_collection") {
      service.associateKnowledgeCollection(
        departmentId,
        connection.referenceId,
      );
    } else if (connection.kind === "memory_session") {
      service.associateMemorySession(departmentId, connection.referenceId);
    }
  }

  service.attachWorkflow(departmentId, LEAD_QUALIFICATION_WORKFLOW_ID);
  service.activate(departmentId);

  const snapshot = service.get(departmentId).toSnapshot();
  return { service, snapshot };
}
