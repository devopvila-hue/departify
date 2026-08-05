import { assertAgentDomainInvariant } from "../validation/domain-error.js";

const capabilityPattern = /^[a-z][a-z0-9:._-]{1,63}$/;

export interface AgentCapabilitiesSnapshot {
  items: readonly string[];
}

export class AgentCapabilities {
  private constructor(private readonly items: readonly string[]) {}

  static create(snapshot: AgentCapabilitiesSnapshot): AgentCapabilities {
    assertAgentDomainInvariant(
      snapshot.items.length > 0,
      "AgentCapabilities must contain at least one capability.",
    );
    assertAgentDomainInvariant(
      snapshot.items.length <= 50,
      "AgentCapabilities cannot contain more than 50 capabilities.",
    );

    const normalized = snapshot.items.map((item) => item.trim().toLowerCase());
    assertAgentDomainInvariant(
      new Set(normalized).size === normalized.length,
      "AgentCapabilities cannot contain duplicate capabilities.",
    );
    normalized.forEach((capability) => {
      assertAgentDomainInvariant(
        capabilityPattern.test(capability),
        "AgentCapability must be a safe capability code between 2 and 64 characters.",
      );
    });

    return new AgentCapabilities(normalized);
  }

  has(capability: string): boolean {
    return this.items.includes(capability.trim().toLowerCase());
  }

  toSnapshot(): AgentCapabilitiesSnapshot {
    return {
      items: [...this.items],
    };
  }
}
