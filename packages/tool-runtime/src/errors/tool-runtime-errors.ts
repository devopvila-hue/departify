/**
 * Base class for every error raised inside the Tool Runtime boundary.
 *
 * Concrete subclasses encode the phase of the pipeline that produced the
 * error. Tool Runtime never throws raw errors; every thrown value is a
 * `ToolRuntimeError` so callers can branch on the type without parsing
 * messages.
 */
export class ToolRuntimeError extends Error {
  constructor(
    message: string,
    public readonly code: ToolRuntimeErrorCode,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = "ToolRuntimeError";
    this.cause = options?.cause;
  }
}

export type ToolRuntimeErrorCode =
  | "validation_failed"
  | "unknown_tool"
  | "duplicate_tool"
  | "authorization_failed"
  | "preparation_failed"
  | "execution_failed"
  | "execution_disabled"
  | "execution_timeout"
  | "execution_cancelled"
  | "execution_limit_exceeded"
  | "invalid_request"
  | "invalid_definition";

export class ToolValidationError extends ToolRuntimeError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, "validation_failed", options);
    this.name = "ToolValidationError";
  }
}

export class ToolUnknownError extends ToolRuntimeError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, "unknown_tool", options);
    this.name = "ToolUnknownError";
  }
}

export class ToolDuplicateError extends ToolRuntimeError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, "duplicate_tool", options);
    this.name = "ToolDuplicateError";
  }
}

export class ToolAuthorizationError extends ToolRuntimeError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, "authorization_failed", options);
    this.name = "ToolAuthorizationError";
  }
}

export class ToolPreparationError extends ToolRuntimeError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, "preparation_failed", options);
    this.name = "ToolPreparationError";
  }
}

export class ToolExecutionError extends ToolRuntimeError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, "execution_failed", options);
    this.name = "ToolExecutionError";
  }
}

export class ToolExecutionDisabledError extends ToolRuntimeError {
  constructor(message = "Tool execution is disabled in this sprint.") {
    super(message, "execution_disabled");
    this.name = "ToolExecutionDisabledError";
  }
}

export class ToolTimeoutError extends ToolRuntimeError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, "execution_timeout", options);
    this.name = "ToolTimeoutError";
  }
}

export class ToolCancellationError extends ToolRuntimeError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, "execution_cancelled", options);
    this.name = "ToolCancellationError";
  }
}

export class ToolLimitExceededError extends ToolRuntimeError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, "execution_limit_exceeded", options);
    this.name = "ToolLimitExceededError";
  }
}
