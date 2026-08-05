export class MemoryEngineValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryEngineValidationError";
  }
}

export function assertMemoryValid(
  condition: boolean,
  message: string,
): asserts condition {
  if (!condition) {
    throw new MemoryEngineValidationError(message);
  }
}
