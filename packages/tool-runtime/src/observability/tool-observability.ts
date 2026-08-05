import type {
  ToolAgentId,
  ToolExecutionResult,
  ToolId,
  ToolOrganizationId,
  ToolRequestId,
} from "../contracts/tool-contracts.js";

/**
 * Provider-agnostic observability surface for the Tool Runtime.
 *
 * Mirrors the shape used by the LLM Router: a logger and a metrics recorder,
 * both contract-only. The Runtime ships no transport and no default backend
 * other than the no-op implementations used in tests.
 */

export type ToolLogLevel = "debug" | "info" | "warn" | "error";

export interface ToolLogContext {
  readonly [key: string]: unknown;
}

export interface ToolLogger {
  log(level: ToolLogLevel, message: string, context?: ToolLogContext): void;
}

export interface ToolInvocationLatencyMetric {
  readonly toolId: ToolId;
  readonly toolVersion: string;
  readonly agentId?: ToolAgentId;
  readonly organizationId?: ToolOrganizationId;
  readonly durationMs: number;
}

export interface ToolInvocationErrorMetric {
  readonly toolId: ToolId;
  readonly toolVersion: string;
  readonly requestId: ToolRequestId;
  readonly agentId?: ToolAgentId;
  readonly organizationId?: ToolOrganizationId;
  readonly errorCode: string;
  readonly durationMs: number;
}

export interface ToolInvocationSuccessMetric {
  readonly toolId: ToolId;
  readonly toolVersion: string;
  readonly requestId: ToolRequestId;
  readonly agentId?: ToolAgentId;
  readonly organizationId?: ToolOrganizationId;
  readonly durationMs: number;
}

export interface ToolInvocationCancelledMetric {
  readonly toolId: ToolId;
  readonly toolVersion: string;
  readonly requestId: ToolRequestId;
  readonly agentId?: ToolAgentId;
  readonly organizationId?: ToolOrganizationId;
  readonly durationMs: number;
}

export interface ToolMetrics {
  recordLatency(metric: ToolInvocationLatencyMetric): void;
  recordSuccess(metric: ToolInvocationSuccessMetric): void;
  recordError(metric: ToolInvocationErrorMetric): void;
  recordCancellation(metric: ToolInvocationCancelledMetric): void;
}

export interface ToolObservability {
  readonly logger: ToolLogger;
  readonly metrics: ToolMetrics;
}

export class NoopToolLogger implements ToolLogger {
  log(): void {}
}

export class NoopToolMetrics implements ToolMetrics {
  recordLatency(): void {}
  recordSuccess(): void {}
  recordError(): void {}
  recordCancellation(): void {}
}

export function createNoopToolObservability(): ToolObservability {
  return {
    logger: new NoopToolLogger(),
    metrics: new NoopToolMetrics(),
  };
}

/**
 * In-memory metrics recorder. Used by tests and as a building block for
 * adapters that forward to OpenTelemetry, StatsD or any other backend.
 */
export class InMemoryToolMetrics implements ToolMetrics {
  private readonly latencies: ToolInvocationLatencyMetric[] = [];
  private readonly successes: ToolInvocationSuccessMetric[] = [];
  private readonly errors: ToolInvocationErrorMetric[] = [];
  private readonly cancellations: ToolInvocationCancelledMetric[] = [];

  recordLatency(metric: ToolInvocationLatencyMetric): void {
    this.latencies.push({ ...metric });
  }

  recordSuccess(metric: ToolInvocationSuccessMetric): void {
    this.successes.push({ ...metric });
  }

  recordError(metric: ToolInvocationErrorMetric): void {
    this.errors.push({ ...metric });
  }

  recordCancellation(metric: ToolInvocationCancelledMetric): void {
    this.cancellations.push({ ...metric });
  }

  getLatencies(): readonly ToolInvocationLatencyMetric[] {
    return [...this.latencies];
  }

  getSuccesses(): readonly ToolInvocationSuccessMetric[] {
    return [...this.successes];
  }

  getErrors(): readonly ToolInvocationErrorMetric[] {
    return [...this.errors];
  }

  getCancellations(): readonly ToolInvocationCancelledMetric[] {
    return [...this.cancellations];
  }

  reset(): void {
    this.latencies.length = 0;
    this.successes.length = 0;
    this.errors.length = 0;
    this.cancellations.length = 0;
  }
}

/**
 * Console-backed logger. Optional, used by the default `createConsoleToolObservability`
 * helper for local development.
 */
export class ConsoleToolLogger implements ToolLogger {
  log(level: ToolLogLevel, message: string, context?: ToolLogContext): void {
    const payload = context ? JSON.stringify(context) : "";
    const formatted = payload.length > 0 ? `${message} ${payload}` : message;
    switch (level) {
      case "error":
        console.error(formatted);
        return;
      case "warn":
        console.warn(formatted);
        return;
      case "debug":
        console.debug(formatted);
        return;
      case "info":
      default:
        console.log(formatted);
        return;
    }
  }
}

export function createConsoleToolObservability(): ToolObservability {
  return {
    logger: new ConsoleToolLogger(),
    metrics: new InMemoryToolMetrics(),
  };
}

export function createInMemoryToolObservability(
  metrics: InMemoryToolMetrics = new InMemoryToolMetrics(),
): ToolObservability {
  return {
    logger: new NoopToolLogger(),
    metrics,
  };
}

/**
 * Helper that emits the metric and log entry for a finished execution.
 * Pipeline code uses this once per execution to keep observability uniform.
 */
export function reportToolResult(
  observability: ToolObservability,
  result: ToolExecutionResult,
): void {
  const baseMetric = {
    toolId: result.toolId,
    toolVersion: result.toolVersion,
    requestId: result.requestId,
  };

  observability.metrics.recordLatency({
    toolId: result.toolId,
    toolVersion: result.toolVersion,
    durationMs: result.durationMs,
  });

  if (result.status === "completed") {
    observability.metrics.recordSuccess({
      ...baseMetric,
      durationMs: result.durationMs,
    });
    observability.logger.log("debug", "Tool execution completed.", {
      requestId: result.requestId,
      toolId: result.toolId,
      durationMs: result.durationMs,
    });
    return;
  }

  if (result.status === "cancelled") {
    observability.metrics.recordCancellation({
      ...baseMetric,
      durationMs: result.durationMs,
    });
    observability.logger.log("warn", "Tool execution cancelled.", {
      requestId: result.requestId,
      toolId: result.toolId,
      durationMs: result.durationMs,
    });
    return;
  }

  observability.metrics.recordError({
    ...baseMetric,
    durationMs: result.durationMs,
    errorCode: result.error?.code ?? "execution_failed",
  });
  observability.logger.log("error", "Tool execution failed.", {
    requestId: result.requestId,
    toolId: result.toolId,
    durationMs: result.durationMs,
    errorCode: result.error?.code,
    errorName: result.error?.name,
    errorMessage: result.error?.message,
  });
}
