export type PersistenceErrorCode =
  | "persistence.not_found"
  | "persistence.conflict"
  | "persistence.optimistic_lock_failed"
  | "persistence.transaction_failed"
  | "persistence.validation_failed";

export interface PersistenceErrorDetails {
  code: PersistenceErrorCode;
  message: string;
  target?: string;
}

export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;
  readonly target?: string;

  constructor(details: PersistenceErrorDetails) {
    super(details.message);
    this.name = "PersistenceError";
    this.code = details.code;
    if (details.target !== undefined) {
      this.target = details.target;
    }
  }
}

export class PersistenceNotFoundError extends PersistenceError {
  constructor(message: string, target?: string) {
    super({
      code: "persistence.not_found",
      message,
      ...(target === undefined ? {} : { target }),
    });
    this.name = "PersistenceNotFoundError";
  }
}

export class PersistenceConflictError extends PersistenceError {
  constructor(message: string, target?: string) {
    super({
      code: "persistence.conflict",
      message,
      ...(target === undefined ? {} : { target }),
    });
    this.name = "PersistenceConflictError";
  }
}

export class OptimisticLockingError extends PersistenceError {
  constructor(message: string, target?: string) {
    super({
      code: "persistence.optimistic_lock_failed",
      message,
      ...(target === undefined ? {} : { target }),
    });
    this.name = "OptimisticLockingError";
  }
}

export class PersistenceTransactionError extends PersistenceError {
  constructor(message: string, target?: string) {
    super({
      code: "persistence.transaction_failed",
      message,
      ...(target === undefined ? {} : { target }),
    });
    this.name = "PersistenceTransactionError";
  }
}

export class PersistenceValidationError extends PersistenceError {
  constructor(message: string, target?: string) {
    super({
      code: "persistence.validation_failed",
      message,
      ...(target === undefined ? {} : { target }),
    });
    this.name = "PersistenceValidationError";
  }
}
