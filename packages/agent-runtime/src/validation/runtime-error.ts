export class AgentRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentRuntimeError";
  }
}

export class AgentRuntimeValidationError extends AgentRuntimeError {
  constructor(message: string) {
    super(message);
    this.name = "AgentRuntimeValidationError";
  }
}

export class AgentRuntimeStateError extends AgentRuntimeError {
  constructor(message: string) {
    super(message);
    this.name = "AgentRuntimeStateError";
  }
}

export function assertRuntimeValid(
  condition: boolean,
  message: string,
): asserts condition {
  if (!condition) {
    throw new AgentRuntimeValidationError(message);
  }
}
