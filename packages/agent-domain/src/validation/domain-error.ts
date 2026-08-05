export class AgentDomainInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentDomainInvariantError";
  }
}

export function assertAgentDomainInvariant(
  condition: boolean,
  message: string,
): asserts condition {
  if (!condition) {
    throw new AgentDomainInvariantError(message);
  }
}
