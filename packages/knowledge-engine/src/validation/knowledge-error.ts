export class KnowledgeEngineValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeEngineValidationError";
  }
}

export function assertKnowledgeValid(
  condition: boolean,
  message: string,
): asserts condition {
  if (!condition) {
    throw new KnowledgeEngineValidationError(message);
  }
}
