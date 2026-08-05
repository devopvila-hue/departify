import type { GoogleVertexProviderRuntimeConfig } from "../configuration/google-vertex-provider-config.js";

export class GoogleVertexProviderValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleVertexProviderValidationError";
  }
}

export function assertGoogleVertexProviderValid(
  condition: boolean,
  message: string,
): asserts condition {
  if (!condition) {
    throw new GoogleVertexProviderValidationError(message);
  }
}

export function assertGoogleVertexProviderConfig(
  config: GoogleVertexProviderRuntimeConfig,
): void {
  assertGoogleVertexProviderValid(
    config.projectId.trim().length > 0,
    "Google Vertex projectId is required.",
  );
  assertGoogleVertexProviderValid(
    config.location.trim().length > 0,
    "Google Vertex location is required.",
  );
  assertGoogleVertexProviderValid(
    config.defaultModel.trim().length > 0,
    "Google Vertex defaultModel is required.",
  );
  assertGoogleVertexProviderValid(
    Number.isInteger(config.timeoutMs) && config.timeoutMs > 0,
    "Google Vertex timeoutMs must be a positive integer.",
  );
  assertGoogleVertexProviderValid(
    Number.isInteger(config.maxRetries) && config.maxRetries >= 0,
    "Google Vertex maxRetries must be a non-negative integer.",
  );
}
