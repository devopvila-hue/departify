import type { DepartmentConfiguration } from "../domain/department-types.js";
import {
  DepartmentTemplateValidationError,
  validateDepartmentTemplate,
  validateDepartmentTemplateId,
  type DepartmentTemplate,
  type DepartmentTemplateBuildInput,
  type DepartmentTemplateConnection,
  type DepartmentTemplateId,
  type DigitalEmployeeTemplate,
} from "./department-template-types.js";

/**
 * Fluent builder for DepartmentTemplate. Use this when constructing a
 * template programmatically; the catalog itself accepts already-validated
 * templates only.
 */
export class DepartmentTemplateBuilder {
  private readonly employees: DigitalEmployeeTemplate[] = [];
  private readonly connections: DepartmentTemplateConnection[] = [];

  private constructor(
    private readonly idValue: DepartmentTemplateId,
    private readonly nameValue: string,
    private readonly descriptionValue: string,
    private readonly configurationValue: DepartmentConfiguration,
  ) {}

  static create(input: {
    id: string;
    name: string;
    description: string;
    configuration: DepartmentConfiguration;
  }): DepartmentTemplateBuilder {
    return new DepartmentTemplateBuilder(
      validateDepartmentTemplateId(input.id),
      input.name,
      input.description,
      input.configuration,
    );
  }

  withEmployee(
    employee: Omit<DigitalEmployeeTemplate, "isDirector"> & {
      isDirector?: boolean;
    },
  ): this {
    this.employees.push({
      agentId: employee.agentId,
      displayName: employee.displayName,
      role: employee.role,
      isDirector: employee.isDirector ?? false,
    });
    return this;
  }

  withDirector(employee: Omit<DigitalEmployeeTemplate, "isDirector">): this {
    this.employees.push({
      agentId: employee.agentId,
      displayName: employee.displayName,
      role: employee.role,
      isDirector: true,
    });
    return this;
  }

  withTool(referenceId: string, label?: string): this {
    this.connections.push({
      kind: "tool",
      referenceId,
      ...(label ? { label } : {}),
    });
    return this;
  }

  withKnowledgeCollection(referenceId: string, label?: string): this {
    this.connections.push({
      kind: "knowledge_collection",
      referenceId,
      ...(label ? { label } : {}),
    });
    return this;
  }

  withMemorySession(referenceId: string, label?: string): this {
    this.connections.push({
      kind: "memory_session",
      referenceId,
      ...(label ? { label } : {}),
    });
    return this;
  }

  withConnectedApplication(referenceId: string, label?: string): this {
    this.connections.push({
      kind: "connected_application",
      referenceId,
      ...(label ? { label } : {}),
    });
    return this;
  }

  build(): DepartmentTemplate {
    const input: DepartmentTemplateBuildInput = {
      id: this.idValue,
      name: this.nameValue,
      description: this.descriptionValue,
      configuration: this.configurationValue,
      employees: this.employees,
      connections: this.connections,
    };
    try {
      return validateDepartmentTemplate(input);
    } catch (cause) {
      if (cause instanceof DepartmentTemplateValidationError) {
        throw cause;
      }
      throw new DepartmentTemplateValidationError(
        cause instanceof Error ? cause.message : String(cause),
      );
    }
  }
}
