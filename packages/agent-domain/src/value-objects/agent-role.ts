import { assertAgentDomainInvariant } from "../validation/domain-error.js";

const roleCodePattern = /^[a-z][a-z0-9-]{1,47}$/;

export class AgentRole {
  private constructor(private readonly value: string) {}

  static create(value: string): AgentRole {
    const normalized = value.trim().toLowerCase();
    assertAgentDomainInvariant(
      roleCodePattern.test(normalized),
      "AgentRole must be a lowercase role code between 2 and 48 characters.",
    );
    return new AgentRole(normalized);
  }

  equals(other: AgentRole): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
