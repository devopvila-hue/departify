/**
 * Provider-agnostic observability surface for the LLM Router.
 *
 * The Router records metrics and emits log events without depending on any
 * concrete provider SDK, logger implementation, or telemetry transport.
 * Application code supplies a `RouterObservability` instance at composition
 * time. When no observability is supplied, `createNoopObservability()` is used.
 */

export type RouterOperation = "chat" | "completion" | "embeddings" | "stream";

export type RouterLogLevel = "debug" | "info" | "warn" | "error";

export interface RouterLogContext {
  readonly [key: string]: unknown;
}

export interface RouterLogger {
  log(level: RouterLogLevel, message: string, context?: RouterLogContext): void;
}

export interface RouterLatencyMetric {
  providerId: string;
  modelId: string;
  operation: RouterOperation;
  latencyMs: number;
}

export interface RouterTokenMetric {
  providerId: string;
  modelId: string;
  operation: RouterOperation;
  inputTokens?: number;
  outputTokens?: number;
}

export interface RouterErrorMetric {
  providerId: string;
  modelId: string;
  operation: RouterOperation;
  error: Error;
}

export interface RouterSuccessMetric {
  providerId: string;
  modelId: string;
  operation: RouterOperation;
}

export interface RouterMetrics {
  recordLatency(metric: RouterLatencyMetric): void;
  recordTokens(metric: RouterTokenMetric): void;
  recordError(metric: RouterErrorMetric): void;
  recordSuccess(metric: RouterSuccessMetric): void;
}

export interface RouterObservability {
  readonly logger: RouterLogger;
  readonly metrics: RouterMetrics;
}

/**
 * Convenience record for a completed request. The Router produces one of these
 * after every operation and forwards it to the supplied observability.
 */
export interface RouterRequestTrace {
  requestId: string;
  providerId: string;
  modelId: string;
  operation: RouterOperation;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  error?: Error;
}

/**
 * Routes an end-to-end trace through the supplied observability. This helper is
 * provider-agnostic: callers only know that a request happened and what
 * provider/model served it.
 */
export function reportRouterTrace(
  observability: RouterObservability,
  trace: RouterRequestTrace,
): void {
  observability.metrics.recordLatency({
    providerId: trace.providerId,
    modelId: trace.modelId,
    operation: trace.operation,
    latencyMs: trace.latencyMs,
  });
  if (trace.inputTokens !== undefined || trace.outputTokens !== undefined) {
    observability.metrics.recordTokens({
      providerId: trace.providerId,
      modelId: trace.modelId,
      operation: trace.operation,
      ...(trace.inputTokens !== undefined
        ? { inputTokens: trace.inputTokens }
        : {}),
      ...(trace.outputTokens !== undefined
        ? { outputTokens: trace.outputTokens }
        : {}),
    });
  }
  if (trace.error) {
    observability.metrics.recordError({
      providerId: trace.providerId,
      modelId: trace.modelId,
      operation: trace.operation,
      error: trace.error,
    });
    observability.logger.log("error", "LLM Router request failed.", {
      requestId: trace.requestId,
      providerId: trace.providerId,
      modelId: trace.modelId,
      operation: trace.operation,
      latencyMs: trace.latencyMs,
      errorName: trace.error.name,
      errorMessage: trace.error.message,
    });
    return;
  }
  observability.metrics.recordSuccess({
    providerId: trace.providerId,
    modelId: trace.modelId,
    operation: trace.operation,
  });
  observability.logger.log("debug", "LLM Router request succeeded.", {
    requestId: trace.requestId,
    providerId: trace.providerId,
    modelId: trace.modelId,
    operation: trace.operation,
    latencyMs: trace.latencyMs,
  });
}

class NoopMetrics implements RouterMetrics {
  recordLatency(): void {}
  recordTokens(): void {}
  recordError(): void {}
  recordSuccess(): void {}
}

class NoopLogger implements RouterLogger {
  log(): void {}
}

export function createNoopObservability(): RouterObservability {
  return {
    logger: new NoopLogger(),
    metrics: new NoopMetrics(),
  };
}

class ConsoleLogger implements RouterLogger {
  log(
    level: RouterLogLevel,
    message: string,
    context?: RouterLogContext,
  ): void {
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

/**
 * Memory-backed metrics recorder. Useful for tests and for environments that
 * want to inspect router metrics without binding to a transport.
 */
export class InMemoryRouterMetrics implements RouterMetrics {
  private readonly latencies: RouterLatencyMetric[] = [];
  private readonly tokens: RouterTokenMetric[] = [];
  private readonly errors: RouterErrorMetric[] = [];
  private readonly successes: RouterSuccessMetric[] = [];

  recordLatency(metric: RouterLatencyMetric): void {
    this.latencies.push({ ...metric });
  }

  recordTokens(metric: RouterTokenMetric): void {
    this.tokens.push({ ...metric });
  }

  recordError(metric: RouterErrorMetric): void {
    this.errors.push({ ...metric });
  }

  recordSuccess(metric: RouterSuccessMetric): void {
    this.successes.push({ ...metric });
  }

  getLatencies(): readonly RouterLatencyMetric[] {
    return [...this.latencies];
  }

  getTokens(): readonly RouterTokenMetric[] {
    return [...this.tokens];
  }

  getErrors(): readonly RouterErrorMetric[] {
    return [...this.errors];
  }

  getSuccesses(): readonly RouterSuccessMetric[] {
    return [...this.successes];
  }

  reset(): void {
    this.latencies.length = 0;
    this.tokens.length = 0;
    this.errors.length = 0;
    this.successes.length = 0;
  }
}

export function createConsoleObservability(): RouterObservability {
  return {
    logger: new ConsoleLogger(),
    metrics: new InMemoryRouterMetrics(),
  };
}

export function createInMemoryObservability(
  metrics: InMemoryRouterMetrics = new InMemoryRouterMetrics(),
): RouterObservability {
  return {
    logger: new NoopLogger(),
    metrics,
  };
}
