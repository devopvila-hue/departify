import type { MiniMaxProviderRuntimeConfig } from "../configuration/minimax-provider-config.js";

export class MiniMaxProviderValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MiniMaxProviderValidationError";
  }
}

export function assertMiniMaxProviderValid(
  condition: boolean,
  message: string,
): asserts condition {
  if (!condition) {
    throw new MiniMaxProviderValidationError(message);
  }
}

export function assertMiniMaxProviderConfig(
  config: MiniMaxProviderRuntimeConfig,
): void {
  assertMiniMaxProviderValid(
    config.apiKey.trim().length > 0,
    "MiniMax apiKey is required.",
  );
  assertMiniMaxProviderValid(
    config.baseUrl.trim().length > 0,
    "MiniMax baseUrl is required.",
  );
  assertMiniMaxProviderValid(
    config.defaultModel.trim().length > 0,
    "MiniMax defaultModel is required.",
  );
  assertMiniMaxProviderValid(
    Number.isInteger(config.timeoutMs) && config.timeoutMs > 0,
    "MiniMax timeoutMs must be a positive integer.",
  );
  assertMiniMaxProviderValid(
    Number.isInteger(config.maxRetries) && config.maxRetries >= 0,
    "MiniMax maxRetries must be a non-negative integer.",
  );
}
