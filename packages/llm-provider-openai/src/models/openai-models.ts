import type { LlmModelDescriptor } from "@departify/llm-router";

export function createOpenAIModelDescriptor(
  modelId: string,
): LlmModelDescriptor {
  return {
    providerId: "openai",
    modelId,
    displayName: modelId,
    capabilities: [
      "chat",
      "tool_calling",
      "streaming",
      "structured_output",
      "json_output",
    ],
    costScore: 50,
    latencyScore: 50,
    availabilityScore: 90,
  };
}
