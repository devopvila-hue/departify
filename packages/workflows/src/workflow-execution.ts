import type {
  AgentToolAction,
  AgentToolOutcome,
  AgentToolPort,
} from "@departify/agent-tool-bridge";
import {
  type WorkflowDefinition,
  type WorkflowExecutionId,
  type WorkflowResult,
  type WorkflowStatus,
  type WorkflowStepContextMapping,
  type WorkflowStepResult,
} from "./workflow-types.js";

/**
 * WorkflowExecution — deterministic executor for `WorkflowDefinition`.
 *
 * Each step is dispatched through the supplied `AgentToolPort`. The
 * previous step's output is injected into the next step's metadata
 * through the configured `WorkflowStepContextMapping`, producing a typed
 * context chain. Cancellation is cooperative through the optional
 * `signal`.
 */
export interface WorkflowExecutionOptions {
  readonly port: AgentToolPort;
  readonly signal?: AbortSignal;
  readonly clock?: () => Date;
  readonly executionIdFactory?: () => WorkflowExecutionId;
}

export class WorkflowExecution {
  private readonly port: AgentToolPort;
  private readonly signal: AbortSignal | undefined;
  private readonly clock: () => Date;
  private readonly executionIdFactory: () => WorkflowExecutionId;

  constructor(options: WorkflowExecutionOptions) {
    this.port = options.port;
    this.signal = options.signal;
    this.clock = options.clock ?? (() => new Date());
    this.executionIdFactory =
      options.executionIdFactory ??
      (() =>
        `wfe_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`);
  }

  async run(definition: WorkflowDefinition): Promise<WorkflowResult> {
    const startedAt = this.clock();
    const stepResults: WorkflowStepResult[] = [];
    let previousResult: WorkflowStepResult | null = null;

    for (const step of definition.steps) {
      if (this.signal?.aborted) {
        const cancelledResult = this.buildCancelledResult(step);
        stepResults.push(cancelledResult);
        return this.buildOverallResult(
          definition,
          "cancelled",
          startedAt,
          stepResults,
          this.cancellationError(),
          previousResult?.output,
        );
      }

      const stepResult = await this.executeStep(
        step,
        previousResult,
        definition,
      );
      stepResults.push(stepResult);

      if (stepResult.status === "failed" || stepResult.status === "cancelled") {
        const firstFailure = stepResults.find(
          (result) =>
            result.status === "failed" || result.status === "cancelled",
        );
        const finalOutput = stepResults.find(
          (result) => result.status === "completed",
        )?.output;
        return this.buildOverallResult(
          definition,
          firstFailure?.status === "cancelled" ? "cancelled" : "failed",
          startedAt,
          stepResults,
          firstFailure?.error ?? null,
          finalOutput,
        );
      }

      previousResult = stepResult;
    }

    return this.buildOverallResult(
      definition,
      "completed",
      startedAt,
      stepResults,
      null,
      previousResult?.output,
    );
  }

  private async executeStep(
    step: WorkflowDefinition["steps"][number],
    previousResult: WorkflowStepResult | null,
    definition: WorkflowDefinition,
  ): Promise<WorkflowStepResult> {
    const actionId = `act_wf_${definition.id}_${step.id}_${Date.now().toString(36)}`;
    const stepStartedAt = this.clock();

    const metadata = this.composeMetadata(
      step.contextMapping,
      previousResult,
      definition.metadata,
    );

    const action: AgentToolAction = {
      actionId,
      agentId: step.agentId,
      toolId: step.toolId,
      args: { ...step.args },
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    };

    let outcome: AgentToolOutcome;
    try {
      outcome = await this.port.executeAction(action);
    } catch (cause) {
      const completedAt = this.clock();
      return {
        stepId: step.id,
        agentId: step.agentId,
        toolId: step.toolId,
        actionId,
        status: "failed",
        output: null,
        error: {
          code: "bridge_failed",
          message: cause instanceof Error ? cause.message : String(cause),
          phase: "bridge",
        },
        startedAt: stepStartedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - stepStartedAt.getTime(),
      };
    }

    return this.toStepResult(step, outcome, stepStartedAt);
  }

