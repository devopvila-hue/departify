export class LlmRouterValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmRouterValidationError";
  }
}

export function assertRouterValid(
  condition: boolean,
  message: string,
): asserts condition {
  if (!condition) {
    throw new LlmRouterValidationError(message);
  }
}
