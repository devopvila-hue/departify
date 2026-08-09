/**
 * Provider-independent engine errors.
 *
 * Every error surfaced by an engine implementation maps onto one of these.
 * Raw gateway/provider errors never escape the adapter boundary.
 */

export type EngineErrorCode =
  | "ENGINE_UNAVAILABLE"
  | "ENGINE_AUTHENTICATION"
  | "ENGINE_TIMEOUT"
  | "ENGINE_SESSION_NOT_FOUND"
  | "ENGINE_RATE_LIMIT"
  | "ENGINE_EXECUTION"
  | "ENGINE_PROTOCOL"
  | "ENGINE_INVALID_REQUEST";

export interface EngineErrorOptions {
  cause?: unknown;
  provider?: string;
  statusCode?: number;
  retryAfterMs?: number;
  operation?: string;
  retryable?: boolean;
}

export class EngineError extends Error {
  readonly code: EngineErrorCode;
  /** Provider that produced the underlying failure (e.g. "google-vertex"). */
  readonly provider?: string;
  /** HTTP/gateway status when available. */
  readonly statusCode?: number;
  /** Seconds to wait before retrying, when the upstream signals it. */
  readonly retryAfterMs?: number;
  /** Operation that failed. */
  readonly operation?: string;
  /** True when retrying the same operation is considered safe. */
  readonly retryable: boolean;

  constructor(
    code: EngineErrorCode,
    message: string,
    options: EngineErrorOptions = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "EngineError";
    this.code = code;
    if (options.provider !== undefined) this.provider = options.provider;
    if (options.statusCode !== undefined) this.statusCode = options.statusCode;
    if (options.retryAfterMs !== undefined) {
      this.retryAfterMs = options.retryAfterMs;
    }
    if (options.operation !== undefined) this.operation = options.operation;
    this.retryable = options.retryable ?? false;
  }
}

export class EngineUnavailableError extends EngineError {
  constructor(
    message: string,
    options: EngineErrorOptions = {},
  ) {
    super("ENGINE_UNAVAILABLE", message, options);
    this.name = "EngineUnavailableError";
  }
}

export class EngineAuthenticationError extends EngineError {
  constructor(
    message: string,
    options: EngineErrorOptions = {},
  ) {
    super("ENGINE_AUTHENTICATION", message, options);
    this.name = "EngineAuthenticationError";
  }
}

export class EngineTimeoutError extends EngineError {
  constructor(
    message: string,
    options: EngineErrorOptions = {},
  ) {
    super("ENGINE_TIMEOUT", message, options);
    this.name = "EngineTimeoutError";
  }
}

export class EngineSessionNotFoundError extends EngineError {
  constructor(
    message: string,
    options: EngineErrorOptions = {},
  ) {
    super("ENGINE_SESSION_NOT_FOUND", message, options);
    this.name = "EngineSessionNotFoundError";
  }
}

export class EngineRateLimitError extends EngineError {
  constructor(
    message: string,
    options: EngineErrorOptions = {},
  ) {
    super("ENGINE_RATE_LIMIT", message, options);
    this.name = "EngineRateLimitError";
  }
}

export class EngineExecutionError extends EngineError {
  constructor(
    message: string,
    options: EngineErrorOptions = {},
  ) {
    super("ENGINE_EXECUTION", message, options);
    this.name = "EngineExecutionError";
  }
}

export class EngineProtocolError extends EngineError {
  constructor(
    message: string,
    options: EngineErrorOptions = {},
  ) {
    super("ENGINE_PROTOCOL", message, options);
    this.name = "EngineProtocolError";
  }
}

export class EngineInvalidRequestError extends EngineError {
  constructor(
    message: string,
    options: EngineErrorOptions = {},
  ) {
    super("ENGINE_INVALID_REQUEST", message, options);
    this.name = "EngineInvalidRequestError";
  }
}
