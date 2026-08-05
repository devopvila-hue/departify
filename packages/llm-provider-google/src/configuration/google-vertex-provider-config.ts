import type { GoogleVertexProviderConfig } from "@departify/config";
import { assertGoogleVertexProviderConfig } from "../validation/google-vertex-provider-validation.js";

export interface GoogleVertexProviderRuntimeConfig {
  projectId: string;
  location: string;
  defaultModel: string;
  applicationCredentials?: string;
  timeoutMs: number;
  maxRetries: number;
}

export function createGoogleVertexProviderRuntimeConfig(
  config: GoogleVertexProviderConfig,
  defaults?: { timeoutMs?: number; maxRetries?: number },
): GoogleVertexProviderRuntimeConfig {
  const runtimeConfig: GoogleVertexProviderRuntimeConfig = {
    projectId: config.projectId,
    location: config.location,
    defaultModel: config.defaultModel,
    ...(config.applicationCredentials
      ? { applicationCredentials: config.applicationCredentials }
      : {}),
    timeoutMs: defaults?.timeoutMs ?? 30_000,
    maxRetries: defaults?.maxRetries ?? 2,
  };
  assertGoogleVertexProviderConfig(runtimeConfig);
  return runtimeConfig;
}
