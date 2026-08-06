import {
  WorkflowValidationError,
  validateWorkflowDefinition,
  type WorkflowDefinition,
  type WorkflowStep,
  type WorkflowStepContextMapping,
} from "../workflow-types.js";

/**
 * Fluent builder for `WorkflowDefinition`. Use this when constructing a
 * workflow programmatically. The runtime layer accepts already-validated
 * workflows only.
 */
export class WorkflowBuilder {
  private readonly steps: WorkflowStep[] = [];

  private constructor(
    private readonly idValue: string,
    private readonly nameValue: string,
    private readonly descriptionValue: string,
    private readonly metadataValue: Readonly<Record<string, string>> = {},
  ) {}

  static create(input: {
    id: string;
    name: string;
    description: string;
    metadata?: Readonly<Record<string, string>>;
  }): WorkflowBuilder {
    return new WorkflowBuilder(
      input.id,
      input.name,
      input.description,
      input.metadata ?? {},
    );
  }

  withStep(
    input: Omit<WorkflowStep, "contextMapping"> & {
      contextMapping?: WorkflowStepContextMapping;
    },
  ): this {
    const step: WorkflowStep = {
      id: input.id,
      name: input.name,
      ...(input.description ? { description: input.description } : {}),
      agentId: input.agentId,
      toolId: input.toolId,
      args: { ...input.args },
      ...(input.contextMapping ? { contextMapping: input.contextMapping } : {}),
    };
    this.steps.push(step);
    return this;
  }

  build(): WorkflowDefinition {
    try {
      return validateWorkflowDefinition({
        id: this.idValue,
        name: this.nameValue,
        description: this.descriptionValue,
        steps: this.steps,
        ...(Object.keys(this.metadataValue).length > 0
          ? { metadata: this.metadataValue }
          : {}),
      });
    } catch (cause) {
      if (cause instanceof WorkflowValidationError) {
        throw cause;
      }
      throw new WorkflowValidationError(
        cause instanceof Error ? cause.message : String(cause),
      );
    }
  }
}
