import {
  COMERCIAL_TEMPLATE_ID,
  buildComercialTemplate,
  createDepartmentService,
  createDepartmentTemplateCatalog,
  type DepartmentService,
  type DepartmentTemplate,
  type DepartmentTemplateCatalog,
  type DepartmentTemplateId,
  type DigitalEmployeeTemplate,
} from "@departify/departments";
import {
  type BusinessProvisioningDepartment,
  type BusinessProvisioningEmployee,
  type BusinessProvisioningResource,
  type BusinessProvisioningResult,
  type OrganizationProvisioningRequest,
  type ProvisioningId,
  type ProvisioningIssue,
} from "@departify/provisioning-engine";

/**
 * BusinessProvisioningService — the Sprint 25 official composition step
 * that turns a freshly provisioned Organization into an operational
 * digital company.
 *
 * The service consumes a `DepartmentTemplateCatalog` (the only authorised
 * source for initial Departments) and a `DepartmentService` (the only
 * authorised source for Department composition) and returns a typed
 * `BusinessProvisioningResult`. It is idempotent: re-running with the
 * same `provisioningId` produces the same outcome.
 */
export interface BusinessProvisioningOptions {
  readonly catalog: DepartmentTemplateCatalog;
  readonly departmentService?: DepartmentService;
  readonly defaultTemplateId?: DepartmentTemplateId;
  readonly clock?: () => Date;
}

export class BusinessProvisioningService {
  private readonly catalog: DepartmentTemplateCatalog;
  private readonly departmentService: DepartmentService;
  private readonly defaultTemplateId: DepartmentTemplateId;
  private readonly clock: () => Date;

  constructor(options: BusinessProvisioningOptions) {
    this.catalog = options.catalog;
    this.departmentService =
      options.departmentService ?? createDepartmentService();
    this.defaultTemplateId = options.defaultTemplateId ?? COMERCIAL_TEMPLATE_ID;
    this.clock = options.clock ?? (() => new Date());
  }

  /**
   * Instantiates the business for a freshly provisioned organization.
   * Returns a typed envelope with every Department, Digital Employee and
   * resource reference the platform created. Recovery is controlled: any
   * failure is reported through the `issues` list and the overall run is
   * marked accepted=false.
   */
  instantiateBusiness(
    provisioningId: ProvisioningId,
    organizationId: string,
    workspaceId: string,
    request: OrganizationProvisioningRequest,
  ): BusinessProvisioningResult {
    const issues: ProvisioningIssue[] = [];
    const templateIds: string[] = [];
    const departments: BusinessProvisioningDepartment[] = [];

    const templateId =
      request.business?.departmentTemplateId ?? this.defaultTemplateId;
    const template = this.lookupTemplate(templateId, issues);
    if (template) {
      templateIds.push(template.id);
      const department = this.materializeTemplate(
        provisioningId,
        organizationId,
        template,
        issues,
      );
      if (department) {
        departments.push(department);
      }
    }

    return {
      provisioningId,
      organizationId,
      workspaceId,
      templateIds,
      departments,
      issues,
      completedAt: this.clock().toISOString(),
    };
  }

  private lookupTemplate(
    templateId: string,
    issues: ProvisioningIssue[],
  ): DepartmentTemplate | null {
    const template = this.catalog.tryGet(templateId);
    if (!template) {
      issues.push({
        code: "BUSINESS_TEMPLATE_MISSING",
        message: `Department template '${templateId}' is not registered with the catalog.`,
      });
      return null;
    }
    return template;
  }

  private materializeTemplate(
    provisioningId: ProvisioningId,
    organizationId: string,
    template: DepartmentTemplate,
    issues: ProvisioningIssue[],
  ): BusinessProvisioningDepartment | null {
    const departmentId = deriveDepartmentId(
      provisioningId,
      template.id,
      organizationId,
    );

    if (this.departmentService.has(departmentId)) {
      // Idempotent: re-provisioning yields the same snapshot.
      return this.snapshotDepartment(departmentId, template);
    }

    try {
      const employeeEntries: DigitalEmployeeTemplate[] = template.employees.map(
        (employee) => ({
          agentId: employee.agentId,
          displayName: employee.displayName,
          role: employee.role,
          isDirector: employee.isDirector,
        }),
      );

      this.departmentService.create({
        id: departmentId,
        organizationId,
        name: template.name,
        description: template.description,
        configuration: template.configuration,
        directorAgentId:
          template.employees.find((employee) => employee.isDirector)?.agentId ??
          null,
        initialEmployeeAgentIds: employeeEntries.map((e) => e.agentId),
        initialConnections: template.connections,
      });

      for (const connection of template.connections) {
        if (connection.kind === "tool") {
          this.departmentService.associateTool(
            departmentId,
            connection.referenceId,
          );
        } else if (connection.kind === "knowledge_collection") {
          this.departmentService.associateKnowledgeCollection(
            departmentId,
            connection.referenceId,
          );
        } else if (connection.kind === "memory_session") {
          this.departmentService.associateMemorySession(
            departmentId,
            connection.referenceId,
          );
        }
      }

      this.departmentService.activate(departmentId);
      return this.snapshotDepartment(departmentId, template);
    } catch (cause) {
      issues.push({
        code: "BUSINESS_DEPARTMENT_FAILED",
        message:
          cause instanceof Error
            ? cause.message
            : "Department composition failed.",
      });
      return null;
    }
  }

  private snapshotDepartment(
    departmentId: string,
    template: DepartmentTemplate,
  ): BusinessProvisioningDepartment {
    const department = this.departmentService.get(departmentId);
    const employees: BusinessProvisioningEmployee[] = template.employees.map(
      (employee) => ({
        agentId: employee.agentId,
        displayName: employee.displayName,
        role: employee.role,
        isDirector: employee.isDirector,
      }),
    );
    const resources: BusinessProvisioningResource[] = template.connections.map(
      (connection) => ({
        kind: connection.kind,
        referenceId: connection.referenceId,
        ...(connection.label ? { label: connection.label } : {}),
      }),
    );
    return {
      departmentId,
      templateId: template.id,
      name: template.name,
      status: department.getStatus(),
      directorAgentId: department.getDirectorAgentId(),
      employees,
      resources,
    };
  }
}

/**
 * Idempotent derivation of a Department id from a provisioning id, a
 * template id and an organization id. The format keeps the department
 * traceable to its origin while staying deterministic across retries.
 */
function deriveDepartmentId(
  provisioningId: ProvisioningId,
  templateId: string,
  organizationId: string,
): string {
  const normalizedTemplate = templateId.replace(/^tpl_/, "");
  const suffix = `${organizationId}_${provisioningId}`;
  return `dep_${normalizedTemplate}_${suffix}`.slice(0, 64);
}

/**
 * Convenience factory that returns a service backed by the canonical
 * Comercial template. Tests and platform wiring both use this.
 */
export function createBusinessProvisioningService(
  options: Partial<BusinessProvisioningOptions> = {},
): BusinessProvisioningService {
  const catalog = options.catalog ?? defaultCatalog();
  return new BusinessProvisioningService({ ...options, catalog });
}

/**
 * Returns a default catalog pre-populated with the canonical Comercial
 * template. Hosts may extend the catalog with their own templates before
 * bootstrapping the service.
 */
export function defaultCatalog(): DepartmentTemplateCatalog {
  const catalog = createDepartmentTemplateCatalog();
  catalog.register(buildComercialTemplate());
  return catalog;
}
