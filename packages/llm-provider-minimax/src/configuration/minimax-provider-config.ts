import type { MiniMaxProviderConfig } from "@departify/config";
import { assertMiniMaxProviderConfig } from "../validation/minimax-provider-validation.js";

export interface MiniMaxProviderRuntimeConfig {
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  timeoutMs: number;
  maxRetries: number;
}

export function createMiniMaxProviderRuntimeConfig(
  config: MiniMaxProviderConfig,
  defaults?: { timeoutMs?: number; maxRetries?: number },
): MiniMaxProviderRuntimeConfig {
  const runtimeConfig: MiniMaxProviderRuntimeConfig = {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    defaultModel: config.defaultModel,
    timeoutMs: defaults?.timeoutMs ?? 30_000,
    maxRetries: defaults?.maxRetries ?? 2,
  };
  assertMiniMaxProviderConfig(runtimeConfig);
  return runtimeConfig;
}
