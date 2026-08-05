import { assertAgentDomainInvariant } from "../validation/domain-error.js";

const agentIdPattern = /^agt_[a-zA-Z0-9][a-zA-Z0-9_-]{5,63}$/;

export class AgentId {
  private constructor(private readonly value: string) {}

  static create(value: string): AgentId {
    const normalized = value.trim();
    assertAgentDomainInvariant(
      agentIdPattern.test(normalized),
      "AgentId must start with agt_ and contain 6 to 64 safe identifier characters.",
    );
    return new AgentId(normalized);
  }

  equals(other: AgentId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
