import type {
  ToolExecutionContext,
  ToolExecutionErrorEnvelope,
  ToolExecutionRequest,
  ToolExecutionResult,
  ToolScope,
} from "../contracts/tool-contracts.js";
import {
  ToolCancellationError,
  ToolExecutionDisabledError,
  ToolExecutionError,
  ToolLimitExceededError,
  ToolPreparationError,
  ToolRuntimeError,
  ToolTimeoutError,
  ToolUnknownError,
} from "../errors/tool-runtime-errors.js";
import {
  InMemoryToolEventPublisher,
  NoopToolEventPublisher,
  nowIso,
  type ToolEventPublisher,
} from "../events/tool-events.js";
import {
  createInMemoryToolObservability,
  createNoopToolObservability,
  reportToolResult,
  type ToolObservability,
} from "../observability/tool-observability.js";
import {
  DefaultCancellationPolicy,
  DefaultIsolationPolicy,
  DefaultLimitPolicy,
  assertScopeCompatibility,
  type CancellationPolicy,
  type IsolationLevel,
  type IsolationPolicy,
  type LimitPolicy,
} from "../security/tool-security.js";
import {
  DefaultToolAbortController,
  type ToolAbortController,
} from "../sandbox/tool-sandbox.js";
import {
  FifoToolScheduler,
  type ToolScheduler,
  type ToolSchedulingDecision,
} from "../scheduling/tool-scheduling.js";
import { ToolRegistry } from "../registry/tool-registry.js";
import {
  asRuntimeError,
  validateToolRequest,
} from "../validation/tool-validation.js";
import {
  ScopeBasedAuthorizationPolicy,
  evaluateAuthorization,
  type ToolAuthorizationPolicy,
} from "../permissions/tool-permissions.js";

/**
 * Six-phase execution pipeline:
 *
 *   validate → authorize → prepare → execute → observe → complete
 *
 * Sprint 20 models every phase but keeps `execute` disabled. The pipeline
 * runs every phase deterministically and short-circuits with a typed
 * `ToolExecutionResult` so callers always receive the same envelope
 * regardless of where the run terminated.
 */
export interface ToolExecutionPipelineOptions {
  readonly registry: ToolRegistry;
  readonly authorization: ToolAuthorizationPolicy;
  readonly isolation?: IsolationPolicy;
  readonly cancellation?: CancellationPolicy;
  readonly limits?: LimitPolicy;
  readonly scheduler?: ToolScheduler;
  readonly publisher?: ToolEventPublisher;
  readonly observability?: ToolObservability;
  /**
   * Granted scopes available to the caller. In Sprint 20 these are supplied
   * by the host; future sprints will source them from auth/session layers.
   */
  readonly grantedScopes: readonly ToolScope[];
  /**
   * Isolation level active in the current Runtime instance.
   */
  readonly isolationLevel?: IsolationLevel;
}

export class ToolExecutionPipeline {
  private readonly registry: ToolRegistry;
  private readonly authorization: ToolAuthorizationPolicy;
  private readonly isolation: IsolationPolicy;
  private readonly cancellation: CancellationPolicy;
  private readonly limits: LimitPolicy;
  private readonly scheduler: ToolScheduler;
  private readonly publisher: ToolEventPublisher;
  private readonly observability: ToolObservability;
  private readonly grantedScopes: readonly ToolScope[];
  private readonly isolationLevel: IsolationLevel;

  constructor(options: ToolExecutionPipelineOptions) {
    this.registry = options.registry;
    this.authorization = options.authorization;
    this.isolation = options.isolation ?? new DefaultIsolationPolicy();
    this.cancellation = options.cancellation ?? new DefaultCancellationPolicy();
    this.limits = options.limits ?? new DefaultLimitPolicy();
    this.scheduler = options.scheduler ?? new FifoToolScheduler();
    this.publisher = options.publisher ?? new NoopToolEventPublisher();
    this.observability = options.observability ?? createNoopToolObservability();
    this.grantedScopes = options.grantedScopes;
    this.isolationLevel = options.isolationLevel ?? "logical";
  }

  async execute<TResult = unknown>(
    request: ToolExecutionRequest,
  ): Promise<ToolExecutionResult<TResult>> {
    const validated = validateToolRequest(request);
    const startedAt = nowIso();
    const controller = new DefaultToolAbortController();

    try {
      const tool = this.validate(validated);
      this.authorizePhase(tool, validated);
      this.prepare(tool, validated, controller);
      this.observeStart(validated);
      const output = await this.executePhase<TResult>(
        tool,
        validated,
        controller,
      );
      const result = this.complete<TResult>(validated, output, startedAt);
      reportToolResult(this.observability, result);
      return result;
    } catch (cause) {
      const runtimeError = asRuntimeError(cause);
      const result = this.failure<TResult>(validated, runtimeError, startedAt);
      reportToolResult(this.observability, result);
      return result;
    }
  }

