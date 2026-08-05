import type { LlmModelDescriptor } from "@departify/llm-router";

export function createGoogleVertexModelDescriptor(
  modelId: string,
): LlmModelDescriptor {
  return {
    providerId: "google_vertex",
    modelId,
    displayName: modelId,
    capabilities: [
      "chat",
      "completion",
      "tool_calling",
      "streaming",
      "structured_output",
      "vision",
      "reasoning",
    ],
    costScore: 55,
    latencyScore: 45,
    availabilityScore: 90,
  };
}
