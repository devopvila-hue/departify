import { assertAgentDomainInvariant } from "../validation/domain-error.js";

export class AgentName {
  private constructor(private readonly value: string) {}

  static create(value: string): AgentName {
    const normalized = value.trim().replace(/\s+/g, " ");
    assertAgentDomainInvariant(
      normalized.length >= 2 && normalized.length <= 80,
      "AgentName must be between 2 and 80 characters.",
    );
    assertAgentDomainInvariant(
      !containsControlCharacter(normalized),
      "AgentName cannot contain control characters.",
    );
    return new AgentName(normalized);
  }

  equals(other: AgentName): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}