  /**
   * Phase 1 — validate.
   *
   * The request is already validated by `validateToolRequest`. This phase
   * resolves the Tool definition from the registry and verifies lifecycle.
   */
  private validate(
    request: ToolExecutionRequest,
  ): ReturnType<ToolRegistry["get"]> {
    const tool = request.toolVersion
      ? this.registry.get(request.toolId, request.toolVersion)
      : this.registry.get(request.toolId);
    if (tool.status !== "active") {
      throw new ToolUnknownError(
        `Tool '${request.toolId}' is not active (current status: ${tool.status}).`,
      );
    }
    return tool;
  }

  /**
   * Phase 2 — authorize.
   *
   * Delegates to the configured authorization policy and asserts scope /
   * isolation compatibility.
   */
  private authorizePhase(
    tool: ReturnType<ToolRegistry["get"]>,
    request: ToolExecutionRequest,
  ): void {
    evaluateAuthorization(this.authorization, {
      definition: tool.definition,
      request,
      grantedScopes: this.grantedScopes,
    });
    assertScopeCompatibility(
      [...tool.definition.requiredScopes, ...(request.requestedScopes ?? [])],
      this.isolationLevel,
    );
    const requiredIsolation = this.isolation.minimumIsolationFor(
      tool.definition,
    );
    const levels: readonly IsolationLevel[] = [
      "logical",
      "process",
      "container",
      "vm",
      "remote",
    ];
    if (
      levels.indexOf(requiredIsolation) > levels.indexOf(this.isolationLevel)
    ) {
      throw new ToolPreparationError(
        `Tool '${tool.definition.id}' requires isolation '${requiredIsolation}' but runtime isolation is '${this.isolationLevel}'.`,
      );
    }
  }

  /**
   * Phase 3 — prepare.
   *
   * Schedules the execution through the configured scheduler. Cancellation
   * policies are consulted here so the caller can prepare an abort handle
   * before the work begins.
   */
  private prepare(
    tool: ReturnType<ToolRegistry["get"]>,
    request: ToolExecutionRequest,
    controller: ToolAbortController,
  ): ToolSchedulingDecision {
    this.scheduler.schedule(tool.definition, request);
    if (controller.signal.aborted) {
      throw new ToolCancellationError(
        `Tool '${tool.definition.id}' was cancelled before execution started.`,
      );
    }
    return {
      toolId: tool.definition.id,
      requestId: request.requestId,
      acceptedAt: new Date().toISOString(),
      priority: 0,
    };
  }

  /**
   * Phase 4 — execute.
   *
   * Real execution is disabled in Sprint 20. The pipeline runs the supplied
   * executor (if any) inside an `AbortSignal`-aware wrapper that enforces
   * the configured timeout. Tools without an executor raise
   * `ToolExecutionDisabledError` so callers know the Runtime is wired but
   * the work is not yet implemented.
   */
  private async executePhase<TResult>(
    tool: ReturnType<ToolRegistry["get"]>,
    request: ToolExecutionRequest,
    controller: ToolAbortController,
  ): Promise<TResult> {
    if (
      !this.cancellation.isCancellable(tool.definition) &&
      controller.signal.aborted
    ) {
      throw new ToolCancellationError(
        `Tool '${tool.definition.id}' is not cancellable.`,
      );
    }
    const limits = this.limits.effectiveLimits(tool.definition);

    if (!tool.definition.executor) {
      throw new ToolExecutionDisabledError(
        `Tool '${tool.definition.id}' has no executor wired in Sprint 20.`,
      );
    }

    return await this.runExecutor(tool, request, controller, limits);
  }

