import type { ConnectorProvider, ConnectorRuntime } from "./contracts.js";

export type ExecutionProviderKind = "official_mcp" | "official_api" | "existing_connector" | "activepieces_community" | "custom";

export interface ConnectorRuntimeCandidate {
  readonly provider: ConnectorProvider;
  readonly kind: ExecutionProviderKind;
  readonly capabilities: readonly string[];
  readonly runtime: ConnectorRuntime;
}

export interface ProviderSelection {
  readonly candidate: ConnectorRuntimeCandidate;
  readonly policyOrder: readonly ExecutionProviderKind[];
}

export const DEFAULT_PROVIDER_SELECTION_POLICY: readonly ExecutionProviderKind[] = [
  "official_mcp",
  "official_api",
  "existing_connector",
  "activepieces_community",
  "custom",
];

/**
 * Selects the highest-priority provider for a business capability. This is
 * deliberately independent of Meta/Google/TikTok names so Marketing keeps a
 * stable capability contract when a provider changes transport.
 */
export function selectConnectorRuntime(
  capability: string,
  candidates: readonly ConnectorRuntimeCandidate[],
  policy: readonly ExecutionProviderKind[] = DEFAULT_PROVIDER_SELECTION_POLICY,
): ProviderSelection | null {
  for (const kind of policy) {
    const candidate = candidates.find((entry) => entry.kind === kind && entry.capabilities.includes(capability));
    if (candidate) return { candidate, policyOrder: policy };
  }
  return null;
}

export function providerPriority(kind: ExecutionProviderKind, policy = DEFAULT_PROVIDER_SELECTION_POLICY): number {
  const index = policy.indexOf(kind);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}
