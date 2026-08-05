import { assertRouterValid } from "../validation/router-error.js";

export const llmCapabilityCodes = [
  "chat",
  "completion",
  "embeddings",
  "tool_calling",
  "streaming",
  "structured_output",
  "vision",
  "reasoning",
  "json_output",
] as const;

export type LlmCapabilityCode = (typeof llmCapabilityCodes)[number];

export interface ModelCapabilitiesSnapshot {
  capabilities: readonly LlmCapabilityCode[];
}

export class ModelCapabilities {
  private constructor(
    private readonly capabilities: readonly LlmCapabilityCode[],
  ) {}

  static create(snapshot: ModelCapabilitiesSnapshot): ModelCapabilities {
    assertRouterValid(
      snapshot.capabilities.length > 0,
      "ModelCapabilities must contain at least one capability.",
    );
    assertRouterValid(
      new Set(snapshot.capabilities).size === snapshot.capabilities.length,
      "ModelCapabilities cannot contain duplicate capabilities.",
    );
    snapshot.capabilities.forEach((capability) => {
      assertRouterValid(
        llmCapabilityCodes.includes(capability),
        "Model capability is invalid.",
      );
    });

    return new ModelCapabilities([...snapshot.capabilities]);
  }

  supports(capability: LlmCapabilityCode): boolean {
    return this.capabilities.includes(capability);
  }

  supportsAll(required: readonly LlmCapabilityCode[]): boolean {
    return required.every((capability) => this.supports(capability));
  }

  toSnapshot(): ModelCapabilitiesSnapshot {
    return {
      capabilities: [...this.capabilities],
    };
  }
}