  private async runExecutor<TResult>(
    tool: ReturnType<ToolRegistry["get"]>,
    request: ToolExecutionRequest,
    controller: ToolAbortController,
    limits: ReturnType<LimitPolicy["effectiveLimits"]>,
  ): Promise<TResult> {
    const executor = tool.definition.executor;
    if (!executor) {
      throw new ToolExecutionDisabledError();
    }
    const context: ToolExecutionContext = {
      toolId: tool.definition.id,
      toolVersion: tool.definition.version,
      requestId: request.requestId,
      ...(request.organizationId
        ? { organizationId: request.organizationId }
        : {}),
      ...(request.agentId ? { agentId: request.agentId } : {}),
      ...(request.metadata ? { metadata: request.metadata } : {}),
    };

    const signal = controller.signal;
    const { timeoutMs } = limits;
    const maxOutputBytes = limits.maxOutputBytes;
    return await new Promise<TResult>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        controller.cancel("timeout");
        reject(
          new ToolTimeoutError(
            `Tool '${tool.definition.id}' exceeded its ${timeoutMs}ms timeout.`,
          ),
        );
      }, timeoutMs);

      const abortListener = (reason: string): void => {
        clearTimeout(timeoutHandle);
        reject(
          reason === "timeout"
            ? new ToolTimeoutError(`Tool '${tool.definition.id}' timed out.`)
            : new ToolCancellationError(
                `Tool '${tool.definition.id}' cancelled (${reason}).`,
              ),
        );
      };
      signal.onAbort(abortListener);

      Promise.resolve(
        executor(
          context,
          request.args,
          controller.signal as unknown as AbortSignal,
        ),
      )
        .then((output) => {
          if (maxOutputBytes !== undefined) {
            const size = JSON.stringify(output ?? null).length;
            if (size > maxOutputBytes) {
              clearTimeout(timeoutHandle);
              reject(
                new ToolLimitExceededError(
                  `Tool '${tool.definition.id}' output exceeds ${maxOutputBytes} bytes (was ${size}).`,
                ),
              );
              return;
            }
          }
          clearTimeout(timeoutHandle);
          resolve(output as TResult);
        })
        .catch((cause) => {
          clearTimeout(timeoutHandle);
          if (cause instanceof ToolRuntimeError) {
            reject(cause);
            return;
          }
          if (cause instanceof Error) {
            reject(new ToolExecutionError(cause.message, { cause }));
            return;
          }
          reject(
            new ToolExecutionError(
              `Tool '${tool.definition.id}' executor failed.`,
              { cause },
            ),
          );
        });
    });
  }

  /**
   * Phase 5 — observe.
   *
   * Emits the start event. Latency, success and error metrics are emitted
   * in `complete` once the duration is known.
   */
  private observeStart(request: ToolExecutionRequest): void {
    this.publisher.publish({
      kind: "tool.requested",
      occurredAt: nowIso(),
      requestId: request.requestId,
      toolId: request.toolId,
    });
    this.publisher.publish({
      kind: "tool.started",
      occurredAt: nowIso(),
      requestId: request.requestId,
      toolId: request.toolId,
    });
  }

  /**
   * Phase 6 — complete.
   *
   * Builds the typed `ToolExecutionResult` envelope. Successful runs carry
   * the executor's output; failures carry the typed `ToolExecutionErrorEnvelope`.
   */
  private complete<TResult>(
    request: ToolExecutionRequest,
    output: TResult,
    startedAt: string,
  ): ToolExecutionResult<TResult> {
    const completedAt = nowIso();
    const result: ToolExecutionResult<TResult> = {
      requestId: request.requestId,
      toolId: request.toolId,
      toolVersion: request.toolVersion ?? "unspecified",
      status: "completed",
      output,
      durationMs: durationBetween(startedAt, completedAt),
      startedAt,
      completedAt,
    };
    this.publisher.publish({
      kind: "tool.completed",
      occurredAt: completedAt,
      requestId: request.requestId,
      toolId: request.toolId,
      durationMs: result.durationMs,
    });
    return result;
  }

  private failure<TResult>(
    request: ToolExecutionRequest,
    error: ToolRuntimeError,
    startedAt: string,
  ): ToolExecutionResult<TResult> {
    const completedAt = nowIso();
    const envelope: ToolExecutionErrorEnvelope = {
      code: error.code,
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    };
    const result: ToolExecutionResult<TResult> = {
      requestId: request.requestId,
      toolId: request.toolId,
      toolVersion: request.toolVersion ?? "unspecified",
      status: error.code === "execution_cancelled" ? "cancelled" : "failed",
      error: envelope,
      durationMs: durationBetween(startedAt, completedAt),
      startedAt,
      completedAt,
    };
    if (result.status === "cancelled") {
      this.publisher.publish({
        kind: "tool.cancelled",
        occurredAt: completedAt,
        requestId: result.requestId,
        toolId: result.toolId,
        durationMs: result.durationMs,
      });
    } else {
      this.publisher.publish({
        kind: "tool.failed",
        occurredAt: completedAt,
        requestId: result.requestId,
        toolId: result.toolId,
        durationMs: result.durationMs,
        error: envelope,
      });
    }
    return result;
  }
}

function durationBetween(startedAt: string, completedAt: string): number {
  return Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));
}

/**
 * Convenience builder that wires the default policies and observers used by
 * Sprint 20. Hosts may override any field.
 */
export interface ToolRuntimeOptions {
  readonly registry?: ToolRegistry;
  readonly grantedScopes?: readonly ToolScope[];
  readonly publisher?: ToolEventPublisher;
  readonly observability?: ToolObservability;
  readonly authorization?: ToolAuthorizationPolicy;
  readonly isolationLevel?: IsolationLevel;
}

export interface ToolRuntime {
  readonly registry: ToolRegistry;
  readonly pipeline: ToolExecutionPipeline;
  execute<TResult = unknown>(
    request: ToolExecutionRequest,
  ): Promise<ToolExecutionResult<TResult>>;
}

export function createToolRuntime(
  options: ToolRuntimeOptions = {},
): ToolRuntime {
  const registry = options.registry ?? new ToolRegistry();
  const publisher = options.publisher ?? new InMemoryToolEventPublisher();
  const observability =
    options.observability ?? createInMemoryToolObservability();
  const authorization =
    options.authorization ?? new ScopeBasedAuthorizationPolicy();
  const pipeline = new ToolExecutionPipeline({
    registry,
    publisher,
    observability,
    authorization,
    grantedScopes: options.grantedScopes ?? [],
    ...(options.isolationLevel
      ? { isolationLevel: options.isolationLevel }
      : {}),
  });
  return {
    registry,
    pipeline,
    execute: (request) => pipeline.execute(request),
  };
}
