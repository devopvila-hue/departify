import {
  DepartmentTemplateValidationError,
  type DepartmentTemplate,
  type DepartmentTemplateId,
} from "./department-template-types.js";

/**
 * DepartmentTemplateCatalog — the **single authorised source** for
 * initial Department composition. Hosts must consult this catalog before
 * creating a Department; hardcoded Departments are forbidden by the
 * catalog's contract.
 *
 * Sprint 25 ships Comercial only. New templates are registered through
 * `register(template)` and become available immediately.
 */
export class DepartmentTemplateCatalog {
  private readonly templates = new Map<
    DepartmentTemplateId,
    DepartmentTemplate
  >();

  register(template: DepartmentTemplate): DepartmentTemplate {
    if (this.templates.has(template.id)) {
      throw new DepartmentTemplateValidationError(
        `Department template '${template.id}' is already registered.`,
      );
    }
    this.templates.set(template.id, template);
    return template;
  }

  has(id: DepartmentTemplateId): boolean {
    return this.templates.has(id);
  }

  get(id: DepartmentTemplateId): DepartmentTemplate {
    const template = this.templates.get(id);
    if (!template) {
      throw new DepartmentTemplateValidationError(
        `Department template '${id}' is not registered.`,
      );
    }
    return template;
  }

  tryGet(id: DepartmentTemplateId): DepartmentTemplate | null {
    return this.templates.get(id) ?? null;
  }

  list(): readonly DepartmentTemplate[] {
    return [...this.templates.values()];
  }

  size(): number {
    return this.templates.size;
  }
}

/**
 * Convenience factory that returns a fresh catalog.
 */
export function createDepartmentTemplateCatalog(): DepartmentTemplateCatalog {
  return new DepartmentTemplateCatalog();
}
