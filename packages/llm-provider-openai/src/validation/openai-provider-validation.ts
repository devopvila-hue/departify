import type { OpenAIProviderRuntimeConfig } from "../configuration/openai-provider-config.js";

export class OpenAIProviderValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenAIProviderValidationError";
  }
}

export function assertOpenAIProviderValid(
  condition: boolean,
  message: string,
): asserts condition {
  if (!condition) {
    throw new OpenAIProviderValidationError(message);
  }
}

export function assertOpenAIProviderConfig(
  config: OpenAIProviderRuntimeConfig,
): void {
  assertOpenAIProviderValid(
    config.apiKey.trim().length > 0,
    "OpenAI apiKey is required.",
  );
  assertOpenAIProviderValid(
    config.defaultModel.trim().length > 0,
    "OpenAI defaultModel is required.",
  );
  assertOpenAIProviderValid(
    Number.isInteger(config.timeoutMs) && config.timeoutMs > 0,
    "OpenAI timeoutMs must be a positive integer.",
  );
  assertOpenAIProviderValid(
    Number.isInteger(config.maxRetries) && config.maxRetries >= 0,
    "OpenAI maxRetries must be a non-negative integer.",
  );
}
