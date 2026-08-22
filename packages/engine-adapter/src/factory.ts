import type { EngineAdapterConfig } from "@departify/config";
import type { EngineAdapter } from "./contract.js";
import { EngineProtocolError } from "./errors.js";
import { OpenClawEngineAdapter } from "./openclaw/openclaw-adapter.js";
import { OrganizationRuntimeResolver } from "./runtime-resolver.js";

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

/**
 * Create a multi-engine resolver + adapter factory.
 *
 * Sprint ENGINE 02 Phase 2: enables routing different organizations to
 * different engine instances.
 *
 * ```ts
 * const { resolver, createForOrg } = createMultiEngineFactory(multiConfig, defaultConfig);
 * const engine = createForOrg(organizationId);
 * ```
 */
export function createMultiEngineFactory(
  multiConfig: import("@departify/config").MultiEngineConfig,
  defaultConfig: EngineAdapterConfig,
): {
  resolver: OrganizationRuntimeResolver;
  createForOrg: (organizationId: string) => EngineAdapter;
} {
  const resolver = new OrganizationRuntimeResolver(multiConfig, defaultConfig);

  const createForOrg = (organizationId: string): EngineAdapter => {
    const config = resolver.resolve(organizationId);
    return createEngineAdapter(config);
  };

  return { resolver, createForOrg };
}

export type { EngineAdapter };
