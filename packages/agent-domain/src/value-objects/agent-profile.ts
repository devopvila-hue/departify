import { assertAgentDomainInvariant } from "../validation/domain-error.js";

export interface AgentProfileSnapshot {
  summary: string;
  responsibilities: readonly string[];
}

export class AgentProfile {
  private constructor(
    private readonly summary: string,
    private readonly responsibilities: readonly string[],
  ) {}

  static create(snapshot: AgentProfileSnapshot): AgentProfile {
    const summary = normalizeText(snapshot.summary);
    assertAgentDomainInvariant(
      summary.length >= 10 && summary.length <= 500,
      "AgentProfile summary must be between 10 and 500 characters.",
    );
    assertAgentDomainInvariant(
      snapshot.responsibilities.length > 0,
      "AgentProfile must contain at least one responsibility.",
    );
    assertAgentDomainInvariant(
      snapshot.responsibilities.length <= 20,
      "AgentProfile cannot contain more than 20 responsibilities.",
    );

    const responsibilities = snapshot.responsibilities.map(normalizeText);
    responsibilities.forEach((responsibility) => {
      assertAgentDomainInvariant(
        responsibility.length >= 3 && responsibility.length <= 160,
        "AgentProfile responsibility must be between 3 and 160 characters.",
      );
    });

    return new AgentProfile(summary, responsibilities);
  }

  toSnapshot(): AgentProfileSnapshot {
    return {
      summary: this.summary,
      responsibilities: [...this.responsibilities],
    };
  }
}

function normalizeText(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  assertAgentDomainInvariant(
    !containsControlCharacter(normalized),
    "AgentProfile cannot contain control characters.",
  );
  return normalized;
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}
