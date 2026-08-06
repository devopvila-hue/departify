/**
 * Workflow domain model — Sprint 26.
 *
 * Workflows compose existing components (AgentToolBridge + Tool Runtime +
 * Core Tool Catalog). They never replace or duplicate those runtimes.
 *
 * Every step delegates to a Digital Employee through the AgentToolBridge;
 * the previous step's output is threaded into the next step's metadata,
 * producing a typed context-passing chain.
 */

export type WorkflowId = string;
export type WorkflowStepId = string;
export type WorkflowExecutionId = string;

/**
 * Mapping applied to a step's args before the step runs. The previous
 * step's output is interpolated into the metadata bag the bridge forwards
 * to the AgentToolBridge.
 */
export interface WorkflowStepContextMapping {
  /**
   * Metadata key to inject the previous step's output under. The previous
   * step's full output is JSON-serialised and stored here.
   */
  readonly previousOutputKey?: string;
  /**
   * Metadata key to inject the previous step's actionId.
   */
  readonly previousActionIdKey?: string;
  /**
   * Metadata key to inject the previous step's status.
   */
  readonly previousStatusKey?: string;
  /**
   * Additional static metadata to attach to the step's action.
   */
  readonly staticMetadata?: Readonly<Record<string, string>>;
}

export interface WorkflowStep {
  readonly id: WorkflowStepId;
  readonly name: string;
  readonly description?: string;
  /**
   * Digital Employee that performs the step. Mapped 1:1 to the agentId on
   * the AgentToolAction the bridge consumes.
   */
  readonly agentId: string;
  /**
   * Tool the step invokes through the AgentToolBridge.
   */
  readonly toolId: string;
  /**
   * Args forwarded verbatim to the Tool. Pure data; the workflow never
   * inspects them.
   */
  readonly args: Readonly<Record<string, unknown>>;
  /**
   * Optional context mapping that controls how the previous step's
   * output is threaded into this step.
   */
  readonly contextMapping?: WorkflowStepContextMapping;
}

export interface WorkflowDefinition {
  readonly id: WorkflowId;
  readonly name: string;
  readonly description: string;
  readonly steps: readonly WorkflowStep[];
  /**
   * Metadata attached to every step's action. Useful for tracing.
   */
  readonly metadata?: Readonly<Record<string, string>>;
}

export type WorkflowStatus = "completed" | "failed" | "cancelled";

export type WorkflowStepStatus = WorkflowStatus | "skipped";

export interface WorkflowStepResult {
  readonly stepId: WorkflowStepId;
  readonly agentId: string;
  readonly toolId: string;
  readonly actionId: string;
  readonly status: WorkflowStepStatus;
  readonly output: unknown;
  readonly error: WorkflowStepError | null;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
}

export interface WorkflowStepError {
  readonly code: string;
  readonly message: string;
  readonly phase: "bridge" | "validation" | "execution";
}

export interface WorkflowResult {
  readonly executionId: WorkflowExecutionId;
  readonly workflowId: WorkflowId;
  readonly status: WorkflowStatus;
  readonly steps: readonly WorkflowStepResult[];
  readonly finalOutput: unknown;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly error: WorkflowStepError | null;
}

export class WorkflowValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowValidationError";
  }
}

export function validateWorkflowDefinition(
  definition: WorkflowDefinition,
): WorkflowDefinition {
  if (!/^wf_[a-z][a-z0-9_]{2,62}$/.test(definition.id)) {
    throw new WorkflowValidationError(
      `Workflow id '${definition.id}' must match /^wf_[a-z][a-z0-9_]{2,62}$/.`,
    );
  }
  if (definition.name.trim().length < 2) {
    throw new WorkflowValidationError(
      "Workflow name must contain at least 2 characters.",
    );
  }
  if (definition.description.trim().length < 2) {
    throw new WorkflowValidationError(
      "Workflow description must contain at least 2 characters.",
    );
  }
  if (definition.steps.length === 0) {
    throw new WorkflowValidationError(
      "Workflow must include at least one step.",
    );
  }
  const seenStepIds = new Set<string>();
  for (const step of definition.steps) {
    if (seenStepIds.has(step.id)) {
      throw new WorkflowValidationError(
        `Duplicate workflow step id '${step.id}'.`,
      );
    }
    seenStepIds.add(step.id);
    if (step.id.trim().length < 2) {
      throw new WorkflowValidationError(
        "Workflow step id must contain at least 2 characters.",
      );
    }
    if (step.agentId.trim().length === 0) {
      throw new WorkflowValidationError(
        `Workflow step '${step.id}' is missing an agentId.`,
      );
    }
    if (step.toolId.trim().length === 0) {
      throw new WorkflowValidationError(
        `Workflow step '${step.id}' is missing a toolId.`,
      );
    }
  }
  return definition;
}