  private toStepResult(
    step: WorkflowDefinition["steps"][number],
    outcome: AgentToolOutcome,
    startedAt: Date,
  ): WorkflowStepResult {
    const completedAt = this.clock();
    const completedAtIso = completedAt.toISOString();
    const startedAtIso = startedAt.toISOString();

    if ("status" in outcome && outcome.status === "rejected") {
      return {
        stepId: step.id,
        agentId: step.agentId,
        toolId: step.toolId,
        actionId: outcome.actionId,
        status: "failed",
        output: null,
        error: {
          code: outcome.code,
          message: outcome.reason,
          phase: "bridge",
        },
        startedAt: startedAtIso,
        completedAt: completedAtIso,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      };
    }

    if (outcome.status === "failed") {
      return {
        stepId: step.id,
        agentId: step.agentId,
        toolId: step.toolId,
        actionId: outcome.actionId,
        status: "failed",
        output: null,
        error: outcome.error
          ? {
              code: outcome.error.code,
              message: outcome.error.message,
              phase: "execution",
            }
          : {
              code: "execution_failed",
              message: "Step execution failed.",
              phase: "execution",
            },
        startedAt: startedAtIso,
        completedAt: completedAtIso,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      };
    }

    if (outcome.status === "cancelled") {
      return {
        stepId: step.id,
        agentId: step.agentId,
        toolId: step.toolId,
        actionId: outcome.actionId,
        status: "cancelled",
        output: null,
        error: outcome.error
          ? {
              code: outcome.error.code,
              message: outcome.error.message,
              phase: "execution",
            }
          : {
              code: "execution_cancelled",
              message: "Step execution cancelled.",
              phase: "execution",
            },
        startedAt: startedAtIso,
        completedAt: completedAtIso,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      };
    }

    return {
      stepId: step.id,
      agentId: step.agentId,
      toolId: step.toolId,
      actionId: outcome.actionId,
      status: "completed",
      output: outcome.output ?? null,
      error: null,
      startedAt: startedAtIso,
      completedAt: completedAtIso,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    };
  }

  private buildCancelledResult(
    step: WorkflowDefinition["steps"][number],
  ): WorkflowStepResult {
    const startedAt = this.clock();
    const completedAt = this.clock();
    return {
      stepId: step.id,
      agentId: step.agentId,
      toolId: step.toolId,
      actionId: `act_wf_cancelled_${step.id}_${Date.now().toString(36)}`,
      status: "cancelled",
      output: null,
      error: this.cancellationError(),
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: 0,
    };
  }

  private cancellationError(): {
    code: string;
    message: string;
    phase: "bridge" | "validation" | "execution";
  } {
    return {
      code: "execution_cancelled",
      message: "Workflow execution was cancelled.",
      phase: "execution",
    };
  }

  private composeMetadata(
    mapping: WorkflowStepContextMapping | undefined,
    previous: WorkflowStepResult | null,
    workflowMetadata: Readonly<Record<string, string>> | undefined,
  ): Record<string, string> {
    const metadata: Record<string, string> = {};
    if (workflowMetadata) {
      for (const [key, value] of Object.entries(workflowMetadata)) {
        metadata[key] = value;
      }
    }
    if (mapping?.staticMetadata) {
      for (const [key, value] of Object.entries(mapping.staticMetadata)) {
        metadata[key] = value;
      }
    }
    if (previous) {
      if (mapping?.previousOutputKey) {
        metadata[mapping.previousOutputKey] = serialiseOutput(previous.output);
      }
      if (mapping?.previousActionIdKey) {
        metadata[mapping.previousActionIdKey] = previous.actionId;
      }
      if (mapping?.previousStatusKey) {
        metadata[mapping.previousStatusKey] = previous.status;
      }
    }
    return metadata;
  }

  private buildOverallResult(
    definition: WorkflowDefinition,
    status: WorkflowStatus,
    startedAt: Date,
    steps: readonly WorkflowStepResult[],
    error: WorkflowResult["error"],
    finalOutput: unknown,
  ): WorkflowResult {
    const completedAt = this.clock();
    return {
      executionId: this.executionIdFactory(),
      workflowId: definition.id,
      status,
      steps,
      finalOutput: status === "completed" ? (finalOutput ?? null) : null,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
      error,
    };
  }
}

function serialiseOutput(output: unknown): string {
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}
