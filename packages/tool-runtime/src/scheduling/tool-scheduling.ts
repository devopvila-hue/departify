import type {
  ToolDefinition,
  ToolExecutionRequest,
} from "../contracts/tool-contracts.js";

/**
 * Scheduling contract for the Tool Runtime.
 *
 * Sprint 20 ships the contract only. Concrete scheduling strategies
 * (priority queues, rate-limited pools, concurrency caps) will plug into
 * the pipeline through these interfaces.
 */

export interface ToolSchedulingDecision {
  readonly toolId: string;
  readonly requestId: string;
  readonly acceptedAt: string;
  readonly priority: number;
}

export interface ToolScheduler {
  schedule(
    definition: ToolDefinition,
    request: ToolExecutionRequest,
  ): ToolSchedulingDecision;
}

/**
 * Default FIFO scheduler. Priority is always 0 and acceptance order matches
 * arrival order. Real concurrency caps are the responsibility of the
 * pipeline adapter that owns the worker pool.
 */
export class FifoToolScheduler implements ToolScheduler {
  private counter = 0;

  schedule(
    definition: ToolDefinition,
    request: ToolExecutionRequest,
  ): ToolSchedulingDecision {
    this.counter += 1;
    return {
      toolId: definition.id,
      requestId: request.requestId,
      acceptedAt: new Date().toISOString(),
      priority: 0,
    };
  }
}
