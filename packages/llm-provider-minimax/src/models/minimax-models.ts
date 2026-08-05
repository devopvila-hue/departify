import type { LlmModelDescriptor } from "@departify/llm-router";

export function createMiniMaxModelDescriptor(
  modelId: string,
): LlmModelDescriptor {
  return {
    providerId: "minimax",
    modelId,
    displayName: modelId,
    capabilities: [
      "chat",
      "completion",
      "tool_calling",
      "streaming",
      "structured_output",
      "json_output",
    ],
    costScore: 45,
    latencyScore: 55,
    availabilityScore: 85,
  };
}
