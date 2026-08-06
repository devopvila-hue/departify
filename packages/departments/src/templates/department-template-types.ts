import type { DepartmentConfiguration } from "../domain/department-types.js";

/**
 * Official Department Template model (Sprint 25).
 *
 * A DepartmentTemplate is the **single authorised source** for initial
 * Department composition. Hosts must never hardcode Departments outside
 * the template catalog.
 */

export type DepartmentTemplateId = string;

/**
 * Definition of a single Digital Employee seeded by a template. The
 * template carries the Agent metadata the host will later register into
 * Agent Runtime.
 */
export interface DigitalEmployeeTemplate {
  readonly agentId: string;
  readonly displayName: string;
  readonly role: string;
  readonly isDirector: boolean;
}

export interface DepartmentTemplateConnection {
  readonly kind:
    | "tool"
    | "knowledge_collection"
    | "memory_session"
    | "connected_application";
  readonly referenceId: string;
  readonly label?: string;
}

export interface DepartmentTemplate {
  readonly id: DepartmentTemplateId;
  readonly name: string;
  readonly description: string;
  readonly configuration: DepartmentConfiguration;
  readonly employees: readonly DigitalEmployeeTemplate[];
  readonly connections: readonly DepartmentTemplateConnection[];
}

export interface DepartmentTemplateBuildInput {
  readonly id: DepartmentTemplateId;
  readonly name: string;
  readonly description: string;
  readonly configuration: DepartmentConfiguration;
  readonly employees: readonly DigitalEmployeeTemplate[];
  readonly connections: readonly DepartmentTemplateConnection[];
}

export class DepartmentTemplateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DepartmentTemplateValidationError";
  }
}

const TEMPLATE_ID_PATTERN = /^tpl_[a-z][a-z0-9_]{2,62}$/;

export function validateDepartmentTemplateId(
  value: unknown,
): DepartmentTemplateId {
  if (typeof value !== "string") {
    throw new DepartmentTemplateValidationError(
      "Department template id must be a string.",
    );
  }
  const trimmed = value.trim();
  if (!TEMPLATE_ID_PATTERN.test(trimmed)) {
    throw new DepartmentTemplateValidationError(
      `Department template id '${trimmed}' must match ${TEMPLATE_ID_PATTERN}.`,
    );
  }
  return trimmed;
}

export function validateDepartmentTemplate(
  template: DepartmentTemplateBuildInput,
): DepartmentTemplate {
  const id = validateDepartmentTemplateId(template.id);
  if (template.name.trim().length < 2) {
    throw new DepartmentTemplateValidationError(
      "Department template name must contain at least 2 characters.",
    );
  }
  if (template.description.trim().length < 2) {
    throw new DepartmentTemplateValidationError(
      "Department template description must contain at least 2 characters.",
    );
  }
  if (template.employees.length === 0) {
    throw new DepartmentTemplateValidationError(
      "Department template must include at least one Digital Employee.",
    );
  }
  const directorCount = template.employees.filter(
    (employee) => employee.isDirector,
  ).length;
  if (directorCount !== 1) {
    throw new DepartmentTemplateValidationError(
      `Department template must include exactly one director (got ${directorCount}).`,
    );
  }
  const agentIds = new Set<string>();
  for (const employee of template.employees) {
    if (employee.agentId.trim().length === 0) {
      throw new DepartmentTemplateValidationError(
        "Digital Employee agent id is required.",
      );
    }
    if (employee.displayName.trim().length < 2) {
      throw new DepartmentTemplateValidationError(
        "Digital Employee displayName must contain at least 2 characters.",
      );
    }
    if (employee.role.trim().length === 0) {
      throw new DepartmentTemplateValidationError(
        "Digital Employee role is required.",
      );
    }
    if (agentIds.has(employee.agentId)) {
      throw new DepartmentTemplateValidationError(
        `Duplicate Digital Employee agent id '${employee.agentId}'.`,
      );
    }
    agentIds.add(employee.agentId);
  }
  const connectionKeys = new Set<string>();
  for (const connection of template.connections) {
    const key = `${connection.kind}:${connection.referenceId}`;
    if (connectionKeys.has(key)) {
      throw new DepartmentTemplateValidationError(
        `Duplicate template connection '${key}'.`,
      );
    }
    connectionKeys.add(key);
  }
  return {
    id,
    name: template.name.trim(),
    description: template.description.trim(),
    configuration: template.configuration,
    employees: [...template.employees],
    connections: [...template.connections],
  };
}
