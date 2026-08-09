import type { EngineAdapterConfig } from "@departify/config";
import type { EngineAdapter } from "./contract.js";
import { EngineProtocolError } from "./errors.js";
import { OpenClawEngineAdapter } from "./openclaw/openclaw-adapter.js";

/**
 * Factory: the single provider-independent entry point.
 *
 * ```ts
 * const engine = createEngineAdapter(config);
 * ```
 *
 * Future engines (Hermes, NativeDepartify) register here; no caller changes.
 */
export function createEngineAdapter(config: EngineAdapterConfig): EngineAdapter {
  switch (config.provider) {
    case "openclaw":
      return new OpenClawEngineAdapter(config);
    default: {
      const exhaustive: never = config.provider;
      throw new EngineProtocolError(
        `Unsupported engine provider: ${String(exhaustive)}`,
        { operation: "createEngineAdapter" },
      );
    }
  }
}

export type { EngineAdapter };
