/**
 * OrganizationRuntimeResolver — multi-engine routing by organization ID.
 *
 * Sprint ENGINE 02 Phase 2: enables routing different organizations to
 * different engine instances (Engine A = default, Engine B = NemoClaw POC).
 *
 * Usage:
 * ```ts
 * const resolver = new OrganizationRuntimeResolver(multiEngineConfig, defaultConfig);
 * const config = resolver.resolve(organizationId);
 * const engine = createEngineAdapter(config);
 * ```
 *
 * The resolver is stateless and thread-safe. It does NOT create or cache
 * engine adapters — that's the caller's responsibility.
 */

import type { EngineAdapterConfig, MultiEngineConfig } from "@departify/config";

/**
 * Resolves which engine configuration to use for a given organization.
 *
 * Routing rules:
 * - mode "current": all orgs → Engine A (default config)
 * - mode "nemoclaw-poc": all orgs → Engine B
 * - mode "multi": specific orgs → Engine B, rest → Engine A
 */
export class OrganizationRuntimeResolver {
  private readonly mode: MultiEngineConfig["mode"];
  private readonly nemoclawOrgIds: Set<string>;
  private readonly defaultConfig: EngineAdapterConfig;
  private readonly nemoclawConfig: EngineAdapterConfig | null;

  constructor(
    multiConfig: MultiEngineConfig,
    defaultConfig: EngineAdapterConfig,
  ) {
    this.mode = multiConfig.mode;
    this.defaultConfig = defaultConfig;
    this.nemoclawOrgIds = new Set(multiConfig.nemoclawPoc?.orgIds ?? []);

    if (multiConfig.nemoclawPoc) {
      this.nemoclawConfig = {
        ...defaultConfig,
        gatewayUrl: multiConfig.nemoclawPoc.gatewayUrl,
        gatewayToken: multiConfig.nemoclawPoc.gatewayToken,
      };
    } else {
      this.nemoclawConfig = null;
    }
  }

  /**
   * Resolve the engine configuration for a given organization.
   *
   * @param organizationId - The organization ID to resolve
   * @returns The engine configuration to use for this organization
   */
  resolve(organizationId: string): EngineAdapterConfig {
    switch (this.mode) {
      case "current":
        return this.defaultConfig;

      case "nemoclaw-poc":
        if (!this.nemoclawConfig) {
          throw new Error(
            "NemoClaw POC config not available but runtime mode is 'nemoclaw-poc'.",
          );
        }
        return this.nemoclawConfig;

      case "multi":
        if (this.nemoclawOrgIds.has(organizationId)) {
          if (!this.nemoclawConfig) {
            throw new Error(
              `NemoClaw POC config not available but org '${organizationId}' is routed to Engine B.`,
            );
          }
          return this.nemoclawConfig;
        }
        return this.defaultConfig;

      default: {
        const exhaustive: never = this.mode;
        throw new Error(`Unknown runtime mode: ${String(exhaustive)}`);
      }
    }
  }

  /**
   * Check if an organization is routed to Engine B.
   *
   * @param organizationId - The organization ID to check
   * @returns true if this org uses Engine B
   */
  isNemoclawPoc(organizationId: string): boolean {
    switch (this.mode) {
      case "current":
        return false;
      case "nemoclaw-poc":
        return true;
      case "multi":
        return this.nemoclawOrgIds.has(organizationId);
      default:
        return false;
    }
  }

  /**
   * Get the current runtime mode.
   */
  getMode(): MultiEngineConfig["mode"] {
    return this.mode;
  }

  /**
   * Get the list of organizations routed to Engine B (multi mode only).
   */
  getNemoclawPocOrgIds(): string[] {
    return Array.from(this.nemoclawOrgIds);
  }
}
