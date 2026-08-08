/**
 * Capability Resolver — Sprint 62.
 *
 * A Department Head uses this when planning work. It resolves a requested
 * business capability against the registry + operational source.
 *
 * Resolution order (deterministic):
 *   1. Existing READY Departify capability (native/integration/workflow).
 *   2. Existing connected integration/tool.
 *   3. Compatible registered MCP capability.
 *   4. Compatible imported/adapted skill.
 *   5. Missing capability → acquisition request (no fake availability).
 *
 * The resolver never invents availability: a candidate is only `resolved`
 * when its operational state is `ready`. Everything else yields an
 * acquisition request with the missing business capability named in plain
 * language.
 */

import type { CapabilityContract } from "../contracts/capability-contract.js";
import type {
  DerivedCapabilityState,
  DepartmentCapabilityRegistry,
} from "../registry/department-capability-registry.js";
import type { OperationalSourcePort } from "../contracts/operational-source-port.js";

export interface CapabilityResolutionInput {
  readonly department: string;
  /** The Department Head's objective (free-form, CEO language). */
  readonly objective: string;
  /** The business capability being requested (e.g. "contact analysis"). */
  readonly requiredCapability: string;
}

export interface ResolvedCapability {
  readonly capability: CapabilityContract;
  readonly state: DerivedCapabilityState;
}

export interface AcquisitionRequest {
  readonly department: string;
  readonly requiredCapability: string;
  /** Business-language explanation of what is missing. */
  readonly message: string;
  /** Suggested source to acquire (e.g. "integration", "mcp", "imported"). */
  readonly suggestedSource: string;
  /** Connection that must be established, when relevant. */
  readonly requiredConnection?: string;
}

export interface CapabilityResolution {
  readonly outcome: "resolved" | "acquisition_required";
  readonly resolved?: ResolvedCapability;
  readonly acquisition?: AcquisitionRequest;
}

const RESOLUTION_PRIORITY: readonly string[] = [
  "native",
  "integration",
  "workflow",
  "mcp",
  "imported",
] as const;

export function resolveCapability(
  registry: DepartmentCapabilityRegistry,
  source: OperationalSourcePort,
  input: CapabilityResolutionInput,
): CapabilityResolution {
  // 1–4. Scan every registered capability that matches the requested business
  // capability (by id, name, provider, or an action name) in source priority
  // order. Only a `ready` operational state resolves.
  const candidates = registry
    .list()
    .filter(
      (capability) =>
        capability.department === input.department &&
        matchesRequestedCapability(capability, input.requiredCapability),
    )
    .sort(
      (a, b) =>
        RESOLUTION_PRIORITY.indexOf(a.source) -
        RESOLUTION_PRIORITY.indexOf(b.source),
    );

  for (const capability of candidates) {
    const state = registry.derive(source).find(
      (entry) => entry.capability.id === capability.id,
    );
    if (state && state.status === "ready") {
      return {
        outcome: "resolved",
        resolved: { capability, state },
      };
    }
  }

  // 5. Acquisition request — the capability genuinely does not exist or is not
  // operational. Never claim availability.
  const connectionNeed = candidates
    .map((capability) => capability.requiredConnections)
    .flat()
    .find((toolId) => {
      const connection = source.connection(toolId);
      return connection && connection.status !== "connected";
    });

  return {
    outcome: "acquisition_required",
    acquisition: {
      department: input.department,
      requiredCapability: input.requiredCapability,
      message: `${input.requiredCapability} is not available in ${input.department} right now.`,
      suggestedSource: candidates[0]?.source ?? "integration",
      ...(connectionNeed ? { requiredConnection: connectionNeed } : {}),
    },
  };
}

function matchesRequestedCapability(
  capability: CapabilityContract,
  requiredCapability: string,
): boolean {
  const haystack = [
    capability.id,
    capability.name,
    capability.provider,
    capability.description,
    ...capability.actions.map((action) => action.name),
    ...capability.actions.map((action) => action.description),
  ]
    .join(" ")
    .toLowerCase();
  const needle = requiredCapability.toLowerCase();
  return (
    haystack.includes(needle) ||
    requiredCapability
      .split(/\s+/)
      .some((word) => word.length > 0 && haystack.includes(word.toLowerCase()))
  );
}
