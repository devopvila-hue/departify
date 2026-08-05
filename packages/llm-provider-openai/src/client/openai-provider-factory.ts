import { loadOpenAIProviderConfig } from "@departify/config";
import { createOpenAIClient } from "./openai-client.js";
import { createOpenAIProviderRuntimeConfig } from "../configuration/openai-provider-config.js";
import { OpenAILlmProvider } from "../adapters/openai-llm-provider.js";

export function createOpenAIProviderFromConfig(): OpenAILlmProvider {
  const config = createOpenAIProviderRuntimeConfig(loadOpenAIProviderConfig());
  return new OpenAILlmProvider(createOpenAIClient(config), config);
}
