export class ExecutiveDirectorValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutiveDirectorValidationError";
  }
}

export function assertDirectorValid(
  condition: boolean,
  message: string,
): asserts condition {
  if (!condition) {
    throw new ExecutiveDirectorValidationError(message);
  }
}
