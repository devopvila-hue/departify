import type { LlmModelDescriptor } from "../src/index.js";

export function modelCatalogFixtures(): readonly LlmModelDescriptor[] {
  return [
    {
      providerId: "provider_alpha",
      modelId: "model_chat_fast",
      displayName: "Fast Chat Model",
      capabilities: ["chat", "streaming", "json_output"],
      costScore: 20,
      latencyScore: 10,
      availabilityScore: 80,
    },
    {
      providerId: "provider_beta",
      modelId: "model_reasoning_tools",
      displayName: "Reasoning Tools Model",
      capabilities: [
        "chat",
        "tool_calling",
        "structured_output",
        "reasoning",
        "json_output",
      ],
      costScore: 70,
      latencyScore: 60,
      availabilityScore: 95,
    },
    {
      providerId: "provider_gamma",
      modelId: "model_embeddings",
      displayName: "Embedding Model",
      capabilities: ["embeddings"],
      costScore: 15,
      latencyScore: 20,
      availabilityScore: 90,
    },
  ];
}
